import pg from 'pg';
import { SignJWT, exportSPKI, generateKeyPair } from 'jose';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrisma } from '@narra/database';
import type { ExecutionJob } from '@narra/queue';
import { buildApp } from './app';
import { createPrivyVerifier } from './auth';

const APP_ID = 'test-app-id';
const { publicKey, privateKey } = await generateKeyPair('ES256');
const verifier = createPrivyVerifier({ appId: APP_ID, verificationKey: await exportSPKI(publicKey) });
const sign = (sub: string) => new SignJWT({}).setProtectedHeader({ alg: 'ES256' }).setSubject(sub).setIssuer('privy.io').setAudience(APP_ID).setIssuedAt().setExpirationTime('5m').sign(privateKey);

const url = process.env.DATABASE_URL ?? 'postgresql://narra:narra@localhost:5432/narra';
async function dbUp() {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 800 });
  try { await c.connect(); await c.query('select 1 from "PendingConfirmation" limit 1'); return true; } catch { return false; } finally { await c.end().catch(() => {}); }
}
const up = await dbUp();

describe.skipIf(!up)('confirmation routes (needs Postgres)', () => {
  const db = createPrisma(url);
  const tag = `cf${Date.now()}`;
  const alice = `did:privy:alice-${tag}`;
  const bob = `did:privy:bob-${tag}`;
  const MINT = `Mint${tag}`.padEnd(40, '1');
  let enqueued: ExecutionJob[] = [];
  let failEnqueue = false;
  let now = new Date();
  const enqueueExecution = async (j: ExecutionJob) => { if (failEnqueue) throw new Error('redis down'); enqueued.push(j); };

  afterAll(async () => {
    await db.user.deleteMany({ where: { privyUserId: { in: [alice, bob] } } });
    await db.token.deleteMany({ where: { mint: MINT } });
    await db.$disconnect();
  });

  const call = async (method: 'GET' | 'POST', path: string, sub: string | null) => {
    const app = await buildApp({ account: { db, verifier, now: () => now }, enqueueExecution });
    const res = await app.inject({ method, url: path, headers: sub ? { authorization: `Bearer ${await sign(sub)}` } : {} });
    return { status: res.statusCode, body: res.json() };
  };
  const uid = async (sub: string) => (await call('GET', '/v1/me', sub)).body.id as string;

  const decision = { action: 'BUY', confidence: 0.9, reasonCodes: [], positiveSignals: [], negativeSignals: [], risks: [], suggestedPositionSizePct: 2, entry: { maxSlippageBps: 100, maxPriceImpactPct: 1.5 }, exit: { stopLossPct: null, takeProfitPct: null, trailingStopPct: null }, invalidationConditions: [], summary: 's' };
  let n = 0;
  const seed = async (userId: string, o: { expiresInMs?: number; kind?: 'ENTRY' | 'EXIT' } = {}) => {
    const key = `entry:${tag}-${++n}:${userId}`;
    return db.pendingConfirmation.create({
      data: {
        userId, idempotencyKey: key, kind: o.kind ?? 'ENTRY', mint: MINT, job: { userId, idempotencyKey: key, mint: MINT, decision } as object, sizeSol: 0.2,
        quote: { priceImpactPct: 0.4, slippageBps: 100 }, expiresAt: new Date(now.getTime() + (o.expiresInMs ?? 5 * 60_000)),
      },
    });
  };

  it('requires sign-in on every endpoint', async () => {
    expect((await call('GET', '/v1/confirmations', null)).status).toBe(401);
    expect((await call('POST', '/v1/confirmations/x/confirm', null)).status).toBe(401);
    expect((await call('POST', '/v1/confirmations/x/reject', null)).status).toBe(401);
  });

  it('lists only the signed-in user\'s confirmations, with an expired one shown as expired', async () => {
    const a = await uid(alice); const b = await uid(bob);
    await db.token.create({ data: { mint: MINT, symbol: 'CFT', name: 'confirm token' } });
    const mine = await seed(a); const expired = await seed(a, { expiresInMs: -1000 }); const theirs = await seed(b);
    const r = await call('GET', '/v1/confirmations', alice);
    expect(r.status).toBe(200);
    const ids = r.body.items.map((i: { id: string }) => i.id);
    expect(ids).toEqual(expect.arrayContaining([mine.id, expired.id]));
    expect(ids).not.toContain(theirs.id);
    expect(r.body.items.find((i: { id: string }) => i.id === expired.id).status).toBe('EXPIRED');
    expect(r.body.items.find((i: { id: string }) => i.id === mine.id)).toMatchObject({ status: 'PENDING', symbol: 'CFT', sizeSol: 0.2, priceImpactPct: 0.4 });
    expect(JSON.stringify(r.body)).not.toContain('"job"'); // the raw job is never exposed
    const pending = await call('GET', '/v1/confirmations?status=PENDING', alice);
    expect(pending.body.items.map((i: { id: string }) => i.id)).not.toContain(expired.id);
  });

  it('another user\'s confirmation is a 404 on confirm and on reject, and is left untouched', async () => {
    const b = await uid(bob);
    const theirs = await seed(b);
    enqueued = [];
    expect((await call('POST', `/v1/confirmations/${theirs.id}/confirm`, alice)).status).toBe(404);
    expect((await call('POST', `/v1/confirmations/${theirs.id}/reject`, alice)).status).toBe(404);
    expect((await call('POST', '/v1/confirmations/does-not-exist/confirm', alice)).status).toBe(404);
    expect(enqueued).toHaveLength(0);
    expect((await db.pendingConfirmation.findUniqueOrThrow({ where: { id: theirs.id } })).status).toBe('PENDING');
  });

  it('confirm claims once and queues one job with the confirmation id and its own idempotency key', async () => {
    const a = await uid(alice);
    const c = await seed(a);
    enqueued = [];
    const r = await call('POST', `/v1/confirmations/${c.id}/confirm`, alice);
    expect(r.status).toBe(202);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({ userId: a, confirmationId: c.id, idempotencyKey: `confirm:${c.id}`, mint: MINT });
    expect((await db.pendingConfirmation.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('CLAIMED');
    const again = await call('POST', `/v1/confirmations/${c.id}/confirm`, alice);
    expect(again.status).toBe(409);
    expect(enqueued).toHaveLength(1);
    expect((await call('POST', `/v1/confirmations/${c.id}/reject`, alice)).status).toBe(409); // cannot reject after confirming
  });

  it('a race of simultaneous confirms has exactly one winner and queues exactly one job', async () => {
    const a = await uid(alice);
    const c = await seed(a);
    enqueued = [];
    const results = await Promise.all(Array.from({ length: 8 }, () => call('POST', `/v1/confirmations/${c.id}/confirm`, alice)));
    expect(results.filter((r) => r.status === 202)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(7);
    expect(enqueued).toHaveLength(1);
  });

  it('a confirmation cannot be confirmed after it expires, not even a moment after', async () => {
    const a = await uid(alice);
    const c = await seed(a, { expiresInMs: 1000 });
    enqueued = [];
    now = new Date(now.getTime() + 1000); // exactly at expiry
    const late = await call('POST', `/v1/confirmations/${c.id}/confirm`, alice);
    expect(late.status).toBe(410);
    expect(enqueued).toHaveLength(0);
    expect((await db.pendingConfirmation.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('PENDING'); // the sweep, not the endpoint, records expiry
    now = new Date();
  });

  it('reject works once, frees nothing for a retry on an exit, and a rejected confirmation cannot be confirmed', async () => {
    const a = await uid(alice);
    const c = await seed(a);
    expect((await call('POST', `/v1/confirmations/${c.id}/reject`, alice)).body).toMatchObject({ status: 'REJECTED' });
    enqueued = [];
    expect((await call('POST', `/v1/confirmations/${c.id}/confirm`, alice)).status).toBe(409);
    expect((await call('POST', `/v1/confirmations/${c.id}/reject`, alice)).status).toBe(409);
    expect(enqueued).toHaveLength(0);
  });

  it('puts the confirmation back when the queue is down, so the user can try again', async () => {
    const a = await uid(alice);
    const c = await seed(a);
    failEnqueue = true;
    expect((await call('POST', `/v1/confirmations/${c.id}/confirm`, alice)).status).toBe(503);
    failEnqueue = false;
    expect((await db.pendingConfirmation.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('PENDING');
    enqueued = [];
    expect((await call('POST', `/v1/confirmations/${c.id}/confirm`, alice)).status).toBe(202);
    expect(enqueued).toHaveLength(1);
  });

  it('confirm is unavailable (and claims nothing) when no execution queue is wired', async () => {
    const a = await uid(alice);
    const c = await seed(a);
    const app = await buildApp({ account: { db, verifier } });
    const res = await app.inject({ method: 'POST', url: `/v1/confirmations/${c.id}/confirm`, headers: { authorization: `Bearer ${await sign(alice)}` } });
    expect(res.statusCode).toBe(503);
    expect((await db.pendingConfirmation.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('PENDING');
  });
});
