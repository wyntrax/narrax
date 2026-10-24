import { randomBytes, randomUUID } from 'node:crypto';
import bs58 from 'bs58';
import { afterAll, expect, it } from 'vitest';
import { createPrisma } from '@narra/database';
import { resolveEntitlements } from '@narra/shared';
import { applyWyntraxEvent } from './membershipStore';
import { sweepExpired } from './expiry';
import { hash } from './crypto';
import { assertTestDatabase } from '../../../../scripts/test-database';
const target = new URL(process.env.DATABASE_URL ?? 'invalid:');
assertTestDatabase(target);
const db = createPrisma(target.toString()), tag = `membership-${randomUUID()}`, now = new Date('2026-10-09T00:00:00Z'), hour = 3600000;
const users: string[] = []; let count = 0;
const address = () => bs58.encode(randomBytes(32));
function event(membershipId: string, wallet: string, key = 'PRO', seq = 1, type = 'membership.granted', at = now, expiry = new Date(+at + 6 * hour)) {
  return { id: `${tag}-${++count}`, type, occurredAt: at.toISOString(), data: { membershipId: `${tag}-${membershipId}`, chain: 'solana', wallet, key, seq, checkedAt: at.toISOString(), validUntil: type === 'membership.granted' ? expiry.toISOString() : null } };
}
const apply = (e: ReturnType<typeof event>, at = now) => applyWyntraxEvent(db, e, hash(JSON.stringify(e)), at);
const load = (e: ReturnType<typeof event>) => db.wyntraxEntitlement.findUniqueOrThrow({ where: { membershipId_chain_address: { membershipId: e.data.membershipId, chain: 'solana', address: e.data.wallet } } });
afterAll(async () => {
  await db.webhookEvent.deleteMany({ where: { membershipId: { startsWith: tag } } });
  await db.wyntraxEntitlement.deleteMany({ where: { membershipId: { startsWith: tag } } });
  await db.auditLog.deleteMany({ where: { OR: [{ detail: { path: ['membershipId'], string_starts_with: tag } }, { detail: { path: ['userId'], string_starts_with: tag } }] } });
  await db.user.deleteMany({ where: { id: { in: users } } }); await db.$disconnect();
});
it('independent memberships and linked wallets choose the highest unexpired key and fall back on revocation', async () => {
  const wallet = address(), other = address();
  const member = event('member', wallet, 'MEMBER'), pro = event('pro', wallet), elite = event('elite', other, 'ELITE');
  await Promise.all([member, pro, elite].map(e => apply(e)));
  const tier = async (at = now) => resolveEntitlements({ userId: 'u', linkedWallets: [wallet, other].map(address => ({ userId: 'u', chain: 'solana', address, verifiedAt: now })), grants: [], memberships: await db.wyntraxEntitlement.findMany({ where: { membershipId: { in: [member,pro,elite].map(e=>e.data.membershipId) } } }), earlyAccessEnabled: false }, at).effectiveTier;
  expect(await tier()).toBe('PRO');
  await apply(event('elite', other, 'ELITE', 2, 'membership.revoked')); expect(await tier()).toBe('PRO');
  await apply(event('pro', wallet, 'PRO', 2, 'membership.revoked')); expect(await tier()).toBe('MEMBER');
  expect(await tier(new Date(+now + 6 * hour))).toBe('NONE');
  expect((await load(member)).seq).toBe(1n);
});
it('synthetic test receipts dedupe without creating or advancing entitlement state', async () => {
  const wallet = address(), initial = event('test', wallet); await apply(initial);
  const before = await load(initial), test = event('test', wallet, 'ELITE', 1000, 'membership.test');
  expect(await apply(test)).toBe('test'); expect(await apply(test)).toBe('duplicate'); expect(await load(initial)).toEqual(before);
  const absent = event('test-absent', address(), 'MEMBER', 1, 'membership.test'); expect(await apply(absent)).toBe('test');
  expect(await db.wyntraxEntitlement.count({ where: { membershipId: absent.data.membershipId } })).toBe(0);
  expect(await apply(event('test', wallet, 'PRO', 2))).toBe('applied');
});
it('renewal and overlapping grants preserve age; tier upgrade and expiry gap reset only affected continuity', async () => {
  const wallet = address(), first = event('age', wallet); await apply(first);
  const later = new Date(+now + hour), renewal = event('age', wallet, 'PRO', 2, 'membership.granted', later);
  await apply(renewal, later); expect((await load(first)).proSince).toEqual(now);
  const upgrade = event('age', wallet, 'ELITE', 3, 'membership.granted', later); await apply(upgrade, later);
  expect(await load(first)).toMatchObject({ proSince: now, eliteSince: later });
  const overlap = event('age-overlap', wallet, 'ELITE', 1, 'membership.granted', later); await apply(overlap, later);
  await apply(event('age', wallet, 'ELITE', 4, 'membership.revoked', later), later);
  expect(await load(overlap)).toMatchObject({ proSince: now, eliteSince: later });
  const gap = new Date(+later + 7 * hour), renewed = event('age-overlap', wallet, 'ELITE', 2, 'membership.granted', gap);
  await apply(renewed, gap); expect(await load(overlap)).toMatchObject({ proSince: gap, eliteSince: gap });
});
it('sequences are scoped to membership/chain/wallet and stale revocations cannot revoke newer grants', async () => {
  const wallet = address(), other = address(), current = event('sequence', wallet, 'PRO', 50);
  await apply(current); expect(await apply(event('sequence', wallet, 'PRO', 49, 'membership.revoked'))).toBe('stale');
  expect(await apply(event('sequence', other, 'MEMBER', 1))).toBe('applied');
  expect(await load(current)).toMatchObject({ seq: 50n, status: 'ACTIVE' });
});
it('standalone expiry expires local grants, removes old challenges and retains fresh challenges and grant tombstones', async () => {
  const id = `${tag}-user`, u = await db.user.create({ data: { id, privyUserId: id } }); users.push(u.id);
  const grant = await db.accessGrant.create({ data: { userId: id, source: 'EARLY_ACCESS', validUntil: now } });
  const challenge = (old: boolean) => ({ userId: id, chain: 'solana' as const, address: address(), domain: 'https://example.com', nonceHash: randomUUID(), messageHash: randomUUID(), issuedAt: now, expiresAt: new Date(+now + (old ? -2 * 86400000 : hour)) });
  const old = await db.walletLinkChallenge.create({ data: challenge(true) }), fresh = await db.walletLinkChallenge.create({ data: challenge(false) });
  await sweepExpired(db, now);
  expect((await db.accessGrant.findUniqueOrThrow({ where: { id: grant.id } })).status).toBe('EXPIRED');
  expect(await db.walletLinkChallenge.findUnique({ where: { id: old.id } })).toBeNull();
  expect(await db.walletLinkChallenge.findUnique({ where: { id: fresh.id } })).not.toBeNull();
});
