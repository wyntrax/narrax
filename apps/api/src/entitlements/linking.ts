import type { PrismaClient } from '@narra/database';
import { z } from 'zod';
import { AccessError, audit, lock, lockUser, TX_OPTIONS, WalletInput } from './common';
import { challengeMessage, hash, newNonce, verifyWalletProof } from './crypto';
import { localSettings } from './settings';

export async function createWalletChallenge(db: PrismaClient, userId: string, input: unknown, clock: () => Date) {
  const wallet = WalletInput.safeParse(input);
  if (!wallet.success) throw new AccessError('INVALID_INPUT', 400);
  return db.$transaction(async tx => {
    await lock(tx, 'domain');
    await lockUser(tx, userId);
    const now = clock();
    const { domain } = await localSettings(tx);
    if (!domain) throw new AccessError('WALLET_LINK_UNAVAILABLE', 503);
    if ((await tx.linkedWallet.count({ where: { userId } })) >= 5) throw new AccessError('WALLET_LIMIT');
    const active = { userId, consumedAt: null, expiresAt: { gt: now } };
    // Replacing this pair's proof consumes its previous nonce.
    await tx.walletLinkChallenge.updateMany({ where: { ...active, ...wallet.data }, data: { consumedAt: now } });
    if ((await tx.walletLinkChallenge.count({ where: active })) >= 5) throw new AccessError('CHALLENGE_LIMIT', 429);
    const nonce = newNonce(), expiresAt = new Date(now.getTime() + 300_000);
    const message = challengeMessage({ domain, userId, address: wallet.data.address, nonce, issuedAt: now, expiresAt });
    const row = await tx.walletLinkChallenge.create({ data: { userId, ...wallet.data, domain, nonceHash: hash(nonce), messageHash: hash(message), issuedAt: now, expiresAt } });
    return { challengeId: row.id, message, expiresAt };
  }, TX_OPTIONS);
}
const VerifyInput = z.object({ challengeId: z.string().min(1).max(128), message: z.string().min(1).max(2048), signature: z.string().min(1).max(100) }).strict();
export async function verifyWalletChallenge(db: PrismaClient, userId: string, input: unknown, clock: () => Date) {
  const parsed = VerifyInput.safeParse(input);
  if (!parsed.success) throw new AccessError('INVALID_INPUT', 400);
  const v = parsed.data;
  try {
    return await db.$transaction(async tx => {
      await lock(tx, 'domain');
      await lockUser(tx, userId);
      const now = clock();
      const c = await tx.walletLinkChallenge.findFirst({ where: { id: v.challengeId, userId } });
      if (!c) throw new AccessError('NOT_FOUND', 404);
      if (c.consumedAt || c.expiresAt <= now || c.issuedAt > now) throw new AccessError('CHALLENGE_UNAVAILABLE');
      const { domain } = await localSettings(tx);
      if (!domain || domain !== c.domain) throw new AccessError('CHALLENGE_UNAVAILABLE');
      const nonce = /^Nonce: ([a-f0-9]{64})$/m.exec(v.message)?.[1];
      if (!nonce || hash(nonce) !== c.nonceHash || hash(v.message) !== c.messageHash || challengeMessage({ ...c, nonce }) !== v.message || !verifyWalletProof(v.message, v.signature, c.address)) throw new AccessError('INVALID_WALLET_PROOF', 401);
      if ((await tx.linkedWallet.count({ where: { userId } })) >= 5) throw new AccessError('WALLET_LIMIT');
      if (await tx.linkedWallet.findUnique({ where: { chain_address: { chain: c.chain, address: c.address } } })) throw new AccessError('WALLET_UNAVAILABLE');
      const claim = await tx.walletLinkChallenge.updateMany({ where: { id: c.id, userId, consumedAt: null, expiresAt: { gt: clock() } }, data: { consumedAt: clock() } });
      if (claim.count !== 1) throw new AccessError('CHALLENGE_UNAVAILABLE');
      const link = await tx.linkedWallet.create({ data: { userId, chain: c.chain, address: c.address, verifiedAt: now } });
      await audit(tx, userId, 'entitlements.wallet_linked', { linkId: link.id, chain: link.chain, address: link.address });
      return link;
    }, TX_OPTIONS);
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') throw new AccessError('WALLET_UNAVAILABLE');
    throw e;
  }
}
export async function unlinkWallet(db: PrismaClient, userId: string, id: string, now: Date) {
  return db.$transaction(async tx => {
    await lockUser(tx, userId);
    const link = await tx.linkedWallet.findFirst({ where: { id, userId } });
    if (!link) throw new AccessError('NOT_FOUND', 404);
    await tx.walletLinkChallenge.updateMany({ where: { userId, chain: link.chain, address: link.address, consumedAt: null }, data: { consumedAt: now } });
    await tx.linkedWallet.delete({ where: { id } });
    await audit(tx, userId, 'entitlements.wallet_unlinked', { linkId: id, chain: link.chain, address: link.address });
    // AccessGrant is intentionally untouched: an unlink never frees a user's seat.
  }, TX_OPTIONS);
}
