import { createHmac, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { ed25519 } from '@noble/curves/ed25519';
import bs58 from 'bs58';
import { generateKeyPair, exportSPKI, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPrisma, Prisma } from '@narra/database';
import { resolveEntitlements } from '@narra/shared';
import { buildApp } from '../app';
import { createPrivyVerifier } from '../auth';
import { applyWyntraxEvent } from './membershipStore';
import { hash } from './crypto';
import { VECTOR_BODY, VECTOR_SECRET } from './fixtures.test-support';

import { assertTestDatabase } from '../../../../scripts/test-database';
const target = new URL(process.env.DATABASE_URL ?? 'invalid:');
assertTestDatabase(target);
const db = createPrisma(target.toString());
const tag = `add-${randomUUID()}`, users: string[] = [], members: string[] = [], events: string[] = [];
let seq = 0, now = new Date();
let app: Awaited<ReturnType<typeof buildApp>>, original: Awaited<ReturnType<typeof db.systemSetting.findUnique>>;
const jwtKeys = await generateKeyPair('ES256');
const verifier = createPrivyVerifier({ appId: 'narra-test', verificationKey: await exportSPKI(jwtKeys.publicKey) });
const key = () => { const secret = ed25519.utils.randomPrivateKey(); return { secret, address: bs58.encode(ed25519.getPublicKey(secret)) }; };
async function actor() {
  const sub = `${tag}-${++seq}`; const u = await db.user.create({ data: { privyUserId: sub } }); users.push(u.id);
  const token = await new SignJWT({}).setProtectedHeader({ alg: 'ES256' }).setIssuer('privy.io').setAudience('narra-test').setSubject(sub).setIssuedAt().setExpirationTime('1h').sign(jwtKeys.privateKey);
  return { id: u.id, headers: { authorization: `Bearer ${token}` } };
}
function event(address: string, version = 1, member = `${tag}-member-${++seq}`) {
  const e = JSON.parse(VECTOR_BODY); e.id = `${tag}-event-${++seq}`; e.data.seq = version; e.data.membershipId = member;
  e.data.wallet = address; e.data.validUntil = new Date(+now + 86400000).toISOString();
  events.push(e.id); members.push(member); return e;
}
const signed = (body: string, timestamp = String(Math.floor(+now / 1000))) => ({ 'content-type': 'application/json', 'x-wyntrax-timestamp': timestamp, 'x-wyntrax-signature': 'v1=' + createHmac('sha256', VECTOR_SECRET).update(timestamp + '.').update(body).digest('hex') });
const post = (e: any) => app.inject({ method: 'POST', url: '/v1/integrations/wyntrax/events', remoteAddress: `192.0.2.${++seq % 200 + 1}`, payload: JSON.stringify(e), headers: { ...signed(JSON.stringify(e)), 'x-wyntrax-event-id': e.id } });
async function challenge(u: Awaited<ReturnType<typeof actor>>, address: string) {
  const r = await app.inject({ method: 'POST', url: '/v1/me/linked-wallets/challenge', remoteAddress: `198.51.100.${++seq % 200 + 1}`, headers: u.headers, payload: { chain: 'solana', address } });
  expect(r.statusCode).toBe(200); const { challengeId, message } = r.json(); return { challengeId, message } as { challengeId: string; message: string };
}
const verify = (u: Awaited<ReturnType<typeof actor>>, c: { challengeId: string; message: string }, signature: string) => app.inject({ method: 'POST', url: '/v1/me/linked-wallets/verify', remoteAddress: `198.51.100.${++seq % 200 + 1}`, headers: u.headers, payload: { ...c, signature } });
const signature = (k: ReturnType<typeof key>, message: string) => bs58.encode(ed25519.sign(Buffer.from(message), k.secret)); // test-only, explicitly approved at B
async function tier(userId: string) {
  return resolveEntitlements({ userId, linkedWallets: await db.linkedWallet.findMany({ where: { userId } }), grants: [], memberships: await db.wyntraxEntitlement.findMany({ where: { membershipId: { in: members } } }), earlyAccessEnabled: false }, now).effectiveTier;
}
beforeAll(async () => {
  original = await db.systemSetting.findUnique({ where: { key: 'entitlements.wallet_link_domain' } });
  await db.systemSetting.upsert({ where: { key: 'entitlements.wallet_link_domain' }, create: { key: 'entitlements.wallet_link_domain', value: 'https://narra.example' }, update: { value: 'https://narra.example' } });
  app = await buildApp({ account: { db, verifier, now: () => now }, wyntrax: { db, secret: VECTOR_SECRET, now: () => now } });
}, 20000);
afterAll(async () => {
  await app.close();
  await db.auditLog.deleteMany({ where: { OR: [{ userId: { in: users } }, { detail: { path: ['membershipId'], string_starts_with: tag } }, { detail: { path: ['eventId'], string_starts_with: tag } }] } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.webhookEvent.deleteMany({ where: { id: { in: events } } });
  await db.wyntraxEntitlement.deleteMany({ where: { membershipId: { in: members } } });
  await db.systemSetting.delete({ where: { key: 'entitlements.wallet_link_domain' } });
  if (original) await db.systemSetting.create({ data: { ...original, value: original.value === null ? Prisma.JsonNull : original.value as Prisma.InputJsonValue } });
  await db.$disconnect();
});
describe('Checkpoint B addendum: real signatures and persistence', () => {
  it('real challenge -> ed25519 verify -> link -> webhook -> entitlement, with real JWT verification and no faked proof', async () => {
    const u = await actor(), k = key(), c = await challenge(u, k.address), sig = signature(k, c.message);
    const linked = await verify(u, c, sig); expect(linked.statusCode).toBe(200);
    expect((await post(event(k.address))).json()).toEqual({ ok: true, status: 'applied' });
    expect(await tier(u.id)).toBe('PRO');
    expect((await verify(u, c, sig)).statusCode).toBe(409);
    const logs = JSON.stringify(await db.auditLog.findMany({ where: { OR: [{ userId: u.id }, { detail: { path: ['membershipId'], string_starts_with: tag } }] } }));
    for (const sensitive of [VECTOR_SECRET, sig, /^Nonce: (.+)$/m.exec(c.message)![1]!, c.message]) expect(logs).not.toContain(sensitive);
  });
  it('rejects another key, modified message, wrong user/domain/address and an expired genuine proof', async () => {
    const u = await actor(), other = await actor(), k = key(), c = await challenge(u, k.address);
    expect((await verify(u, c, signature(key(), c.message))).statusCode).toBe(401);
    expect((await verify(u, c, signature(k, c.message + 'modified'))).statusCode).toBe(401);
    expect((await verify(other, c, signature(k, c.message))).statusCode).toBe(404);
    for (const message of [c.message.replace('https://narra.example', 'https://evil.example'), c.message.replace(k.address, key().address)]) expect((await verify(u, { ...c, message }, signature(k, message))).statusCode).toBe(401);
    const before = now; now = new Date(+now + 300000);
    try { expect((await verify(u, c, signature(k, c.message))).statusCode).toBe(409); } finally { now = before; }
    expect(await db.linkedWallet.count({ where: { userId: u.id } })).toBe(0);
  });
  it('two users simultaneously proving the same address: one 200, one clean 409, unique owner', async () => {
    const a = await actor(), b = await actor(), k = key(), ca = await challenge(a, k.address), cb = await challenge(b, k.address);
    const results = await Promise.all([verify(a, ca, signature(k, ca.message)), verify(b, cb, signature(k, cb.message))]);
    expect(results.map(r => r.statusCode).sort()).toEqual([200, 409]);
    expect(results.find(r => r.statusCode === 409)!.json().error).toBe('WALLET_UNAVAILABLE');
    expect(await db.linkedWallet.count({ where: { chain: 'solana', address: k.address } })).toBe(1);
  });
  it('unlinked membership is stored without a grant, activates after proof, and unlink removes access immediately', async () => {
    const u = await actor(), k = key(), e = event(k.address);
    expect((await post(e)).statusCode).toBe(200); expect(await tier(u.id)).toBe('NONE');
    const c = await challenge(u, k.address), link = await verify(u, c, signature(k, c.message));
    expect(link.statusCode).toBe(200); expect(await tier(u.id)).toBe('PRO');
    expect((await app.inject({ method: 'DELETE', url: `/v1/me/linked-wallets/${link.json().id}`, headers: u.headers })).statusCode).toBe(200);
    expect(await tier(u.id)).toBe('NONE');
  });
  it('parallel sequences always end at the higher seq and committed sequences never decrease', async () => {
    const k = key(), high = event(k.address, 8), low = event(k.address, 7, high.data.membershipId);
    const trace: bigint[] = [];
    const dbTrace = { $transaction: (work: any, opts: any) => db.$transaction(async tx => work(new Proxy(tx, { get(t, p) {
      if (p === 'wyntraxEntitlement') return new Proxy(t.wyntraxEntitlement, { get(d, op) { if (op === 'upsert') return async (args: any) => { const row = await d.upsert(args); trace.push(row.seq); return row; }; return Reflect.get(d, op); } });
      return Reflect.get(t, p);
    } })), opts) } as typeof db;
    await Promise.all([low, high].map(e => applyWyntraxEvent(dbTrace, e, hash(JSON.stringify(e)), now)));
    expect((await db.wyntraxEntitlement.findFirstOrThrow({ where: { membershipId: high.data.membershipId } })).seq).toBe(8n);
    expect(trace.every((v, i) => i === 0 || v > trace[i - 1]!)).toBe(true);
    expect(await applyWyntraxEvent(db, low, hash(JSON.stringify(low)), now)).toBe('duplicate');
    expect((await db.wyntraxEntitlement.findFirstOrThrow({ where: { membershipId: high.data.membershipId } })).seq).toBe(8n);
  });
  it('invalid wire states return generic 400 and make no receipt, membership or audit writes; address case is exact', async () => {
    const k = key();
    for (const change of [(e: any) => { e.data.key = 'SUPER'; }, (e: any) => { delete e.data.validUntil; }, (e: any) => { e.data.wallets = []; }, (e: any) => { e.data.chain = 'evm'; }, (e: any) => { e.data.wallet = '0'.repeat(32); }]) {
      const e = event(k.address); change(e); const r = await post(e);
      expect(r.statusCode).toBe(400); expect(r.json()).toEqual({ error: 'INVALID_INPUT', requestId: expect.any(String) });
      expect(await db.webhookEvent.findUnique({ where: { id: e.id } })).toBeNull();
      expect(await db.wyntraxEntitlement.findFirst({ where: { membershipId: e.data.membershipId } })).toBeNull();
      expect(await db.auditLog.count({ where: { detail: { path: ['membershipId'], equals: e.data.membershipId } } })).toBe(0);
    }
    const e = event(k.address); await post(e);
    expect((await db.wyntraxEntitlement.findFirstOrThrow({ where: { membershipId: e.data.membershipId } })).address).toBe(k.address);
  });
  it('rejects a chunked oversized body before end-of-stream and invalid HMAC before ANY database transaction', async () => {
    const writes = vi.fn(async () => { throw Error('must not write'); });
    const guarded = await buildApp({ wyntrax: { db: { $transaction: writes } as never, secret: VECTOR_SECRET, now: () => now } });
    try {
      let ended = false, pushed = false;
      const body = new Readable({ read() { if (!pushed) { pushed = true; this.push(Buffer.alloc(16385, 120)); } } });
      body.on('end', () => { ended = true; });
      const r = await guarded.inject({ method: 'POST', url: '/v1/integrations/wyntrax/events', payload: body, headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' } });
      body.destroy(); expect(r.statusCode).toBe(413); expect(ended).toBe(false);
      const invalid = await guarded.inject({ method: 'POST', url: '/v1/integrations/wyntrax/events', payload: VECTOR_BODY, headers: { ...signed(VECTOR_BODY), 'x-wyntrax-signature': 'v1=' + '0'.repeat(64), 'x-wyntrax-event-id': 'evt_test_0001' } });
      expect(invalid.statusCode).toBe(401); expect(writes).not.toHaveBeenCalled();
    } finally { await guarded.close(); }
  });
});
