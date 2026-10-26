import pg from 'pg';
import { SignJWT, exportSPKI, generateKeyPair } from 'jose';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrisma } from '@narra/database';
import { buildApp } from './app';
import { createPrivyVerifier } from './auth';

const APP_ID = 'test-app-id';
const { publicKey, privateKey } = await generateKeyPair('ES256');
const other = await generateKeyPair('ES256');
const verifier = createPrivyVerifier({ appId: APP_ID, verificationKey: await exportSPKI(publicKey) });

const sign = (sub: string, o: { key?: typeof privateKey; aud?: string; iss?: string; exp?: string } = {}) =>
  new SignJWT({}).setProtectedHeader({ alg: 'ES256' }).setSubject(sub).setIssuer(o.iss ?? 'privy.io').setAudience(o.aud ?? APP_ID)
    .setIssuedAt().setExpirationTime(o.exp ?? '5m').sign(o.key ?? privateKey);

describe('privy verifier', () => {
  it('accepts a valid token and returns the subject', async () => {
    expect(await verifier.verify(await sign('did:privy:abc'))).toEqual({ privyUserId: 'did:privy:abc' });
  });
  it('rejects wrong key, audience, issuer, expired and garbage tokens', async () => {
    for (const t of [await sign('u', { key: other.privateKey }), await sign('u', { aud: 'other-app' }), await sign('u', { iss: 'evil.io' }), await sign('u', { exp: '-1m' }), 'garbage']) {
      await expect(verifier.verify(t)).rejects.toThrow();
    }
  });
});

const url = process.env.DATABASE_URL ?? 'postgresql://narra:narra@localhost:5432/narra';
async function dbUp() {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 800 });
  try { await c.connect(); await c.query('select 1 from "User" limit 1'); return true; } catch { return false; } finally { await c.end().catch(() => {}); }
}
const up = await dbUp();

describe.skipIf(!up)('account routes (needs Postgres)', () => {
  const db = createPrisma(url);
  afterAll(async () => { await db.$disconnect(); });
  const tag = `a${Date.now()}`;

  const call = async (method: 'GET' | 'PUT' | 'POST', path: string, sub: string | null, payload?: unknown) => {
    const app = await buildApp({ account: { db, verifier } });
    const res = await app.inject({ method, url: path, payload: payload as object, headers: sub ? { authorization: `Bearer ${await sign(sub)}` } : {} });
    return { status: res.statusCode, body: res.json() };
  };
  const alice = `did:privy:alice-${tag}`;
  const bob = `did:privy:bob-${tag}`;

  it('requires a valid token', async () => {
    expect((await call('GET', '/v1/me', null)).status).toBe(401);
    const app = await buildApp({ account: { db, verifier } });
    expect((await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: 'Bearer nope' } })).statusCode).toBe(401);
  });

  it('creates the user on first sign-in with safe defaults', async () => {
    const r = await call('GET', '/v1/me', alice);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ mode: 'SHADOW', aiTradingEnabled: false, agentPaused: false, riskPreset: null });
    expect((await call('GET', '/v1/me', alice)).body.id).toBe(r.body.id); // same user, not a new one
  });

  it('only allows automated modes once AI access is on, and drops them when it goes off', async () => {
    expect((await call('PUT', '/v1/mode', alice, { mode: 'AUTO' })).status).toBe(409);
    expect((await call('PUT', '/v1/mode', alice, { mode: 'PAPER' })).status).toBe(200);
    expect((await call('PUT', '/v1/ai-access', alice, { enabled: true })).body.aiTradingEnabled).toBe(true);
    expect((await call('PUT', '/v1/mode', alice, { mode: 'AUTO' })).status).toBe(200);
    expect((await call('GET', '/v1/me', alice)).body).toMatchObject({ mode: 'AUTO', aiTradingEnabled: true });
    await call('PUT', '/v1/ai-access', alice, { enabled: false });
    expect((await call('GET', '/v1/me', alice)).body).toMatchObject({ mode: 'SHADOW', aiTradingEnabled: false });
    expect((await call('PUT', '/v1/mode', alice, { mode: 'NOPE' })).status).toBe(400);
  });

  it('pause, resume and revoke work without preconditions and are audited', async () => {
    expect((await call('POST', '/v1/agent/pause', alice)).body.agentPaused).toBe(true);
    expect((await call('GET', '/v1/me', alice)).body.agentPaused).toBe(true);
    await call('POST', '/v1/agent/resume', alice);
    await call('PUT', '/v1/ai-access', alice, { enabled: true });
    await call('PUT', '/v1/mode', alice, { mode: 'SEMI_AUTO' });
    expect((await call('POST', '/v1/ai-access/revoke', alice)).body).toEqual({ aiTradingEnabled: false, mode: 'SHADOW' });
    const me = (await call('GET', '/v1/me', alice)).body;
    const actions = (await db.auditLog.findMany({ where: { userId: me.id } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['agent.paused', 'agent.resumed', 'ai_access.revoked', 'mode.changed']));
  });

  it('keeps users separate', async () => {
    await call('POST', '/v1/agent/pause', alice);
    expect((await call('GET', '/v1/me', bob)).body.agentPaused).toBe(false);
  });

  it('enqueues a post-sign-in holding check only for the authenticated user', async () => {
    const requested: string[] = [];
    const app = await buildApp({ account: { db, verifier, requestMembershipSync: async userId => { requested.push(userId); } } });
    const res = await app.inject({ method: 'POST', url: '/v1/me/membership/refresh', headers: { authorization: `Bearer ${await sign(alice)}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(requested).toEqual([alice]);
    expect((await app.inject({ method: 'POST', url: '/v1/me/membership/refresh' })).statusCode).toBe(401);
  });

  it('saves risk presets and refuses custom limits beyond the system limits', async () => {
    expect((await call('PUT', '/v1/risk-profile', alice, { preset: 'CONSERVATIVE' })).body).toMatchObject({ preset: 'CONSERVATIVE', maxPerTradeSol: 0.1 });
    const all = { maxPerTradeSol: 0.3, maxDailyAllocationSol: 1, maxTokenExposurePct: 12, maxOpenPositions: 4, maxDailyLossPct: 6, minConfidence: 0.8 };
    expect((await call('PUT', '/v1/risk-profile', alice, { preset: 'CUSTOM', ...all })).status).toBe(200);
    const bad = await call('PUT', '/v1/risk-profile', alice, { preset: 'CUSTOM', ...all, maxPerTradeSol: 50, minConfidence: 0.1 });
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual({ error: 'EXCEEDS_SYSTEM_LIMITS', fields: ['maxPerTradeSol', 'minConfidence'] });
    expect((await call('PUT', '/v1/risk-profile', alice, { preset: 'CUSTOM', maxPerTradeSol: 0.2 })).body.error).toBe('CUSTOM_REQUIRES_ALL_LIMITS');
    expect((await call('GET', '/v1/me', alice)).body.riskPreset).toBe('CUSTOM');
  });
});
