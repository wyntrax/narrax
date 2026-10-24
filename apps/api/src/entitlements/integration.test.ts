import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import bs58 from 'bs58';
import { createPrisma, Prisma, type PrismaClient } from '@narra/database';
import { resolveEntitlements } from '@narra/shared';
import { buildApp } from '../app';
import * as proof from './crypto';
import { createWalletChallenge, unlinkWallet, verifyWalletChallenge } from './linking';
import { grantEarlyAccess, revokeLocalGrant } from './grants';
import { updateLocalSettings } from './settings';
import { applyWyntraxEvent } from './membershipStore';
import { VECTOR_BODY } from './fixtures.test-support';

// Unlike legacy tests, missing/wrong scratch services are failures, never skips or production fallbacks.
import { assertTestDatabase } from '../../../../scripts/test-database';
const url = new URL(process.env.DATABASE_URL ?? 'invalid:');
assertTestDatabase(url);
const db = createPrisma(url.toString());
const tag = `ent-${randomUUID()}`;
const now = new Date('2026-10-07T12:00:00Z'), later = new Date(+now + 3_600_000);
const clock = () => now;
const users: string[] = [], members: string[] = [], eventIds: string[] = [];
let admin: string;
let seq = 0;
const address = () => bs58.encode(Buffer.from(proof.hash(`${tag}:${++seq}`), 'hex'));
const settingsKeys = ['early_access.enabled', 'early_access.seat_cap', 'early_access.invite_required', 'entitlements.wallet_link_domain'];
let oldSettings: Awaited<ReturnType<typeof db.systemSetting.findMany>>;
async function user(isAdmin = false) {
  const row = await db.user.create({ data: { privyUserId: `${tag}-${++seq}`, isAdmin } }); users.push(row.id); return row.id;
}
async function linkedUser() { const id = await user(); await db.linkedWallet.create({ data: { userId: id, chain: 'solana', address: address(), verifiedAt: now } }); return id; }
async function configure(cap = 100) { await updateLocalSettings(db, admin, { 'early_access.enabled': true, 'early_access.seat_cap': cap, 'early_access.invite_required': false, 'entitlements.wallet_link_domain': 'https://narrax.example' }, 'test configuration'); }
async function clearGrants() { await db.accessGrant.deleteMany({ where: { userId: { in: users } } }); }
const grant = (id: string, actor: string | null = null, tier = 'EARLY_ACCESS') => grantEarlyAccess(db, id, { tier, validUntil: actor ? later : null, reason: 'test join' }, actor, now);
async function challenge(id: string, addr = address()) { return { ...(await createWalletChallenge(db, id, { chain: 'solana', address: addr }, clock)), address: addr }; }
const verification = (c: { challengeId: string; message: string }) => ({ challengeId: c.challengeId, message: c.message, signature: 'fixture-proof' });
function event(sequence = 1, membershipId = `${tag}-member-${++seq}`) {
  const e = JSON.parse(VECTOR_BODY); e.id = `${tag}-event-${++seq}`; e.data.seq = sequence; e.data.membershipId = membershipId;
  members.push(membershipId); eventIds.push(e.id); return e;
}
beforeAll(async () => { oldSettings = await db.systemSetting.findMany({ where: { key: { in: settingsKeys } } }); admin = await user(true); await configure(); });
afterAll(async () => {
  vi.restoreAllMocks();
  await db.auditLog.deleteMany({ where: { OR: [{ userId: { in: users } }, { detail: { path: ['membershipId'], string_starts_with: tag } }, { detail: { path: ['eventId'], string_starts_with: tag } }] } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.webhookEvent.deleteMany({ where: { id: { in: eventIds } } });
  await db.wyntraxEntitlement.deleteMany({ where: { membershipId: { in: members } } });
  await db.systemSetting.deleteMany({ where: { key: { in: settingsKeys } } });
  for (const row of oldSettings) await db.systemSetting.create({ data: { ...row, value: row.value === null ? Prisma.JsonNull : row.value as Prisma.InputJsonValue } });
  await db.$disconnect();
});

describe('wallet linking on real scratch PostgreSQL (proof success is a fake; crypto vectors tested separately)', () => {
  it('binds domain, nonce, user, address and timestamps; rejects wrong user/message/address/signature and expiry', async () => {
    const id = await user(), other = await user(), c = await challenge(id);
    for (const text of ['https://narrax.example', id, c.address, 'Nonce:', now.toISOString(), new Date(+now + 300_000).toISOString()]) expect(c.message).toContain(text);
    await expect(verifyWalletChallenge(db, other, verification(c), clock)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(verifyWalletChallenge(db, id, { ...verification(c), message: c.message.replace(c.address, address()) }, clock)).rejects.toMatchObject({ code: 'INVALID_WALLET_PROOF' });
    await expect(verifyWalletChallenge(db, id, verification(c), clock)).rejects.toMatchObject({ code: 'INVALID_WALLET_PROOF' });
    await expect(verifyWalletChallenge(db, id, verification(c), () => new Date(+now + 300_000))).rejects.toMatchObject({ code: 'CHALLENGE_UNAVAILABLE' });
    expect((await db.walletLinkChallenge.findUniqueOrThrow({ where: { id: c.challengeId } })).consumedAt).toBeNull();
  });
  it('one nonce wins concurrent verification, and no signature is persisted', async () => {
    const id = await user(), c = await challenge(id);
    const verify = vi.spyOn(proof, 'verifyWalletProof').mockReturnValue(true);
    try {
      const results = await Promise.allSettled([1, 2, 3].map(() => verifyWalletChallenge(db, id, verification(c), clock)));
      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
      expect(await db.linkedWallet.count({ where: { userId: id } })).toBe(1);
      const stored = await db.walletLinkChallenge.findUniqueOrThrow({ where: { id: c.challengeId } });
      expect(stored.consumedAt).toEqual(now); expect(JSON.stringify(stored)).not.toContain('fixture-proof');
      expect(await db.auditLog.count({ where: { userId: id, action: 'entitlements.wallet_linked' } })).toBe(1);
    } finally { verify.mockRestore(); }
  });
  it('enforces unique wallet ownership, invalidates old proofs on unlink, and permits fresh relink', async () => {
    const a = await user(), b = await user(), addr = address();
    const ca = await challenge(a, addr), cb = await challenge(b, addr);
    const verify = vi.spyOn(proof, 'verifyWalletProof').mockReturnValue(true);
    try {
      const link = await verifyWalletChallenge(db, a, verification(ca), clock);
      await expect(verifyWalletChallenge(db, b, verification(cb), clock)).rejects.toMatchObject({ code: 'WALLET_UNAVAILABLE' });
      const old = await challenge(a, addr);
      await expect(unlinkWallet(db, b, link.id, now)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await unlinkWallet(db, a, link.id, now);
      await expect(verifyWalletChallenge(db, a, verification(old), clock)).rejects.toMatchObject({ code: 'CHALLENGE_UNAVAILABLE' });
      const fresh = await challenge(b, addr);
      expect((await verifyWalletChallenge(db, b, verification(fresh), clock)).userId).toBe(b);
      expect(await db.auditLog.count({ where: { userId: a, action: 'entitlements.wallet_unlinked' } })).toBe(1);
    } finally { verify.mockRestore(); }
  });
  it('five-link limit survives parallel claims for a last slot', async () => {
    const id = await user();
    for (let i = 0; i < 4; i++) await db.linkedWallet.create({ data: { userId: id, chain: 'solana', address: address(), verifiedAt: now } });
    const cs = await Promise.all([1, 2, 3].map(() => challenge(id)));
    const verify = vi.spyOn(proof, 'verifyWalletProof').mockReturnValue(true);
    try {
      const results = await Promise.allSettled(cs.map(c => verifyWalletChallenge(db, id, verification(c), clock)));
      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
      expect(await db.linkedWallet.count({ where: { userId: id } })).toBe(5);
      await expect(challenge(id)).rejects.toMatchObject({ code: 'WALLET_LIMIT' });
    } finally { verify.mockRestore(); }
  });
  it('replaces challenges, bounds outstanding nonces and invalidates a changed domain', async () => {
    const id = await user(), first = await challenge(id), replacement = await challenge(id, first.address);
    await expect(verifyWalletChallenge(db, id, verification(first), clock)).rejects.toMatchObject({ code: 'CHALLENGE_UNAVAILABLE' });
    for (let i = 0; i < 4; i++) await challenge(id);
    await expect(challenge(id)).rejects.toMatchObject({ code: 'CHALLENGE_LIMIT' });
    await updateLocalSettings(db, admin, { 'entitlements.wallet_link_domain': 'https://new.example' }, 'rotate domain');
    await expect(verifyWalletChallenge(db, id, verification(replacement), clock)).rejects.toMatchObject({ code: 'CHALLENGE_UNAVAILABLE' });
    await configure();
  });
  it('HTTP requires authentication, returns repo errors, hides other links and supports unlink', async () => {
    const id = await linkedUser(), other = await user();
    const app = await buildApp({ account: { db, verifier: { verify: async token => { if (!users.includes(token)) throw Error('invalid'); return { privyUserId: (await db.user.findUniqueOrThrow({ where: { id: token } })).privyUserId }; } }, now: clock } });
    try {
      expect((await app.inject({ method: 'POST', url: '/v1/me/linked-wallets/challenge', payload: {} })).statusCode).toBe(401);
      const bad = await app.inject({ method: 'POST', url: '/v1/me/linked-wallets/challenge', headers: { authorization: `Bearer ${id}` }, payload: { chain: 'solana', address: '0'.repeat(32) } });
      expect(bad.statusCode).toBe(400); expect(bad.json()).toMatchObject({ error: 'INVALID_INPUT', requestId: expect.any(String) });
      const list = await app.inject({ url: '/v1/me/linked-wallets', headers: { authorization: `Bearer ${id}` } });
      expect(list.json().items).toHaveLength(1);
      expect((await app.inject({ url: '/v1/me/linked-wallets', headers: { authorization: `Bearer ${other}` } })).json().items).toEqual([]);
      expect((await app.inject({ method: 'DELETE', url: `/v1/me/linked-wallets/${list.json().items[0].id}`, headers: { authorization: `Bearer ${id}` } })).statusCode).toBe(200);
    } finally { await app.close(); }
  }, 20_000);
});

describe('atomic seats and restricted manual grants (services; HTTP administration waits for Stage 4)', () => {
  it('serializes concurrent final-seat joins and preserves users when cap is lowered', async () => {
    await clearGrants(); await configure(2);
    const ids = await Promise.all(Array.from({ length: 8 }, () => linkedUser()));
    const results = await Promise.allSettled(ids.map(id => grant(id)));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(2);
    const winners = await db.accessGrant.findMany({ where: { userId: { in: ids }, status: 'ACTIVE' } });
    expect(winners).toHaveLength(2);
    await updateLocalSettings(db, admin, { 'early_access.seat_cap': 0 }, 'lower cap');
    for (const row of winners) {
      expect((await grant(row.userId)).id).toBe(row.id);
      const linkedWallets = await db.linkedWallet.findMany({ where: { userId: row.userId } });
      expect(resolveEntitlements({ userId: row.userId, linkedWallets, grants: [row], memberships: [], earlyAccessEnabled: true }, now).effectiveTier).toBe('EARLY_ACCESS');
    }
    await expect(grant(await linkedUser())).rejects.toMatchObject({ code: 'EARLY_ACCESS_FULL' });
  });
  it('multiple wallets, ADMIN source and paid membership still consume one user seat; unlink frees none', async () => {
    await clearGrants(); await configure(1);
    const id = await linkedUser(), row = await grant(id);
    await db.linkedWallet.create({ data: { userId: id, chain: 'solana', address: address(), verifiedAt: now } });
    await grant(id, admin);
    const links = await db.linkedWallet.findMany({ where: { userId: id } });
    const e = event(); e.data.wallet = links[0]!.address;
    await applyWyntraxEvent(db, e, proof.hash(JSON.stringify(e)), now);
    for (const link of links) await unlinkWallet(db, id, link.id, now);
    expect((await db.accessGrant.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('ACTIVE');
    await expect(grant(await linkedUser())).rejects.toMatchObject({ code: 'EARLY_ACCESS_FULL' });
  });
  it('rejects paid admin grants, unauthorized actors, arbitrary settings and self-revocation of ADMIN; audits every mutation', async () => {
    await clearGrants(); await configure();
    const id = await linkedUser();
    for (const tier of ['MEMBER', 'PRO', 'ELITE', 'NONE']) await expect(grant(id, admin, tier)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(grant(id, id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(updateLocalSettings(db, admin, { 'executor.killSwitch': false }, 'attack')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const row = await grant(id, admin);
    await expect(revokeLocalGrant(db, id, row.id, null, 'self', now)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await revokeLocalGrant(db, id, row.id, admin, 'admin revoke', now);
    const logs = await db.auditLog.findMany({ where: { userId: admin, detail: { path: ['grantId'], equals: row.id } } });
    expect(logs.map(r => r.action).sort()).toEqual(['entitlements.granted', 'entitlements.revoked']);
    expect(await db.accessGrant.count({ where: { userId: id, status: 'ACTIVE' } })).toBe(0);
  });
  it('disabled, invite-required, wallet missing and expiration fail closed; revoked seat can be reused', async () => {
    await clearGrants(); await configure(1);
    const id = await linkedUser(), other = await linkedUser();
    await expect(grant(await user())).rejects.toMatchObject({ code: 'VERIFIED_WALLET_REQUIRED' });
    await updateLocalSettings(db, admin, { 'early_access.enabled': false }, 'disable');
    await expect(grant(id)).rejects.toMatchObject({ code: 'EARLY_ACCESS_DISABLED' });
    await updateLocalSettings(db, admin, { 'early_access.enabled': true, 'early_access.invite_required': true }, 'invite required');
    await expect(grant(id)).rejects.toMatchObject({ code: 'INVITES_UNAVAILABLE' });
    await configure(1);
    const row = await grant(id); await revokeLocalGrant(db, id, row.id, null, 'leave', now);
    expect((await grant(other)).status).toBe('ACTIVE');
    await clearGrants();
  });
});

describe('transactional membership ordering/idempotency', () => {
  it('duplicate, stale and equal-seq-different-ID never refresh state; newer revocation persists a tombstone', async () => {
    const e = event(3), digest = proof.hash(JSON.stringify(e));
    expect(await applyWyntraxEvent(db, e, digest, now)).toBe('applied');
    expect(await applyWyntraxEvent(db, e, digest, now)).toBe('duplicate');
    for (const sequence of [2, 3]) { const lower = event(sequence, e.data.membershipId); lower.data.key = 'ELITE'; expect(await applyWyntraxEvent(db, lower, proof.hash(JSON.stringify(lower)), now)).toBe('stale'); }
    expect((await db.wyntraxEntitlement.findFirstOrThrow({ where: { membershipId: e.data.membershipId } })).key).toBe('PRO');
    const revoke = event(4, e.data.membershipId); revoke.type = 'membership.revoked'; revoke.data.validUntil = null;
    expect(await applyWyntraxEvent(db, revoke, proof.hash(JSON.stringify(revoke)), now)).toBe('applied');
    expect((await db.wyntraxEntitlement.findFirstOrThrow({ where: { membershipId: e.data.membershipId } })).status).toBe('REVOKED');
    expect(await applyWyntraxEvent(db, e, digest, now)).toBe('duplicate');
  });
  it('concurrent first-insert sequences end at the greatest seq for the same membership/wallet', async () => {
    const id = `${tag}-race`, events = [5, 1, 4, 2, 3].map(v => event(v, id));
    await Promise.all(events.map(e => applyWyntraxEvent(db, e, proof.hash(JSON.stringify(e)), now)));
    const row = await db.wyntraxEntitlement.findFirstOrThrow({ where: { membershipId: id } });
    expect(row.seq).toBe(5n); expect(row.address).toEqual(events[0]!.data.wallet);
    const e = event(6, id);
    expect((await Promise.all(Array.from({ length: 5 }, () => applyWyntraxEvent(db, e, proof.hash(JSON.stringify(e)), now)))).sort()).toEqual(['applied', 'duplicate', 'duplicate', 'duplicate', 'duplicate']);
  });
  it('same event ID cannot update a different member', async () => {
    const a = event(), b = event(); b.id = a.id;
    const result = await Promise.all([a, b].map(e => applyWyntraxEvent(db, e, proof.hash(JSON.stringify(e)), now)));
    expect(result.sort()).toEqual(['applied', 'duplicate']);
    expect(await db.wyntraxEntitlement.count({ where: { membershipId: { in: [a.data.membershipId, b.data.membershipId] } } })).toBe(1);
  });
  it('a failed audit rolls back receipt and membership so redelivery can succeed', async () => {
    const e = event();
    const broken = { $transaction: (work: (tx: unknown) => unknown, options: unknown) => db.$transaction(tx => work(new Proxy(tx, { get(target, property) { if (property === 'auditLog') return { create: () => { throw Error('injected failure'); } }; return Reflect.get(target, property); } })) as never, options as never) } as unknown as PrismaClient;
    await expect(applyWyntraxEvent(broken, e, proof.hash(JSON.stringify(e)), now)).rejects.toThrow('injected failure');
    expect(await db.webhookEvent.findUnique({ where: { id: e.id } })).toBeNull();
    expect(await db.wyntraxEntitlement.findFirst({ where: { membershipId: e.data.membershipId } })).toBeNull();
    expect(await applyWyntraxEvent(db, e, proof.hash(JSON.stringify(e)), now)).toBe('applied');
  });
});

describe('non-escalation: guarded capabilities plus real database snapshots', () => {
  it('all implemented entitlement mutations leave trading authority, execution and risk unchanged', async () => {
    await clearGrants(); await configure();
    const id = await user();
    await db.tradingPermission.create({ data: { userId: id, aiTradingEnabled: false, agentPaused: true } });
    await db.riskProfile.create({ data: { userId: id } });
    await db.wallet.create({ data: { userId: id, kind: 'MAIN', address: address() } });
    const protectedState = async () => ({
      users: await db.user.findMany({ where: { id: { in: [id, admin] } }, select: { id: true, mode: true, isAdmin: true }, orderBy: { id: 'asc' } }),
      permission: await db.tradingPermission.findUnique({ where: { userId: id } }), risk: await db.riskProfile.findUnique({ where: { userId: id } }),
      wallets: await db.wallet.findMany({ where: { userId: id } }),
      settings: await db.systemSetting.findMany({ where: { key: { notIn: settingsKeys } }, orderBy: { key: 'asc' } }),
      orders: await db.order.findMany({ where: { userId: id } }), trades: await db.trade.findMany({ where: { userId: id } }), positions: await db.position.findMany({ where: { userId: id } }),
      confirmations: await db.pendingConfirmation.findMany({ where: { userId: id } }), dryRuns: await db.dryRun.findMany({ where: { userId: id } }),
      executorAllowlist: process.env.EXECUTOR_ALLOWLIST_USER_IDS,
    });
    const before = await protectedState();
    const forbidden = vi.fn((name: string): never => { throw Error(`Forbidden entitlement capability: ${name}`); });
    const writable = new Set(['linkedWallet', 'walletLinkChallenge', 'accessGrant', 'wyntraxEntitlement', 'webhookEvent', 'auditLog']);
    const guarded = { $transaction: (work: (tx: Prisma.TransactionClient) => Promise<unknown>, options: unknown) => db.$transaction(async tx => work(new Proxy(tx, {
      get(target, property) {
        const key = String(property);
        if (key === '$executeRaw') return target.$executeRaw.bind(target);
        if (writable.has(key)) return Reflect.get(target, property);
        if (key === 'user') return { findUnique: (args: { select: Record<string, unknown> }) => { if (!args.select || Object.keys(args.select).some(k => k !== 'isAdmin' && k !== 'id')) return forbidden('User fields'); return target.user.findUnique(args as never); } };
        if (key === 'systemSetting') return new Proxy(target.systemSetting, { get(delegate, method) {
          if (method === 'findMany' || method === 'findUnique') return Reflect.get(delegate, method).bind(delegate);
          if (method === 'upsert') return (args: { where: { key: string } }) => { if (!settingsKeys.includes(args.where.key)) return forbidden('setting key'); return delegate.upsert(args as never); };
          return forbidden(`systemSetting.${String(method)}`);
        } });
        return forbidden(key);
      },
    })), options as never) } as unknown as PrismaClient;
    await updateLocalSettings(guarded, admin, { 'early_access.seat_cap': 100 }, 'non-escalation');
    for (const key of ['executor.kill_switch', 'risk.system_limits', 'trading.paused']) await expect(updateLocalSettings(guarded, admin, { [key]: true }, 'forbidden')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const c = await createWalletChallenge(guarded, id, { chain: 'solana', address: address() }, clock);
    const verify = vi.spyOn(proof, 'verifyWalletProof').mockReturnValue(true);
    try {
      const link = await verifyWalletChallenge(guarded, id, verification(c), clock);
      const local = await grantEarlyAccess(guarded, id, { tier: 'EARLY_ACCESS', validUntil: null, reason: 'join' }, null, now);
      const manual = await grantEarlyAccess(guarded, id, { tier: 'EARLY_ACCESS', validUntil: later, reason: 'manual' }, admin, now);
      const member = `${tag}-isolation`;
      for (const [i, tier] of ['MEMBER', 'PRO', 'ELITE', 'NONE'].entries()) {
        const e = event(i + 1, member); e.data.key = tier === 'NONE' ? 'ELITE' : tier; e.data.wallet = link.address;
        if (tier === 'NONE') { e.type = 'membership.revoked'; e.data.validUntil = null; }
        await applyWyntraxEvent(guarded, e, proof.hash(JSON.stringify(e)), now);
        await applyWyntraxEvent(guarded, e, proof.hash(JSON.stringify(e)), now);
      }
      const stale = event(1, member); await applyWyntraxEvent(guarded, stale, proof.hash(JSON.stringify(stale)), now);
      await revokeLocalGrant(guarded, id, local.id, null, 'leave', now);
      await revokeLocalGrant(guarded, id, manual.id, admin, 'revoke', now);
      await unlinkWallet(guarded, id, link.id, now);
    } finally { verify.mockRestore(); }
    expect(forbidden).not.toHaveBeenCalled();
    expect(await protectedState()).toEqual(before);
  });
});
