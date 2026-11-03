import pg from 'pg';
import { randomBytes } from 'node:crypto';
import bs58 from 'bs58';
import { SignJWT, exportSPKI, generateKeyPair } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrisma } from '@narra/database';
import { snapshot } from '@narra/market-data';
import { buildApp } from './app';
import { createPrivyVerifier } from './auth';

const url = process.env.DATABASE_URL ?? 'postgresql://narra:narra@localhost:5432/narra';
async function dbUp() {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 800 });
  try { await c.connect(); await c.query('select 1 from "User" limit 1'); return true; } catch { return false; } finally { await c.end().catch(() => {}); }
}
const up = await dbUp();

describe.skipIf(!up)('on-demand token quote refresh (needs Postgres)', () => {
  const db = createPrisma(url);
  const tag = `tr${Date.now()}`;
  const APP_ID = 'token-refresh-test';
  const mint = bs58.encode(randomBytes(32));
  const missingMint = bs58.encode(randomBytes(32));
  const alice = `did:privy:tr-${tag}`;
  let verifierKey: Awaited<ReturnType<typeof generateKeyPair>>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let userId = '', tokenId = '', missingTokenId = '';
  let calls = 0, mode: 'ok' | 'missing' = 'ok';

  const quote = (m: string) => snapshot(m, { priceUsd: 0.02, marketCapUsd: 100_000, liquidityUsd: 50_000, volume24hUsd: 10_000 });
  const quotes = {
    name: 'dexscreener',
    getSnapshots: async (mints: string[]) => { calls++; return new Map(mode === 'ok' ? mints.map(m => [m, quote(m)]) : []); },
    getSnapshotsWithDiagnostics: async (mints: string[]) => { calls++; return mode === 'ok' ? { snapshots: new Map(mints.map(m => [m, quote(m)])), omissions: new Map() } : { snapshots: new Map(), omissions: new Map(mints.map(m => [m, 'NO_MATCHING_PAIR' as const])) }; },
  };

  const request = async (path: string, sub: string | null = alice) => {
    const token = sub ? await new SignJWT({}).setProtectedHeader({ alg: 'ES256' }).setSubject(sub).setIssuer('privy.io').setAudience(APP_ID).setIssuedAt().setExpirationTime('5m').sign(verifierKey.privateKey) : null;
    const res = await app.inject({ method: 'POST', url: path, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: {} });
    return { status: res.statusCode, body: res.json() };
  };

  beforeAll(async () => {
    verifierKey = await generateKeyPair('ES256');
    app = await buildApp({ account: { db, verifier: createPrivyVerifier({ appId: APP_ID, verificationKey: await exportSPKI(verifierKey.publicKey) }) }, marketQuotes: quotes as never });
    userId = (await db.user.create({ data: { privyUserId: alice } })).id;
    tokenId = (await db.token.create({ data: { mint, symbol: 'REFRESH', name: 'Refresh token' } })).id;
    missingTokenId = (await db.token.create({ data: { mint: missingMint, symbol: 'MISSING', name: 'Missing pool' } })).id;
  });
  afterAll(async () => {
    const metrics = await db.tokenMetric.findMany({ where: { tokenId: { in: [tokenId, missingTokenId] } }, select: { id: true } });
    await db.systemSetting.deleteMany({ where: { OR: [{ key: { in: [tokenId, missingTokenId].map(id => `research.market.${id}`) } }, { key: { in: metrics.map(m => `research.marketMetric.${m.id}`) } }] } });
    await db.token.deleteMany({ where: { id: { in: [tokenId, missingTokenId] } } });
    await db.user.deleteMany({ where: { id: userId } });
    await app.close(); await db.$disconnect();
  });

  it('requires auth and a configured quote source', async () => {
    expect((await request(`/v1/tokens/${mint}/refresh`, null)).status).toBe(401);
    const noQuotes = await buildApp({ account: { db, verifier: createPrivyVerifier({ appId: APP_ID, verificationKey: await exportSPKI(verifierKey.publicKey) }) } });
    const res = await noQuotes.inject({ method: 'POST', url: `/v1/tokens/${mint}/refresh`, headers: { authorization: `Bearer ${await new SignJWT({}).setProtectedHeader({ alg: 'ES256' }).setSubject(alice).setIssuer('privy.io').setAudience(APP_ID).setIssuedAt().setExpirationTime('5m').sign(verifierKey.privateKey)}` }, payload: {} });
    expect(res.statusCode).toBe(503);
    await noQuotes.close();
  });

  it('writes one current quote with provenance, then reuses it for a duplicate click', async () => {
    calls = 0; mode = 'ok';
    const first = await request(`/v1/tokens/${mint}/refresh`);
    expect(first.status).toBe(200); expect(first.body).toMatchObject({ ok: true, reused: false });
    expect(calls).toBe(1);
    const metrics = await db.tokenMetric.findMany({ where: { tokenId } });
    expect(metrics).toHaveLength(1);
    const evidence = await db.systemSetting.findUniqueOrThrow({ where: { key: `research.market.${tokenId}` } });
    expect(evidence.value).toMatchObject({ metricId: metrics[0]!.id, mint, source: 'dexscreener', pairAddress: expect.any(String) });
    const second = await request(`/v1/tokens/${mint}/refresh`);
    expect(second.status).toBe(200); expect(second.body).toMatchObject({ ok: true, reused: true });
    expect(calls).toBe(1);
    expect(await db.tokenMetric.count({ where: { tokenId } })).toBe(1);
  });

  it('records no quote when the provider has no matching pool', async () => {
    mode = 'missing';
    const result = await request(`/v1/tokens/${missingMint}/refresh`);
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: 'MARKET_SNAPSHOT_UNAVAILABLE', reason: 'NO_MATCHING_PAIR' });
    expect(await db.tokenMetric.count({ where: { tokenId: missingTokenId } })).toBe(0);
  });
});
