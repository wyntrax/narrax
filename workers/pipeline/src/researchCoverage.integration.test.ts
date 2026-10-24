import { afterAll, beforeAll, expect, it } from 'vitest';
import { createPrisma, type Prisma } from '@narra/database';
import { DexScreenerSource, RateLimiter, FixtureMarketData, MarketDataError, snapshot, info } from '@narra/market-data';
import { scanSocialTokens } from './socialTokens';
import { refreshMarketData, GENERAL_PRICE_CURSOR_KEY, INFO_CURSOR_KEY, SOCIAL_PRICE_CURSOR_KEY } from './marketData';
import { COVERAGE_LIMITS, RESEARCH_DIAGNOSTICS_PREFIX, readSocialPriority, saveSocialPriority, saveResearchDiagnostics, readResearchDiagnostics, SOCIAL_INFO_CURSOR_KEY, SOCIAL_INFO_PRIORITY_KEY } from './researchDiagnostics';
import { researchCoverage, renderResearchCoverage } from './researchCoverage';
import { storeMarketSnapshot } from './marketSnapshot';
import { ResearchCoverageSchema } from '../../../apps/web/src/features/admin/contracts';

const db = createPrisma(), now = new Date('2051-01-01T12:00:00Z'), tag = `coverage-handoff-${Date.now()}`;
const keys = [SOCIAL_INFO_PRIORITY_KEY, SOCIAL_INFO_CURSOR_KEY, SOCIAL_PRICE_CURSOR_KEY, GENERAL_PRICE_CURSOR_KEY, INFO_CURSOR_KEY];
const settingsWhere = { OR: [{ key: { in: keys } }, { key: { startsWith: RESEARCH_DIAGNOSTICS_PREFIX } }] };
let saved: { key: string; value: Prisma.JsonValue }[] = [];
const ids: string[] = [];
beforeAll(async () => {
  saved = await db.systemSetting.findMany({ where: settingsWhere });
  await db.systemSetting.deleteMany({ where: settingsWhere });
});
afterAll(async () => {
  const metrics = await db.tokenMetric.findMany({ where: { tokenId: { in: ids } }, select: { id: true } });
  await db.systemSetting.deleteMany({ where: { key: { in: [...ids.map(id => `research.market.${id}`), ...metrics.map(m => `research.marketMetric.${m.id}`)] } } });
  await db.alert.deleteMany({ where: { refId: { in: ids } } });
  await db.tokenMention.deleteMany({ where: { externalId: { startsWith: tag } } });
  await db.token.deleteMany({ where: { id: { in: ids } } });
  await db.systemSetting.deleteMany({ where: settingsWhere });
  for (const row of saved) await db.systemSetting.create({ data: { key: row.key, value: row.value as Prisma.InputJsonValue } });
  await db.$disconnect();
});
async function token(name: string, early = false) {
  const t = await db.token.create({ data: { id: `${early ? '000' : 'zzz'}-${tag}-${name}`, mint: `${tag}-${name}`, symbol: 'TEST', name, createdOnChainAt: now } });
  ids.push(t.id);
  return t;
}

it('hands a holder-missing social token to bounded collection ahead of the general backlog without publishing', async () => {
  const t = await token('social');
  await db.$transaction(tx => storeMarketSnapshot(tx, t.id, snapshot(t.mint, { marketCapUsd: 40000 }), 'dexscreener', now));
  await db.tokenMention.createMany({ data: Array.from({ length: 6 }, (_, i) => ({ refKind: 'MINT', ref: t.mint, platform: 'X', externalId: `${tag}-${i}`, creatorId: `${tag}-creator-${i}`, textHash: String(i).padStart(16,'0'), simhash: String(i).padStart(16,'0'), engagement: 1, at: now })) });
  const scan = await scanSocialTokens(db, { quotes: null }, now);
  expect(scan.evidenceSkipped.HOLDERS_MISSING).toBeGreaterThan(0);
  expect(await readSocialPriority(db, now)).toContain(t.id);
  expect(await db.alert.count({ where: { refId: t.id } })).toBe(0);
  const general: Awaited<ReturnType<typeof token>>[] = [];
  for (let i = 0; i < 24; i++) general.push(await token(`general-${String(i).padStart(2,'0')}`, true));
  const fixture = new FixtureMarketData({ snapshots: [t, ...general].map(t => snapshot(t.mint)), info: [t, ...general].map(t => info(t.mint)) });
  const result = await refreshMarketData(db, { quotes: fixture, info: fixture, launches: null }, now);
  expect(result.tokensConsidered).toBeLessThanOrEqual(150);
  expect(result.infoCalls).toBeLessThanOrEqual(18);
  expect(result.socialTokensSelected).toBeGreaterThan(0);
  expect(result.socialInfoCalls).toBeGreaterThan(0);
  expect(result.socialInfoCalls).toBeLessThanOrEqual(6);
  expect(fixture.infoCalls[0]).toBe(t.mint);
  expect(fixture.infoCalls.some(m => general.some(t => t.mint === m))).toBe(true);
  expect(await db.tokenHolderMetric.count({ where: { tokenId: t.id } })).toBe(1);
  expect(await db.alert.count({ where: { refId: t.id } })).toBe(0);
  const before = fixture.infoCalls.length;
  await refreshMarketData(db, { quotes: fixture, info: fixture, launches: null }, new Date(+now + 60_000));
  expect(fixture.infoCalls.slice(before)).not.toContain(t.mint); // 30-minute reuse remains.
});

it('ignores expired/future hints and caps deduplicated handoff size', async () => {
  await saveSocialPriority(db, Array.from({ length: 250 }, (_, i) => `id-${i}`), now);
  expect(await readSocialPriority(db, now)).toHaveLength(COVERAGE_LIMITS.maxCandidates);
  expect(await readSocialPriority(db, new Date(+now + COVERAGE_LIMITS.priorityMaxAgeMs + 1))).toEqual([]);
  expect(await readSocialPriority(db, new Date(+now - 1))).toEqual([]);
  await saveSocialPriority(db, [], now);
  expect(await readSocialPriority(db, now)).toEqual([]);
});

it('rotates unavailable social info and preserves the cursor when throttled', async () => {
  const a = await token('retry-a'), b = await token('retry-b');
  await saveSocialPriority(db, [a.id, b.id], now);
  await db.systemSetting.deleteMany({ where: { key: SOCIAL_INFO_CURSOR_KEY } });
  const fixture = new FixtureMarketData({ snapshots: [snapshot(a.mint), snapshot(b.mint)] });
  const calls: string[] = [];
  const missing = { name: 'test', getTokenInfo: async (mint: string) => { calls.push(mint); throw new MarketDataError('network', 'missing'); } };
  await refreshMarketData(db, { quotes: fixture, info: missing, launches: null }, now, { maxInfoCalls: 2 });
  expect(calls).toContain(a.mint);
  expect(calls).toContain(b.mint);
  expect(await db.tokenHolderMetric.count({ where: { tokenId: { in: [a.id, b.id] } } })).toBe(0);
  const cursor = (await db.systemSetting.findUniqueOrThrow({ where: { key: SOCIAL_INFO_CURSOR_KEY } })).value;
  const throttled = { name: 'test', getTokenInfo: async () => { throw new MarketDataError('rate_limited', 'cooldown'); } };
  const result = await refreshMarketData(db, { quotes: fixture, info: throttled, launches: null }, now, { maxInfoCalls: 18 });
  expect(result.infoCalls).toBe(1);
  expect((await db.systemSetting.findUniqueOrThrow({ where: { key: SOCIAL_INFO_CURSOR_KEY } })).value).toBe(cursor);
});

it('serializes daily counters, preserves latest chronology and reports absent stages as unknown', async () => {
  await db.systemSetting.deleteMany({ where: { key: { startsWith: RESEARCH_DIAGNOSTICS_PREFIX } } });
  await Promise.all(Array.from({ length: 4 }, () => saveResearchDiagnostics(db, 'social', now, { tokensEvaluated: 2, evidenceSkipped: { HOLDERS_MISSING: 1 }, errors: ['secret body'] })));
  const social = (await readResearchDiagnostics(db, now)).find(s => s.stage === 'social')!;
  expect(social.today).toMatchObject({ runs: 4, counters: { tokensEvaluated: 8, 'evidence.HOLDERS_MISSING': 4, errors: 4 } });
  expect(JSON.stringify(social)).not.toContain('secret body');
  expect((await readResearchDiagnostics(db, now)).find(s => s.stage === 'market')).toMatchObject({ latest: null, today: null, stale: true });
  await saveResearchDiagnostics(db, 'social', new Date(+now - 1000), { tokensEvaluated: 1 });
  expect((await readResearchDiagnostics(db, now)).find(s => s.stage === 'social')?.latest?.at).toBe(now.toISOString());
});

it('reports missing/future/stale rows separately and requires exact price provenance', async () => {
  const a = await token('cov-a'), b = await token('cov-b'), c = await token('cov-c'), d = await token('cov-d');
  await saveSocialPriority(db, [a.id, b.id, c.id, d.id], now);
  await db.$transaction(tx => storeMarketSnapshot(tx, a.id, snapshot(a.mint), 'dexscreener', now));
  await db.$transaction(tx => storeMarketSnapshot(tx, b.id, snapshot(b.mint), 'unknown-source', now));
  await db.$transaction(tx => storeMarketSnapshot(tx, c.id, snapshot(c.mint), 'dexscreener', new Date(+now + 1000)));
  await db.tokenHolderMetric.create({ data: { tokenId: a.id, holders: 123, top10Pct: 25, at: new Date(+now - 61 * 60000) } });
  const report = await researchCoverage(db, now);
  expect(ResearchCoverageSchema.safeParse(report).success).toBe(true);
  expect(report.price.fresh).toBeGreaterThan(0);
  expect(report.price.unverified).toBeGreaterThan(0);
  expect(report.price.future).toBeGreaterThan(0);
  expect(report.price.missing).toBeGreaterThan(0);
  expect(report.holders.stale).toBeGreaterThan(0);
  expect(report.holders.missing).toBeGreaterThan(0);
  expect(report.socialPriorityCount).toBe(4);
  expect(report.cohorts.recentSocial).toEqual({ scanned: 4,
    price: { fresh: 1, stale: 0, missing: 1, future: 1, unverified: 1 },
    holders: { fresh: 0, stale: 1, missing: 3, future: 0 },
    risk: { fresh: 0, stale: 0, missing: 4, future: 0 }, freshPriceAndHolders: 0 });
  expect(report.cohorts.recentSocial.scanned + report.cohorts.narrativeOnly.scanned).toBe(report.scanned);
  for (const state of ['fresh', 'stale', 'missing', 'future', 'unverified'] as const) {
    expect(report.cohorts.recentSocial.price[state] + report.cohorts.narrativeOnly.price[state]).toBe(report.price[state]);
  }
  expect(renderResearchCoverage(report)).toContain('UNKNOWN: the latest market run has no per-group request telemetry');
});

it.each(['rate_limited', 'network'] as const)('separates missing snapshots, %s failures and unrequested batches without extra requests', async (kind) => {
  await saveSocialPriority(db, [], now);
  for (let i = 0; i < 70; i++) await token(`requests-${kind}-${i}`);
  const batches: string[][] = [];
  const quotes = { name: 'dexscreener',
    getReferencePrices: async () => new Map(),
    getSnapshots: async (mints: string[]) => {
      batches.push(mints);
      if (batches.length === 2) throw new MarketDataError(kind, 'private provider detail');
      return new Map((batches.length === 1 ? mints.slice(0, 10) : []).map(mint => [mint, snapshot(mint)]));
    } };
  const result = await refreshMarketData(db, { quotes, info: null, launches: null }, now, { maxTokens: 70 });
  expect(batches.map(b => b.length)).toEqual(kind === 'rate_limited' ? [30, 30] : [30, 30, 10]);
  expect(result.tokensConsidered).toBe(70);
  expect(result.infoCalls).toBe(0);
  const total = { selected: 0, written: 0, unavailable: 0, failed: 0, notRequested: 0 };
  for (const counts of Object.values(result.priceCoverage)) {
    expect(counts.selected).toBe(counts.written + counts.unavailable + counts.failed + counts.notRequested);
    for (const field of Object.keys(total) as (keyof typeof total)[]) total[field] += counts[field];
  }
  expect(total).toEqual({ selected: 70, written: 10, unavailable: kind === 'rate_limited' ? 20 : 30, failed: 30, notRequested: kind === 'rate_limited' ? 10 : 0 });
  expect(total.written).toBe(result.metricsWritten);
  expect(total.unavailable + total.failed + total.notRequested).toBe(result.tokensWithoutData);
  const market = (await readResearchDiagnostics(db, now)).find(s => s.stage === 'market')!;
  expect(market.latest?.counters['priceCoverage.runs']).toBe(1);
  expect(market.latest?.counters['price.general.failed']).toBe(30);
  expect(market.latest?.counters['omission.general.UNSPECIFIED']).toBe(total.unavailable);
  expect(Object.values(result.priceOmissions).reduce((sum, reasons) => sum + Object.values(reasons).reduce((n, count) => n + count, 0), 0)).toBe(total.unavailable);
  expect(JSON.stringify(market)).not.toContain('private provider detail');
  expect(renderResearchCoverage(await researchCoverage(db, now))).toContain('No usable snapshot means a completed request returned none');
});

it('persists reasons from the same quote batch without issuing a fallback request', async () => {
  await token('diagnosed-a'); await token('diagnosed-b');
  const requests: string[][] = [];
  const quotes = new DexScreenerSource({ limiter: new RateLimiter(0), fetch: async input => {
    const mints = String(input).split('/').at(-1)!.split(','); requests.push(mints);
    return new Response(JSON.stringify(mints.map((mint, i) => ({ chainId: 'solana', pairAddress: 'pair', baseToken: { address: mint }, priceUsd: '1', liquidity: i === 0 ? { usd: 20000 } : null, volume: { h24: 10 }, marketCap: 50000 }))));
  } });
  const result = await refreshMarketData(db, { quotes, info: null, launches: null }, now, { maxTokens: 2 });
  expect(requests.map(batch => batch.length)).toEqual([1, 2]); // SOL reference, then one token batch.
  expect(result.metricsWritten).toBe(1);
  expect(result.tokensWithoutData).toBe(1);
  expect(Object.values(result.priceOmissions)).toEqual([{ LIQUIDITY_UNAVAILABLE: 1 }]);
  const report = await researchCoverage(db, now);
  expect(renderResearchCoverage(report)).toContain('LIQUIDITY_UNAVAILABLE: 1');
  expect(report.stages.find(s => s.stage === 'market')?.latest?.counters['priceOmissions.runs']).toBe(1);
});
