import pg from 'pg';
import { SignJWT, exportSPKI, generateKeyPair } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrisma } from '@narra/database';
import { buildApp } from './app';
import { createPrivyVerifier } from './auth';
import {seedTestPro,clearTestPro} from './test-membership';

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
  const artwork='https://cdn.dexscreener.com/cms/images/read-artwork.png';
  const artworkKeys:string[]=[];

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
    await seedTestPro(db,aliceId);await seedTestPro(db,bobId);

    const nar = await db.narrative.create({ data: { name: `Robotics ${tag}`, slug: `robotics-${tag}`, stage: 'ACCELERATING', score: 91, velocity: 284, organicScore: 88 } });
    await db.narrative.create({ data: { name: `Gaming ${tag}`, slug: `gaming-${tag}`, stage: 'DECAYING', score: 40 } });
    await db.narrativeMetric.create({ data: { narrativeId: nar.id, score: 91, velocity: 284, acceleration: 10, organicScore: 88, manipulationRisk: 14, mentionVelocity: 1, creatorVelocity: 1, engagementVelocity: 1 } });
    const creator = await db.creator.create({ data: { platform: 'X', handle: `creator${tag}` } });
    await db.narrativeCreator.create({ data: { narrativeId: nar.id, creatorId: creator.id, role: 'ORIGINATOR' } });

    const mk = async (sym: string, price: number, score: number, withDecision?: 'BUY') => {
      const t = await db.token.create({ data: { mint: M(sym), symbol: `${sym}${tag}`, name: `${sym} token`, metrics: { create: { priceUsd: price, marketCapUsd: 2_800_000, liquidityUsd: 681_000, volume24hUsd: 1_000_000 } }, consensus: { create: { score: 84, walletCount: 3, independentEntities: 3, leaderCount: 1, netFlowSol: 5 } } } });
      const metric=await db.tokenMetric.findFirstOrThrow({where:{tokenId:t.id}}),key=`research.market.${t.id}`;
      artworkKeys.push(key);
      await db.systemSetting.create({data:{key,value:{mint:M('ROBOT'),imageUrl:artwork,metricId:sym==='ROBOT'?metric.id:'unmatched-artwork-observation',at:metric.at.toISOString(),source:'dexscreener',marketCapIsFdv:false,priceChange1hPct:null,pairAddress:'read-test-pool',dexId:'raydium',pairCreatedAt:null}}});
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
    await clearTestPro(db,[aliceId,bobId]);
    await db.systemSetting.deleteMany({where:{key:{in:artworkKeys}}});
    // Users first: their positions, orders and trades would otherwise block deleting the tokens.
    await db.user.deleteMany({ where: { id: { in: [aliceId, bobId] } } });
    await db.token.deleteMany({ where: { symbol: { in: [`ROBOT${tag}`, `QCAT${tag}`] } } });
    await db.narrative.deleteMany({ where: { slug: { endsWith: tag } } });
    await db.trackedWallet.deleteMany({ where: { address: M('WAL') } });
    await app.close();
    await db.$disconnect();
  });

  it('requires a token on every read route', async () => {
    for (const p of ['/v1/narratives', '/v1/opportunities', '/v1/tokens', `/v1/tokens/${M('ROBOT')}/history`, '/v1/positions', '/v1/trades', '/v1/smart-money/wallets']) {
      expect((await get(p, null)).status).toBe(401);
    }
  });

  it('lists narratives best first and filters by stage', async () => {
    // The shared scratch DB can contain more narratives than the entitlement page cap.
    // Traverse pages; do not assume this test's lower-scored fixture is on page one.
    const mine = async (path: string) => {
      const rows: { slug: string; stage: string; tokenCount: number }[] = [];
      const seen = new Set<string>();
      let cursor: string | null = null;
      do {
        const response = await get(path + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''));
        expect(response.status).toBe(200);
        rows.push(...response.body.items.filter((x: { slug: string }) => x.slug.endsWith(tag)));
        cursor = response.body.nextCursor;
        if (cursor) { expect(seen.has(cursor)).toBe(false); seen.add(cursor); }
      } while (cursor);
      return rows;
    };
    const all = await mine('/v1/narratives?limit=100');
    expect(all.map((x: { slug: string }) => x.slug)).toEqual([`robotics-${tag}`, `gaming-${tag}`]);
    expect(all[0]).toMatchObject({ stage: 'ACCELERATING', tokenCount: 2 });
    const d = await mine('/v1/narratives?stage=DECAYING&limit=100');
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
    expect(r.body.tokens.find((t:{mint:string})=>t.mint===M('ROBOT')).imageUrl).toBe(artwork);
    expect(r.body.tokens.find((t:{mint:string})=>t.mint===M('QCAT')).imageUrl).toBeNull();
    expect((await get('/v1/narratives/does-not-exist')).status).toBe(404);
  });

  it('caps related creators at 50 and lists originators first', async () => {
    // A busy narrative must not ship an unbounded creator list; the API keeps the
    // first 50 and sorts originators ahead of early amplifiers and followers.
    const crowded = await db.narrative.create({ data: { name: `Crowded ${tag}`, slug: `crowded-${tag}`, stage: 'EMERGING', score: 12 } });
    const handles = Array.from({ length: 55 }, (_, i) => `cap${i}${tag}`);
    const creators: Array<{ id: string }> = [];
    try {
      for (const handle of handles) creators.push(await db.creator.create({ data: { platform: 'X', handle } }));
      await db.narrativeCreator.createMany({ data: creators.map((c, i) => ({ narrativeId: crowded.id, creatorId: c.id, role: i === 54 ? 'ORIGINATOR' : 'FOLLOWER' })) });
      const r = await get(`/v1/narratives/crowded-${tag}`);
      expect(r.status).toBe(200);
      expect(r.body.creators).toHaveLength(50);
      expect(r.body.creators.filter((c: { role: string }) => c.role === 'ORIGINATOR')).toHaveLength(1);
      expect(r.body.creators[0]).toMatchObject({ handle: `cap54${tag}`, role: 'ORIGINATOR' });
    } finally {
      await db.creator.deleteMany({ where: { handle: { in: handles } } });
    }
  });

  it('ranks opportunities by the latest score per token and shows only visible decisions', async () => {
    // Shared integration fixtures can outrank QCAT; do not assume both fixtures
    // remain on page one after repeated runs of global resolver jobs.
    const pages = [];
    let cursor: string | null = null;
    do {
      const response = await get(`/v1/opportunities?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      expect(response.status).toBe(200);
      pages.push(...response.body.items);
      cursor = response.body.nextCursor;
    } while(cursor);
    const items = pages.filter((i: { token: { mint: string } }) => i.token.mint.endsWith('1') && i.token.mint.includes(tag));
    expect(items.map((i: { token: { symbol: string } }) => i.token.symbol)).toEqual([`ROBOT${tag}`, `QCAT${tag}`]);
    expect(items[0]).toMatchObject({ score: 91, scores: { narrative: 92, risk: 32 }, attentionGrowth: 284, decision: { action: 'BUY', confidence: 0.88 }, narrative: { stage: 'ACCELERATING' } });
    expect(items[1].decision).toBeNull();
    expect(items[0].radarSafety).toMatchObject({state:'NOT_RECORDED',snapshot:null});
    expect(Object.keys(items[0].latestEvidence).sort()).toEqual(['checkedAt','holders','market','risk','rugcheck','tradeability']);
    expect(items[0].latestEvidence).not.toHaveProperty('verdict');
    expect(items[0].latestEvidence.tradeability.state).toBe('MISSING');
    expect(items[0].token.imageUrl).toBe(artwork);expect(items[1].token.imageUrl).toBeNull();
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
    expect(d.body.radarSafety).toMatchObject({state:'NOT_RECORDED',snapshot:null});
    expect(d.body.latestEvidence.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(['FRESH','STALE','UNVERIFIED','MISSING','INVALID']).toContain(d.body.latestEvidence.holders.state);
    expect((await get('/v1/tokens/unknownmint')).status).toBe(404);
    expect((await get('/v1/tokens?q=')).status).toBe(400);
  });

  it('returns only proven price history and validates its time window', async () => {
    const t = await db.token.findUniqueOrThrow({ where: { mint: M('ROBOT') }, include: { metrics: true } });
    const metric = t.metrics[0]!;
    const key = `research.marketMetric.${metric.id}`;
    await db.systemSetting.create({ data: { key, value: { metricId: metric.id, at: metric.at.toISOString(), source: 'dexscreener', marketCapIsFdv: false, priceChange1hPct: null, pairAddress: 'test-pool', dexId: null, pairCreatedAt: null } } });
    try {
      const history = await get(`/v1/tokens/${M('ROBOT')}/history?window=24h`);
      expect(history.status).toBe(200);
      expect(history.body.points).toEqual([{ at: metric.at.toISOString(), priceUsd: .01, source: 'dexscreener', pairAddress: 'test-pool' }]);
      expect((await get(`/v1/tokens/${M('QCAT')}/history`)).body.points).toEqual([]);
      expect((await get(`/v1/tokens/${M('ROBOT')}/history?window=99d`)).status).toBe(400);
      expect((await get('/v1/tokens/unknownmint/history')).status).toBe(404);
    } finally { await db.systemSetting.delete({ where: { key } }); }
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
    expect(mine[0].token).toMatchObject({name:'ROBOT token',imageUrl:artwork});
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
    expect(p1.items[0].token).toMatchObject({name:'ROBOT token',imageUrl:artwork});
    expect(p1.items[0].token).not.toHaveProperty('id');
    expect(p1.nextCursor).toBeTruthy();
    const p2 = (await get(`/v1/trades?limit=2&cursor=${p1.nextCursor}`)).body;
    expect(p2.items).toHaveLength(1);
    expect(p2.nextCursor).toBeNull();
    expect([...p1.items, ...p2.items].map((t: { signature: string }) => t.signature)).toEqual([`s0${tag}`, `s1${tag}`, `s2${tag}`]);
    expect((await get('/v1/trades', bob)).body.items).toHaveLength(0);
  });
  it('attaches artwork only through an alert token reference, without rewriting the stored text or leaking notifications',async()=>{
    const token=await db.token.findUniqueOrThrow({where:{mint:M('ROBOT')}});
    const alert=await db.alert.create({data:{kind:'EARLY_RADAR_TRENCHER',priority:'WATCH',title:'Stored token alert',body:'Unchanged research text',refType:'TOKEN',refId:token.id}});
    try{
      await db.notification.create({data:{userId:aliceId,alertId:alert.id}});
      const response=await get('/v1/alerts');expect(response.status).toBe(200);
      expect(response.body.items.find((n:{alertId:string})=>n.alertId===alert.id)).toMatchObject({title:alert.title,body:alert.body,token:{mint:token.mint,symbol:token.symbol,name:token.name,imageUrl:artwork}});
      expect((await get('/v1/alerts',bob)).body.items.some((n:{alertId:string})=>n.alertId===alert.id)).toBe(false);
    }finally{await db.alert.delete({where:{id:alert.id}});}
  });
});
