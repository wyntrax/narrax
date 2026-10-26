import type { PrismaClient } from '@narra/database';
import { DEFAULT_TIER_REQUIREMENTS, TierRequirements, TokenMint, type TierRequirementsValue } from '@narra/shared';
import type { SolanaRpc } from '@narra/solana';
import type { WyntraxMembershipEvent } from '@narra/queue';

/** Local holding rows are namespaced so they can never collide with a membership id issued by Wyntrax. */
export const HOLDING_MEMBERSHIP_PREFIX = 'onchain-holding:';
/** A holding is positive evidence only while it is fresh. The 5-minute job keeps renewing this window. */
export const HOLDING_TTL_MS = 60 * 60_000;
const MAX_DECIMALS = 18;

type Tier = 'NONE' | 'MEMBER' | 'PRO';
type HoldingRpc = Pick<SolanaRpc, 'getMintInfo' | 'getTokenBaseUnits'>;
type StoredHolding = {
  membershipId: string; chain: string; address: string; key: string; seq: bigint;
  validUntil: Date | null; status: string; lastEventId: string; receivedAt: Date; proSince: Date | null; eliteSince: Date | null;
};

/** Convert a human token amount to raw base units without going through floating-point arithmetic. */
export function amountToBaseUnits(amount: number, decimals: number): bigint {
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(decimals) || decimals < 0 || decimals > MAX_DECIMALS) throw new Error('invalid token amount');
  const text = amount.toString();
  if (/[eE]/.test(text)) throw new Error('invalid token amount');
  const [whole, fraction = ''] = text.split('.');
  const padded = (fraction + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(whole + padded);
}

export function holdingTier(balance: bigint, decimals: number, tiers: TierRequirementsValue): Tier {
  if (balance >= amountToBaseUnits(tiers.PRO, decimals)) return 'PRO';
  if (balance >= amountToBaseUnits(tiers.MEMBER, decimals)) return 'MEMBER';
  return 'NONE';
}

async function readHoldingSettings(db: PrismaClient): Promise<{ tokenMint: string | null; tiers: TierRequirementsValue }> {
  const rows = await db.systemSetting.findMany({ where: { key: { in: ['access.token_mint', 'access.tier_requirements'] } } });
  let tokenMint: string | null = null, tiers: TierRequirementsValue = { ...DEFAULT_TIER_REQUIREMENTS };
  for (const row of rows) {
    if (row.key === 'access.token_mint') {
      const parsed = TokenMint.safeParse(row.value);
      if (!parsed.success) throw new Error('invalid token mint setting');
      tokenMint = parsed.data;
    } else {
      const parsed = TierRequirements.safeParse(row.value);
      if (!parsed.success) throw new Error('invalid tier requirement setting');
      tiers = parsed.data;
    }
  }
  return { tokenMint, tiers };
}

function revokedEvent(row: Pick<StoredHolding, 'membershipId' | 'address' | 'key'>, seq: bigint, now: Date): WyntraxMembershipEvent {
  return {
    id: `wyntrax-holding-${row.address}-${seq}`, type: 'membership.revoked', occurredAt: now.toISOString(),
    data: {
      membershipId: row.membershipId, key: row.key === 'PRO' || row.key === 'ELITE' ? row.key : 'MEMBER', chain: 'solana',
      wallet: row.address, seq: Number(seq), validUntil: null, checkedAt: now.toISOString(),
    },
  };
}

async function revokeLocalHolding(db: PrismaClient, row: StoredHolding, now: Date, enqueue: (event: WyntraxMembershipEvent) => Promise<unknown>): Promise<boolean> {
  const seq = row.seq + 1n;
  await db.wyntraxEntitlement.update({
    where: { membershipId_chain_address: { membershipId: row.membershipId, chain: 'solana', address: row.address } },
    data: { status: 'REVOKED', validUntil: null, seq, lastEventId: `holding:revoked:${seq}`, receivedAt: now, proSince: null, eliteSince: null },
  });
  try { await enqueue(revokedEvent(row, seq, now)); return true; } catch { return false; }
}

export async function syncWyntraxHoldings(
  deps: { db: PrismaClient; rpc: HoldingRpc; now: () => Date; enqueue: (event: WyntraxMembershipEvent) => Promise<unknown>; ttlMs?: number },
  options: { userId?: string; concurrency?: number } = {},
): Promise<{ checked: number; active: number; granted: number; revoked: number; rpcFailures: number; eventFailures: number; skipped?: string }> {
  const { db, rpc, enqueue } = deps;
  const now = deps.now(), ttlMs = deps.ttlMs ?? HOLDING_TTL_MS;
  const wallets = await db.linkedWallet.findMany({
    where: { chain: 'solana', ...(options.userId ? { userId: options.userId } : {}) },
    select: { userId: true, address: true }, orderBy: { verifiedAt: 'asc' },
  });
  if (!wallets.length) return { checked: 0, active: 0, granted: 0, revoked: 0, rpcFailures: 0, eventFailures: 0, skipped: 'no_wallets' };

  let settings: Awaited<ReturnType<typeof readHoldingSettings>>;
  try { settings = await readHoldingSettings(db); } catch { return { checked: wallets.length, active: 0, granted: 0, revoked: 0, rpcFailures: 0, eventFailures: 0, skipped: 'invalid_settings' }; }
  const { tokenMint, tiers } = settings;

  const localRows = await db.wyntraxEntitlement.findMany({
    where: { chain: 'solana', membershipId: { startsWith: HOLDING_MEMBERSHIP_PREFIX }, address: { in: wallets.map(w => w.address) }, status: 'ACTIVE' },
  });

  // Clearing the configured mint, or changing it, must not leave old local holdings granting access.
  if (!tokenMint) {
    let revoked = 0, eventFailures = 0;
    for (const row of localRows) {
      if (await revokeLocalHolding(db, row, now, enqueue)) revoked++; else eventFailures++;
    }
    return { checked: wallets.length, active: 0, granted: 0, revoked, rpcFailures: 0, eventFailures, skipped: 'no_mint' };
  }

  let decimals: number;
  try { decimals = (await rpc.getMintInfo(tokenMint)).decimals; } catch { return { checked: wallets.length, active: 0, granted: 0, revoked: 0, rpcFailures: 0, eventFailures: 0, skipped: 'mint_unavailable' }; }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_DECIMALS) return { checked: wallets.length, active: 0, granted: 0, revoked: 0, rpcFailures: 0, eventFailures: 0, skipped: 'invalid_decimals' };

  const membershipId = `${HOLDING_MEMBERSHIP_PREFIX}${tokenMint}`;
  let revoked = 0, eventFailures = 0;
  for (const row of localRows) {
    if (row.membershipId === membershipId) continue;
    if (await revokeLocalHolding(db, row, now, enqueue)) revoked++; else eventFailures++;
  }

  let checked = 0, active = 0, granted = 0, rpcFailures = 0;
  const addresses = [...new Set(wallets.map(w => w.address))];
  let cursor = 0;
  const worker = async () => {
    while (cursor < addresses.length) {
      const address = addresses[cursor++]!;
      checked++;
      let balance: bigint;
      try { balance = await rpc.getTokenBaseUnits(address, tokenMint); } catch { rpcFailures++; continue; }
      const tier = holdingTier(balance, decimals, tiers);
      const existing = await db.wyntraxEntitlement.findUnique({ where: { membershipId_chain_address: { membershipId, chain: 'solana', address } } });
      const currentlyActive = !!existing && existing.status === 'ACTIVE' && !!existing.validUntil && existing.validUntil > now && existing.key !== 'NONE';
      const validUntil = tier === 'NONE' ? null : new Date(now.getTime() + ttlMs);
      const seq = existing ? existing.seq + 1n : BigInt(now.getTime());

      if (tier === 'NONE') {
        if (!currentlyActive || !existing) continue;
        if (await revokeLocalHolding(db, existing, now, enqueue)) revoked++; else eventFailures++;
        continue;
      }

      active++;
      const changed = !currentlyActive || existing!.key !== tier;
      const proSince = tier === 'PRO'
        ? (existing?.status === 'ACTIVE' && existing.proSince && (existing.key === 'PRO' || existing.key === 'ELITE') ? existing.proSince : now)
        : null;
      await db.wyntraxEntitlement.upsert({
        where: { membershipId_chain_address: { membershipId, chain: 'solana', address } },
        create: { membershipId, chain: 'solana', address, key: tier, seq, validUntil, status: 'ACTIVE', lastEventId: `holding:${tokenMint}:${address}:${seq}`, receivedAt: now, proSince, eliteSince: null },
        update: { key: tier, seq, validUntil, status: 'ACTIVE', lastEventId: `holding:${tokenMint}:${address}:${seq}`, receivedAt: now, proSince, eliteSince: null },
      });
      if (!changed) continue;
      const event: WyntraxMembershipEvent = {
        id: `wyntrax-holding-${address}-${seq}`, type: 'membership.granted', occurredAt: now.toISOString(),
        data: { membershipId, key: tier, chain: 'solana', wallet: address, seq: Number(seq), validUntil: validUntil!.toISOString(), checkedAt: now.toISOString() },
      };
      try { await enqueue(event); granted++; } catch { eventFailures++; }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.concurrency ?? 4, addresses.length)) }, worker));
  return { checked, active, granted, revoked, rpcFailures, eventFailures };
}
