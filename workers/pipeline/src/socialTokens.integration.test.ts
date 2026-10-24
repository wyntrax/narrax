import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrisma } from '@narra/database';
import type { MarketQuoteSource } from '@narra/market-data';
import { scanSocialTokens } from './socialTokens';
import { refreshMarketData } from './marketData';

const url = process.env.DATABASE_URL ?? 'postgresql://narra:narra@localhost:5432/narra';
async function dbUp() {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 800 });
  try { await c.connect(); await c.query('select 1 from "TokenMention" limit 1'); return true; } catch { return false; } finally { await c.end().catch(() => {}); }
}
const up = await dbUp();

describe.skipIf(!up)('social token scan on a real Postgres', () => {
  const db = createPrisma(url);
  const NOW = new Date();
  const rand = (n: number) => Array.from({ length: n }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');
  const tag = rand(8); // letters only: mints and symbols built from it stay valid
  const mint = (k: string) => `${k}${tag}`.padEnd(40, 'x');
  const sym = `Q${rand(7)}`;
  const ids: string[] = [];
  const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
  const hex = () => Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  const mention = (refKind: string, ref: string, creator: number, i: number, at: Date) => ({ refKind, ref, platform: 'x', externalId: `${tag}-${ref.slice(0, 6)}-${i}`, creatorId: `${tag}-c${creator}`, textHash: hex(), simhash: hex(), engagement: 1, at });
  const addToken = async (key: string, symbol: string) => {
    const t = await db.token.create({ data: { mint: mint(key), symbol, name: `${symbol} token`, createdOnChainAt: new Date(NOW.getTime() - 48 * 3_600_000) } });
    ids.push(t.id);
    const metric=await db.tokenMetric.create({ data: { tokenId: t.id, priceUsd: 0.001, marketCapUsd: 40_000, liquidityUsd: 12_000, volume24hUsd: 50_000, at: NOW } });
    await db.systemSetting.create({data:{key:`research.market.${t.id}`,value:{metricId:metric.id,source:'dexscreener',marketCapIsFdv:false}}});
    await db.tokenHolderMetric.create({ data: { tokenId: t.id, holders: 300, top10Pct: 30, devHoldingPct: 2, at: NOW } });
    return t;
  };
  const quotes: MarketQuoteSource = {
    name: 'fake',
    // Confirms only this test's mints, so live mints in a shared database are never touched.
    getSnapshots: async (mints) => new Map(mints.filter((m) => m.startsWith('new') && m.includes(tag)).map((m) => [m, { mint: m, symbol: 'NEWT', name: 'New Token', priceUsd: 0.001, marketCapUsd: 30_000, marketCapIsFdv: false, liquidityUsd: 9_000, volume24hUsd: 1_000, priceChange1hPct: null, pairAddress: 'pair', dexId: null, pairCreatedAt: minutesAgo(60) }])),
  };

  beforeAll(async () => {
    const hot = await addToken('hot', `H${rand(6)}`);
    // 40 posts from 12 accounts in the last half hour name the mint.
    await db.tokenMention.createMany({ data: Array.from({ length: 40 }, (_, i) => mention('MINT', hot.mint, i % 12, i, minutesAgo(1 + (i % 30)))) });
    // Two tokens share one symbol, so the ticker alone cannot name either.
    await addToken('dupa', sym); await addToken('dupb', sym.toLowerCase());
    await db.tokenMention.createMany({ data: Array.from({ length: 6 }, (_, i) => mention('CASHTAG', sym.toUpperCase(), i % 4, i, minutesAgo(5 + i))) });
    // A mint nobody knows, posted by enough accounts.
    await db.tokenMention.createMany({ data: Array.from({ length: 6 }, (_, i) => mention('MINT', mint('newa'), i % 4, i, minutesAgo(5 + i))) });
    // One account posting the same mint many times is not buzz.
    await db.tokenMention.createMany({ data: Array.from({ length: 10 }, (_, i) => mention('MINT', mint('solo'), 0, i, minutesAgo(5 + i))) });
  });
  afterAll(async () => {
    const toks = await db.token.findMany({ where: { mint: { contains: tag } }, select: { id: true, metrics: { select: { id: true } } } });
    const all = [...new Set([...ids, ...toks.map((t) => t.id)])];
    const alerts = await db.alert.findMany({ where: { refId: { in: all } }, select: { id: true } });
    await db.systemSetting.deleteMany({ where: { key: { in: [
      ...toks.flatMap(t => [`research.market.${t.id}`, ...t.metrics.map(m => `research.marketMetric.${m.id}`)]),
      ...alerts.map(a => `research.radarSafety.${a.id}`),
      ...all.flatMap(id => ['trencher', 'holder'].map(p => `research.radarSafetyBlocked.${id}.${p}`)),
    ] } } });
    await db.alert.deleteMany({ where: { refId: { in: all } } });
    await db.tokenMention.deleteMany({ where: { externalId: { startsWith: `${tag}-` } } });
    await db.token.deleteMany({ where: { id: { in: all } } });
    await db.$disconnect();
  });

  it('turns chatter about a small token into an early-radar alert, with no raw text stored', async () => {
    const r = await scanSocialTokens(db, { quotes: null }, NOW);
    expect(r.tokensEvaluated).toBeGreaterThanOrEqual(1);
    const hot = await db.token.findUniqueOrThrow({ where: { mint: mint('hot') } });
    const alerts = await db.alert.findMany({ where: { refId: hot.id, kind: 'EARLY_RADAR_TRENCHER' } });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.title).toMatch(/social buzz/);
    expect(alerts[0]!.body).toMatch(/not a prediction/i);
    expect(await db.earlyRadarOutcome.findUnique({where:{alertId:alerts[0]!.id}})).toMatchObject({route:'SOCIAL',matchKind:'MINT',profile:'trencher',entryPriceUsd:0.001,entryMarketCapUsd:40000});
    const row = await db.tokenMention.findFirstOrThrow({ where: { ref: hot.mint } });
    expect(Object.keys(row)).not.toContain('text');
  });

  it('does not guess when a ticker matches two tokens, and ignores one account repeating itself', async () => {
    const dup = await db.token.findMany({ where: { mint: { in: [mint('dupa'), mint('dupb')] } } });
    expect(await db.alert.count({ where: { refId: { in: dup.map((t) => t.id) } } })).toBe(0);
    expect(await db.token.findUnique({ where: { mint: mint('solo') } })).toBeNull();
  });

  it('creates no token for an unknown mint without a market source, and one only when the source confirms it', async () => {
    expect(await db.token.findUnique({ where: { mint: mint('newa') } })).toBeNull();
    const r = await scanSocialTokens(db, { quotes }, new Date(NOW.getTime() + 1_000));
    expect(r.tokensCreated).toBe(1);
    expect(r.metricsWritten).toBe(1);
    const token = await db.token.findUniqueOrThrow({ where: { mint: mint('newa') }, include: { metrics: true, holders: true } });
    expect(token).toMatchObject({ symbol: 'NEWT', holders: [] });
    expect(token.metrics).toHaveLength(1);
    const metric = token.metrics[0]!;
    expect(Number(metric.marketCapUsd)).toBe(30_000);
    const key = `research.market.${token.id}`;
    const latest = await db.systemSetting.findUniqueOrThrow({ where: { key } });
    expect(latest.value).toMatchObject({ metricId: metric.id, source: 'fake', pairAddress: 'pair', marketCapIsFdv: false });
    expect((await db.systemSetting.findUniqueOrThrow({ where: { key: `research.marketMetric.${metric.id}` } })).value).toEqual(latest.value);
    expect(await db.alert.count({ where: { refId: token.id } })).toBe(0); // Still requires actual holders.
    // A named social token with no narrative/wallet link now stays in normal collection.
    await refreshMarketData(db, { quotes, info: null, launches: null }, new Date(+NOW + 300_000), { maxTokens: 100_000 });
    expect(await db.tokenMetric.count({ where: { tokenId: token.id } })).toBe(2);
  });

  it('is repeatable without duplicate alerts', async () => {
    const hot = await db.token.findUniqueOrThrow({ where: { mint: mint('hot') } });
    await scanSocialTokens(db, { quotes: null }, new Date(NOW.getTime() + 2_000));
    expect(await db.alert.count({ where: { refId: hot.id, kind: 'EARLY_RADAR_TRENCHER' } })).toBe(1);
  });

  it('tops up a candidate price that the rotating market set left stale', async () => {
    const token = await addToken('topup', `T${rand(6)}`);
    await db.tokenMention.createMany({ data: Array.from({ length: 40 }, (_, i) => mention('MINT', token.mint, i % 12, i, minutesAgo(1 + (i % 30)))) });
    await db.tokenMetric.updateMany({ where: { tokenId: token.id }, data: { at: minutesAgo(300) } });
    const calls: string[] = [];
    const fresh: MarketQuoteSource = {
      name: 'fake',
      getSnapshots: async (mints) => {
        calls.push(...mints);
        return new Map(mints.filter((m) => m === token.mint).map((m) => [m, {
          mint: m, symbol: 'TOPU', name: 'Top Up', priceUsd: 0.002, marketCapUsd: 44_000, marketCapIsFdv: false,
          liquidityUsd: 12_000, volume24hUsd: 50_000, priceChange1hPct: null, pairAddress: 'pair-topup', dexId: null,
          pairCreatedAt: minutesAgo(60),
        }]));
      },
    };
    const at = new Date(NOW.getTime() + 3_000);
    const r = await scanSocialTokens(db, { quotes: fresh }, at);
    expect(calls).toContain(token.mint);
    expect(r.metricsWritten).toBeGreaterThanOrEqual(1);
    const newest = await db.tokenMetric.findFirstOrThrow({ where: { tokenId: token.id }, orderBy: { at: 'desc' } });
    expect(+newest.at).toBe(+at);
    expect(Number(newest.priceUsd)).toBe(0.002);
  });

  it('reports old prices and holders in the social route and publishes only after both refresh',async()=>{
    const token=await addToken('stale',`S${rand(6)}`);
    await db.tokenMention.createMany({data:Array.from({length:40},(_,i)=>mention('MINT',token.mint,i%12,i,minutesAgo(1+i%30)))});
    await db.tokenMetric.updateMany({where:{tokenId:token.id},data:{at:minutesAgo(300)}});
    expect((await scanSocialTokens(db,{quotes:null},NOW)).evidenceSkipped.MARKET_STALE).toBeGreaterThan(0);
    expect(await db.alert.count({where:{refId:token.id}})).toBe(0);
    await db.tokenMetric.updateMany({where:{tokenId:token.id},data:{at:NOW}});
    await db.tokenHolderMetric.updateMany({where:{tokenId:token.id},data:{at:minutesAgo(300)}});
    expect((await scanSocialTokens(db,{quotes:null},NOW)).evidenceSkipped.HOLDERS_STALE).toBeGreaterThan(0);
    expect(await db.alert.count({where:{refId:token.id}})).toBe(0);
    await db.tokenHolderMetric.updateMany({where:{tokenId:token.id},data:{at:NOW}});
    await scanSocialTokens(db,{quotes:null},NOW);
    expect(await db.alert.count({where:{refId:token.id,kind:'EARLY_RADAR_TRENCHER'}})).toBe(1);
  });
});
