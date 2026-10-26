import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPrisma } from '@narra/database';
import { FixtureMarketData, MarketDataError, WSOL_MINT, info, snapshot, type LaunchSource } from '@narra/market-data';
import { readSolUsd, refreshMarketData } from './marketData';
import { resolveTokens } from './tokenResolution';
// The end-to-end case scans accumulated shared PostgreSQL fixtures; files run serially but can exceed 5 s.
vi.setConfig({ testTimeout: 30_000 });

const url = process.env.DATABASE_URL ?? 'postgresql://narra:narra@localhost:5432/narra';
async function dbUp() {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 800 });
  try { await c.connect(); await c.query('select 1 from "TokenRiskMetric" limit 1'); return true; } catch { return false; } finally { await c.end().catch(() => {}); }
}
const up = await dbUp();

describe.skipIf(!up)('market data refresh on a real Postgres', () => {
  const db = createPrisma(url);
  const tag = `md${Date.now()}`;
  const rand = (n: number) => Array.from({ length: n }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');
  const W = `${rand(5)}o${rand(5)}`;
  const SYM = W.toUpperCase();
  const NOW = new Date('2026-09-30T12:00:00Z');
  const H = 3_600_000;
  const ago = (h: number) => new Date(NOW.getTime() - h * H);
  const mint = (k: string) => `${k}${tag}`.padEnd(40, '1');
  const M = { OG: mint('OG'), DERIV: mint('DV'), HONEY: mint('HP'), JUNK: mint('JK'), NOLIQ: mint('NL'), OLD: mint('OL'), GHOST: mint('GH'), PARTIAL: mint('PT'), NOINFO: mint('NI') };
  const ROOMY = { maxTokens: 100_000 };
  let narrativeId = '';

  const pool = (m: string, symbol: string, name: string, liq: number | null, createdHoursAgo: number) => ({ mint: m, symbol, name, poolAddress: `pool-${m}`, createdAt: ago(createdHoursAgo), liquidityUsd: liq });
  const fixture = new FixtureMarketData({
    pools: [
      pool(M.OG, SYM, `${W} Token`, 80_000, 5),
      pool(M.DERIV, `${SYM}3\u202E`, `${W} Three`, 80_000, 2),
      pool(M.HONEY, `${SYM}2`, `${W} Two`, 80_000, 2.3),
      pool(M.JUNK, 'JUNK', 'Junk', 900, 1),
      pool(M.NOLIQ, 'NOLIQ', 'No Liquidity Figure', null, 1),
    ],
    snapshots: [
      snapshot(WSOL_MINT, { symbol: 'SOL', name: 'Wrapped SOL', priceUsd: 142.5 }),
      snapshot(M.OG, { liquidityUsd: 600_000, priceUsd: 0.01 }),
      snapshot(M.DERIV, { liquidityUsd: 500_000, priceUsd: 0.002, marketCapUsd: 90_000, marketCapIsFdv: true }),
      snapshot(M.HONEY, { liquidityUsd: 500_000, priceUsd: 0.003 }),
      snapshot(M.OLD, { symbol: `Old${tag}`, name: 'Old Token', priceUsd: 1, pairCreatedAt: ago(48) }),
      snapshot(M.PARTIAL, { symbol: 'PART', name: 'Partial', liquidityUsd: 400_000 }),
      snapshot(M.NOINFO, { symbol: 'NOINFO', name: 'No Info Token' }),
    ],
    info: [
      info(M.OG, { holders: 1500, top10Pct: 25 }),
      info(M.DERIV, { holders: 900, top10Pct: 30 }),
      info(M.HONEY, { holders: 900, top10Pct: 20, isHoneypot: true }),
      info(M.OLD, { holders: 300, top10Pct: 50, mintAuthorityActive: true }),
      info(M.PARTIAL, { holders: null, top10Pct: 30 }),
    ],
  });

  beforeAll(async () => {
    // Placeholders like the wallet-event worker makes: no name, no age.
    for (const k of ['OLD', 'GHOST', 'PARTIAL', 'NOINFO'] as const) await db.token.create({ data: { mint: M[k], symbol: 'UNKNOWN', name: 'Unknown' } });
    narrativeId = (await db.narrative.create({ data: { name: `${W} Drone`, slug: `zorblax-${tag}`, stage: 'ACCELERATING', score: 91, velocity: 284, organicScore: 88, firstDetectedAt: ago(3) } })).id;
    await db.narrativeMetric.create({ data: { narrativeId, score: 91, velocity: 284, acceleration: 10, organicScore: 88, manipulationRisk: 12, mentionVelocity: 284, creatorVelocity: 80, engagementVelocity: 120, at: NOW } });
  });
  afterAll(async () => { await db.$disconnect(); });

  const tok = (m: string) => db.token.findUniqueOrThrow({ where: { mint: m }, include: { metrics: true, holders: true, risk: true } });

  it('creates tokens from real launches only, and sanitizes their names', async () => {
    const r = await refreshMarketData(db, { quotes: fixture, info: fixture, launches: fixture }, NOW, ROOMY);
    expect(r.launchesSeen).toBe(5);
    expect(r.tokensCreated).toBe(3);
    expect(await db.token.findUnique({ where: { mint: M.JUNK } })).toBeNull();
    expect(await db.token.findUnique({ where: { mint: M.NOLIQ } })).toBeNull();
    const d = await tok(M.DERIV);
    expect(d.symbol).toBe(`${SYM}3`);
    expect(d.createdOnChainAt?.getTime()).toBe(ago(2).getTime());
  });

  it('writes a price row, a holder row and a risk row for each priced token', async () => {
    const og = await tok(M.OG);
    expect(og.metrics).toHaveLength(1);
    expect(Number(og.metrics[0]!.liquidityUsd.toString())).toBe(600_000);
    expect(og.holders).toHaveLength(1);
    expect(og.holders[0]).toMatchObject({ holders: 1500, top10Pct: 25, devHoldingPct: null });
    expect(og.risk[0]!.flags).toContain('DEV_HOLDING_UNKNOWN');
  });

  it('fills placeholder tokens with a name and an approximate age', async () => {
    const old = await tok(M.OLD);
    expect(old.symbol).toBe(`Old${tag}`);
    expect(old.name).toBe('Old Token');
    expect(old.createdOnChainAt?.getTime()).toBe(ago(48).getTime());
    expect(old.risk[0]!.flags).toContain('MINT_AUTHORITY_ACTIVE');
  });

  it('writes nothing for a token the source has no complete data for', async () => {
    const ghost = await tok(M.GHOST);
    expect(ghost.metrics).toHaveLength(0);
    expect(ghost.holders).toHaveLength(0);
    expect(ghost.symbol).toBe('UNKNOWN');
  });

  it('does not invent a holder row when one holder figure is missing, but still records the risk', async () => {
    const p = await tok(M.PARTIAL);
    expect(p.metrics).toHaveLength(1);
    expect(p.holders).toHaveLength(0);
    expect(p.risk[0]!.flags).toEqual(expect.arrayContaining(['HOLDERS_UNKNOWN']));
  });

  it('records INFO_UNAVAILABLE when the slow source does not know the token', async () => {
    const n = await tok(M.NOINFO);
    expect(n.holders).toHaveLength(0);
    expect(n.risk[0]!.flags).toContain('INFO_UNAVAILABLE');
  });

  it('stores SOL/USD and refuses to serve it when stale or missing', async () => {
    expect(await readSolUsd(db, NOW)).toBe(142.5);
    await expect(readSolUsd(db, new Date(NOW.getTime() + H))).rejects.toThrow(/stale/);
    await db.systemSetting.update({ where: { key: 'market.solUsd' }, data: { value: { priceUsd: 0, at: NOW.toISOString() } } });
    await expect(readSolUsd(db, NOW)).rejects.toThrow(/not available/);
    await refreshMarketData(db, { quotes: fixture, info: null, launches: null }, NOW, ROOMY); // restores the row
    expect(await readSolUsd(db, NOW)).toBe(142.5);
  });

  it('refreshes SOL/USD from a reference price when its pool has no market cap', async () => {
    const at = new Date(NOW.getTime() + 30 * 60_000);
    const quotes = {
      name: 'reference-only',
      getSnapshots: async () => new Map(),
      getReferencePrices: async (mints: string[]) => new Map(mints.map((mint) => [mint, 150.25])),
    };
    const r = await refreshMarketData(db, { quotes, info: null, launches: null }, at, ROOMY);
    expect(r.errors).toEqual([]);
    expect(r.solUsd).toBe(150.25);
    expect(await readSolUsd(db, at)).toBe(150.25);
  });

  it('reuses token info for 30 minutes instead of spending the slow source budget again', async () => {
    const before = fixture.infoCalls.length;
    const r = await refreshMarketData(db, { quotes: fixture, info: fixture, launches: fixture }, new Date(NOW.getTime() + 10 * 60_000), ROOMY);
    expect(r.tokensCreated).toBe(0);
    expect(r.infoCalls).toBe(0);
    expect(fixture.infoCalls.length).toBe(before);
    expect((await tok(M.OG)).metrics.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps writing prices when the launch or info source fails', async () => {
    const broken: LaunchSource = { name: 'broken', getNewPools: async () => { throw new MarketDataError('rate_limited', 'slow down'); } };
    const failingInfo = { name: 'failing', getTokenInfo: async () => { throw new MarketDataError('rate_limited', 'slow down'); } };
    const at = new Date(NOW.getTime() + 2 * H);
    const r = await refreshMarketData(db, { quotes: fixture, info: failingInfo, launches: broken }, at, ROOMY);
    expect(r.errors.some((e) => e.includes('broken'))).toBe(true);
    expect(r.errors.some((e) => e.includes('failing'))).toBe(true);
    expect(r.metricsWritten).toBeGreaterThan(0);
    // An attempted HTTP call still spends the budget when the provider throttles it.
    expect(r.infoCalls).toBe(1);
    expect(r.riskRowsWritten).toBe(0);
  });

  it('feeds token resolution end to end: ranks real candidates and never a honeypot', async () => {
    // Fresh holder and price rows at NOW were written by the first run, so resolve at NOW.
    await resolveTokens(db, NOW);
    const opp = (m: string) => db.opportunity.count({ where: { token: { mint: m }, narrativeId } });
    const rel = await db.narrativeTokenRelation.findUniqueOrThrow({ where: { narrativeId_tokenId: { narrativeId, tokenId: (await tok(M.OG)).id } } });
    expect(rel.relation).toBe('OG');
    expect(await opp(M.OG)).toBe(1);
    expect(await opp(M.DERIV)).toBe(1); // control: same stats as the honeypot, so the guard is what stops it
    expect(await db.narrativeTokenRelation.count({ where: { narrativeId, tokenId: (await tok(M.HONEY)).id } })).toBe(1);
    expect(await opp(M.HONEY)).toBe(0);
    expect((await tok(M.HONEY)).risk[0]).toMatchObject({ riskScore: 100, flags: ['HONEYPOT'] });
  });
  it('writes measured issuer holdings and removes UNKNOWN only with evidence', async () => {
    const testMint = mint('ISSUER');
    const token = await db.token.create({ data: { mint: testMint, symbol: 'UNKNOWN', name: 'Unknown' } });
    const measured = new FixtureMarketData({ snapshots: [snapshot(testMint)], info: [info(testMint, { holders: 100, top10Pct: 20 })] });
    await refreshMarketData(db, { quotes: measured, info: measured, launches: null, developerHoldings: { getHolding: async () => ({ wallet: '11111111111111111111111111111111', signature: 'creation', source: 'INITIAL_MINT_AUTHORITY', holdingPct: 7.5 }) } }, NOW, ROOMY);
    const holding = await db.tokenHolderMetric.findFirstOrThrow({ where: { tokenId: token.id } });
    expect(holding.devHoldingPct).toBe(7.5);
    const risk = await db.tokenRiskMetric.findFirstOrThrow({ where: { tokenId: token.id } });
    expect(risk.flags).not.toContain('DEV_HOLDING_UNKNOWN');
    const evidence = await db.systemSetting.findUniqueOrThrow({ where: { key: `research.developerHolding.${token.id}` } });
    expect(evidence.value).toMatchObject({ holdingPct: 7.5, relatedWalletsIncluded: false });
  });
  it('prices an unpriced narrative candidate before the id-ordered cap can starve it', async () => {
    // A narrative has linked this token but it has never had a price row, so it is invisible to resolution.
    const candidate = await db.token.create({ data: { mint: mint('CAND'), symbol: `CAND${tag}`, name: 'Candidate' } });
    await db.narrativeTokenRelation.create({ data: { narrativeId, tokenId: candidate.id, relation: 'DERIVATIVE', matchScore: 0.5, ogScore: 10, confidence: 0.5 } });
    // Leave room for exactly one token after the early-radar priority group, mirroring the worker's own arithmetic.
    // An id-ordered set alone would spend that slot on an older token and skip the candidate.
    const waiting = await db.earlyRadarMeasurement.findMany({ where: { status: 'PENDING' }, select: { outcome: { select: { tokenId: true } } } });
    const cap = Math.min(new Set(waiting.map((w) => w.outcome.tokenId)).size, 100) + 1;
    const quotes = { name: 'probe', getSnapshots: async (mints: string[]) => new Map(mints.map((m) => [m, snapshot(m, { liquidityUsd: 300_000, priceUsd: 0.05 })])) };
    await refreshMarketData(db, { quotes: quotes as never, info: null, launches: null }, new Date(NOW.getTime() + 3 * H), { maxTokens: cap });
    expect((await tok(candidate.mint)).metrics).toHaveLength(1);
  });
  it('keeps cached holder source time and excludes stale counts from freshly computed risk',async()=>{
    const token=await db.token.create({data:{mint:mint('CACHED'),symbol:'CACHE',name:'Cached holders',createdOnChainAt:NOW}}),sourceAt=ago(24);
    const cached=new FixtureMarketData({snapshots:[snapshot(token.mint)],info:[info(token.mint,{holders:5919,top10Pct:88.83,holdersUpdatedAt:sourceAt})]});
    await refreshMarketData(db,{quotes:cached,info:cached,launches:null},NOW,ROOMY);
    const row=await db.tokenHolderMetric.findFirstOrThrow({where:{tokenId:token.id}});
    expect(row.at).toEqual(sourceAt);
    const evidence=await db.systemSetting.findUniqueOrThrow({where:{key:`research.holders.${token.id}`}});
    expect(evidence.value).toMatchObject({sourceAt:sourceAt.toISOString(),retrievedAt:NOW.toISOString(),holders:5919});
    const risk=await db.tokenRiskMetric.findFirstOrThrow({where:{tokenId:token.id}});
    expect(risk.flags).toContain('HOLDER_OBSERVATION_STALE_OR_UNKNOWN');expect(risk.flags).not.toContain('TOP10_OVER_60');
  });
});
