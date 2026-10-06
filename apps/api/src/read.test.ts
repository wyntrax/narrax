import pg from 'pg';
import { SignJWT, exportSPKI, generateKeyPair } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrisma } from '@narra/database';
import { buildApp } from './app';
import { createPrivyVerifier } from './auth';

const url = process.env.DATABASE_URL ?? 'postgresql://narra:narra@localhost:5432/narra';
async function dbUp() {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 800 });
  try { await c.connect(); await c.query('select 1 from "User" limit 1'); return true; } catch { return false; } finally { await c.end().catch(() => {}); }
}
const up = await dbUp();

describe.skipIf(!up)('read routes (needs Postgres)', () => {
  const db = createPrisma(url);
  const tag = `r${Date.now()}`;
  const APP_ID = 'read-test';
  const M = (s: string) => `${s}${tag}`.padEnd(40, '1');
  let verifierKey: Awaited<ReturnType<typeof generateKeyPair>>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const alice = `did:privy:ra-${tag}`;
  const bob = `did:privy:rb-${tag}`;
  let aliceId = '';
  let bobId = '';

  const get = async (path: string, sub: string | null = alice) => {
    const token = sub ? await new SignJWT({}).setProtectedHeader({ alg: 'ES256' }).setSubject(sub).setIssuer('privy.io').setAudience(APP_ID).setIssuedAt().setExpirationTime('5m').sign(verifierKey.privateKey) : null;
    const res = await app.inject({ method: 'GET', url: path, headers: token ? { authorization: `Bearer ${token}` } : {} });
    return { status: res.statusCode, body: res.json() };
  };

  beforeAll(async () => {
    verifierKey = await generateKeyPair('ES256');
    app = await buildApp({ account: { db, verifier: createPrivyVerifier({ appId: APP_ID, verificationKey: await exportSPKI(verifierKey.publicKey) }) } });
    aliceId = (await db.user.create({ data: { privyUserId: alice } })).id;
    bobId = (await db.user.create({ data: { privyUserId: bob } })).id;

    const nar = await db.narrative.create({ data: { name: `Robotics ${tag}`, slug: `robotics-${tag}`, stage: 'ACCELERATING', score: 91, velocity: 284, organicScore: 88 } });
    await db.narrative.create({ data: { name: `Gaming ${tag}`, slug: `gaming-${tag}`, stage: 'DECAYING', score: 40 } });
    await db.narrativeMetric.create({ data: { narrativeId: nar.id, score: 91, velocity: 284, acceleration: 10, organicScore: 88, manipulationRisk: 14, mentionVelocity: 1, creatorVelocity: 1, engagementVelocity: 1 } });
    const creator = await db.creator.create({ data: { platform: 'X', handle: `creator${tag}` } });
    await db.narrativeCreator.create({ data: { narrativeId: nar.id, creatorId: creator.id, role: 'ORIGINATOR' } });

    const mk = async (sym: string, price: number, score: number, withDecision?: 'BUY') => {
      const t = await db.token.create({ data: { mint: M(sym), symbol: `${sym}${tag}`, name: `${sym} token`, metrics: { create: { priceUsd: price, marketCapUsd: 2_800_000, liquidityUsd: 681_000, volume24hUsd: 1_000_000 } }, consensus: { create: { score: 84, walletCount: 3, independentEntities: 3, leaderCount: 1, netFlowSol: 5 } } } });
      await db.narrativeTokenRelation.create({ data: { narrativeId: nar.id, tokenId: t.id, relation: 'OG', ogScore: 87, matchScore: 90, confidence: 0.8 } });
      await db.opportunity.create({ data: { tokenId: t.id, narrativeId: nar.id, score: score - 30, narrativeScore: 1, smartMoneyScore: 1, liquidityScore: 1, momentumScore: 1, ogScore: 1, riskScore: 1, createdAt: new Date(Date.now() - 3600_000) } }); // older, lower
      const o = await db.opportunity.create({ data: { tokenId: t.id, narrativeId: nar.id, score, narrativeScore: 92, smartMoneyScore: 91, liquidityScore: 85, momentumScore: 74, ogScore: 87, riskScore: 32, attentionGrowth: 284, priceGrowth: 14 } });
      if (withDecision) {
        const a = await db.agentAnalysis.create({ data: { opportunityId: o.id, model: 'test' } });
        await db.agentDecision.create({ data: { analysisId: a.id, userId: null, action: withDecision, confidence: 0.88, payload: {} } });
        await db.agentDecision.create({ data: { analysisId: a.id, userId: bobId, action: 'SELL', confidence: 0.5, payload: {} } }); // another user's private decision
      }
      return t;
    };
    const robot = await mk('ROBOT', 0.01, 91, 'BUY');
    await mk('QCAT', 0.004, 83);

    const order = (key: string, at: Date) => db.order.create({ data: { userId: aliceId, tokenId: robot.id, idempotencyKey: `${key}${tag}`, side: 'BUY', mode: 'AI_AUTO', status: 'CONFIRMED', sizeSol: 0.2, createdAt: at } });
    await db.position.create({ data: { userId: aliceId, tokenId: robot.id, mode: 'PAPER', entryPriceUsd: 0.008, sizeSol: 0.2, entryContext: { narrativeScore: 87 } } });
    await db.position.create({ data: { userId: bobId, tokenId: robot.id, mode: 'PAPER', entryPriceUsd: 0.009, sizeSol: 0.9, entryContext: {} } });
    for (let i = 0; i < 3; i++) {
      const o = await order(`o${i}`, new Date(Date.now() - i * 60_000));
      await db.trade.create({ data: { userId: aliceId, orderId: o.id, side: 'BUY', mode: 'AI_AUTO', reason: 'x', expectedPriceUsd: 0.01, actualPriceUsd: 0.0101, slippageBps: 10, signature: `s${i}${tag}`, executedAt: new Date(Date.now() - i * 60_000) } });
    }
    const w = await db.trackedWallet.create({ data: { address: M('WAL'), profile: { create: { score: 94, leaderScore: 91, style: 'EARLY_MOMENTUM' } }, metrics: { create: { window: '30D', winRate: 0.78, pnlSol: 482, closedTrades: 40, avgRoi: 0.42, medianRoi: 0.3, maxDrawdown: 0.1 } } } });
    void w;
  });
  // Remove this file's rows so shared, size-limited lists do not fill up across runs.
  afterAll(async () => {
    // Users first: their positions, orders and trades would otherwise block deleting the tokens.
    await db.user.deleteMany({ where: { id: { in: [aliceId, bobId] } } });
    await db.token.deleteMany({ where: { symbol: { in: [`ROBOT${tag}`, `QCAT${tag}`] } } });
    await db.narrative.deleteMany({ where: { slug: { endsWith: tag } } });
    await db.trackedWallet.deleteMany({ where: { address: M('WAL') } });
    await app.close();
    await db.$disconnect();
  });

  it('requires a token on every read route', async () => {
    for (const p of ['/v1/narratives', '/v1/opportunities', '/v1/tokens', '/v1/positions', '/v1/trades', '/v1/smart-money/wallets']) {
      expect((await get(p, null)).status).toBe(401);
    }
  });

  it('lists narratives best first and filters by stage', async () => {
    const all = (await get('/v1/narratives?limit=100')).body.items.filter((x: { slug: string }) => x.slug.endsWith(tag));
    expect(all.map((x: { slug: string }) => x.slug)).toEqual([`robotics-${tag}`, `gaming-${tag}`]);
    expect(all[0]).toMatchObject({ stage: 'ACCELERATING', tokenCount: 2 });
    const d = (await get('/v1/narratives?stage=DECAYING&limit=100')).body.items.filter((x: { slug: string }) => x.slug.endsWith(tag));
    expect(d).toHaveLength(1);
    expect((await get('/v1/narratives?stage=NOPE')).status).toBe(400);
    expect((await get('/v1/narratives?limit=1000')).status).toBe(400);
  });

  it('returns narrative detail with creators and related tokens, or 404', async () => {
    const r = await get(`/v1/narratives/robotics-${tag}`);
    expect(r.status).toBe(200);
    expect(r.body.creators).toEqual([{ platform: 'X', handle: `creator${tag}`, role: 'ORIGINATOR' }]);
    expect(r.body.tokens).toHaveLength(2);
    expect(r.body.tokens[0]).toMatchObject({ relation: 'OG', ogScore: 87, marketCapUsd: 2_800_000 });
    expect((await get('/v1/narratives/does-not-exist')).status).toBe(404);
  });

  it('ranks opportunities by the latest score per token and shows only visible decisions', async () => {
    const items = (await get('/v1/opportunities?limit=100')).body.items.filter((i: { token: { mint: string } }) => i.token.mint.endsWith('1') && i.token.mint.includes(tag));
    expect(items.map((i: { token: { symbol: string } }) => i.token.symbol)).toEqual([`ROBOT${tag}`, `QCAT${tag}`]);
    expect(items[0]).toMatchObject({ score: 91, scores: { narrative: 92, risk: 32 }, attentionGrowth: 284, decision: { action: 'BUY', confidence: 0.88 }, narrative: { stage: 'ACCELERATING' } });
    expect(items[1].decision).toBeNull();
    const bobView = (await get('/v1/opportunities?limit=100', bob)).body.items.find((i: { token: { symbol: string } }) => i.token.symbol === `ROBOT${tag}`);
    expect(bobView.decision).toMatchObject({ action: 'SELL' }); // Bob sees his own decision, Alice never does
  });

  it('searches tokens and returns token detail', async () => {
    const found = (await get(`/v1/tokens?q=robot${tag}`)).body.items;
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ symbol: `ROBOT${tag}`, priceUsd: 0.01 });
    const d = await get(`/v1/tokens/${M('ROBOT')}`);
    expect(d.body).toMatchObject({ symbol: `ROBOT${tag}`, blacklisted: false, metrics: { liquidityUsd: 681000 }, consensus: { score: 84, independentEntities: 3 } });
    expect(d.body.narratives[0]).toMatchObject({ relation: 'OG', stage: 'ACCELERATING' });
    expect((await get('/v1/tokens/unknownmint')).status).toBe(404);
    expect((await get('/v1/tokens?q=')).status).toBe(400);
  });

  it('lists scored smart-money wallets with their 30D metrics', async () => {
    const w = (await get('/v1/smart-money/wallets?limit=100')).body.items.find((x: { address: string }) => x.address === M('WAL'));
    expect(w).toMatchObject({ score: 94, leaderScore: 91, style: 'EARLY_MOMENTUM', winRate: 0.78, pnl30dSol: 482, closedTrades: 40, avgRoi: 0.42, cluster: null });
  });

  it('shows only the signed-in user\'s positions, with PnL from the latest price', async () => {
    const mine = (await get('/v1/positions')).body.items;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ sizeSol: 0.2, entryPriceUsd: 0.008, currentPriceUsd: 0.01, token: { symbol: `ROBOT${tag}` } });
    expect(mine[0].pnlPct).toBeCloseTo(25);
    expect((await get('/v1/positions', bob)).body.items[0]).toMatchObject({ sizeSol: 0.9 });
  });

  it('shows the position monitor\'s latest reading, null until it has looked, and never another user\'s', async () => {
    const mine = (await get('/v1/positions')).body.items[0];
    expect(mine.evaluation).toBeNull();
    const t0 = new Date('2026-09-30T12:00:00Z');
    await db.positionEvaluation.create({ data: { positionId: mine.id, action: 'HOLD', fractionPct: 0, signals: [], unavailable: ['DEV_ACTIVITY: developer wallet data is not collected'], blind: false, pnlPct: 25, createdAt: t0 } });
    await db.positionEvaluation.create({ data: { positionId: mine.id, action: 'REDUCE', fractionPct: 50, signals: [{ code: 'LIQUIDITY_DROP', level: 'REDUCE', detail: 'x' }], unavailable: [], blind: false, pnlPct: 20, createdAt: new Date(t0.getTime() + 60_000) } });
    const after = (await get('/v1/positions')).body.items[0];
    expect(after.evaluation).toMatchObject({ action: 'REDUCE', fractionPct: 50, blind: false, pnlPct: 20, signals: [{ code: 'LIQUIDITY_DROP' }] });
    expect((await get('/v1/positions', bob)).body.items[0].evaluation).toBeNull();
  });

  it('pages through only the signed-in user\'s trades', async () => {
    const p1 = (await get('/v1/trades?limit=2')).body;
    expect(p1.items).toHaveLength(2);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = (await get(`/v1/trades?limit=2&cursor=${p1.nextCursor}`)).body;
    expect(p2.items).toHaveLength(1);
    expect(p2.nextCursor).toBeNull();
    expect([...p1.items, ...p2.items].map((t: { signature: string }) => t.signature)).toEqual([`s0${tag}`, `s1${tag}`, `s2${tag}`]);
    expect((await get('/v1/trades', bob)).body.items).toHaveLength(0);
  });
});
