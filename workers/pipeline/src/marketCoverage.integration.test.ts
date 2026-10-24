import { afterAll, beforeAll, expect, it } from 'vitest';
import { createPrisma, type Prisma } from '@narra/database';
import { FixtureMarketData, MarketDataError, WSOL_MINT, snapshot, info, type MarketQuoteSource } from '@narra/market-data';
import { GENERAL_PRICE_CURSOR_KEY, INFO_CURSOR_KEY, DISCOVERY_PRICE_CURSOR_KEY, refreshMarketData } from './marketData';

const db = createPrisma(), tag = `coverage-${Date.now()}`;
const now = new Date('2050-01-01T12:00:00Z');
const prefix = `000-${tag}-`;
const keys = [GENERAL_PRICE_CURSOR_KEY, INFO_CURSOR_KEY, DISCOVERY_PRICE_CURSOR_KEY];
let saved: { key: string; value: Prisma.JsonValue }[] = [];
let cap = 8;
beforeAll(async () => {
  saved = await db.systemSetting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } });
  const waiting = await db.earlyRadarMeasurement.findMany({ where: { status: 'PENDING' }, orderBy: [{ nextCheckAt: 'asc' }, { id: 'asc' }], take: 500, select: { outcome: { select: { tokenId: true } } } });
  const ids = [...new Set(waiting.map(w => w.outcome.tokenId))].slice(0, 100);
  cap += await db.token.count({ where: { id: { in: ids }, blacklisted: false, mint: { not: WSOL_MINT } } });
});
afterAll(async () => {
  const tokens = await db.token.findMany({ where: { mint: { startsWith: tag } }, select: { id: true, metrics: { select: { id: true } } } });
  await db.systemSetting.deleteMany({ where: { key: { in: tokens.flatMap(t => [`research.market.${t.id}`, ...t.metrics.map(m => `research.marketMetric.${m.id}`)]) } } });
  await db.token.deleteMany({ where: { id: { in: tokens.map(t => t.id) } } });
  await db.systemSetting.deleteMany({ where: { key: { in: keys } } });
  for (const row of saved) await db.systemSetting.create({ data: { key: row.key, value: row.value as Prisma.InputJsonValue } });
  await db.$disconnect();
});
async function cursor(key: string, value: string) {
  await db.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}
async function make(suffix: string, blacklisted = false) {
  return db.token.create({ data: { id: prefix + suffix, mint: `${tag}-${suffix}`, symbol: 'KNOWN', name: suffix, blacklisted, createdOnChainAt: new Date(+now - 60_000) } });
}

it('rotates capped general coverage past missing quotes and wraps without duplicate requests', async () => {
  const tokens = [];
  for (let i = 0; i < 9; i++) tokens.push(await make(`a${i}`));
  const blocked = await make('a-blocked', true);
  const wanted = new Set(tokens.map(t => t.mint)), seen = new Set<string>();
  await cursor(GENERAL_PRICE_CURSOR_KEY, prefix);
  const quotes: MarketQuoteSource = { name: 'coverage-test', getSnapshots: async mints => {
    expect(new Set(mints).size).toBe(mints.length);
    expect(mints).not.toContain(blocked.mint);
    for (const mint of mints) if (wanted.has(mint)) seen.add(mint);
    return new Map(); // No price is invented, but these requests still advance coverage.
  } };
  for (let i = 0; i < 5 && seen.size < tokens.length; i++) {
    const result = await refreshMarketData(db, { quotes, info: null, launches: null }, now, { maxTokens: cap });
    expect(result.tokensConsidered).toBeLessThanOrEqual(cap);
    expect(result.generalTokensSelected).toBeGreaterThan(0);
  }
  expect([...seen].sort()).toEqual([...wanted].sort());
  expect(await db.tokenMetric.count({ where: { tokenId: { in: tokens.map(t => t.id) } } })).toBe(0);
  seen.clear();
  // A deleted/end-of-range cursor must wrap; cursors do not require the row to survive.
  await cursor(GENERAL_PRICE_CURSOR_KEY, 'zzzz-deleted');
  await refreshMarketData(db, { quotes, info: null, launches: null }, now, { maxTokens: cap });
  expect(seen.has(tokens[0]!.mint)).toBe(true);
});

it('reserves a first quote for a fresh launch and retries it after it leaves the launch page', async () => {
  const mint = `${tag}-launch`;
  const launches = new FixtureMarketData({ pools: [{ mint, symbol: 'FRESH', name: 'Fresh launch', poolAddress: 'pool', createdAt: now, liquidityUsd: 5_000 }] });
  const requests: string[] = [];
  const quotes: MarketQuoteSource = { name: 'coverage-test', getSnapshots: async mints => { requests.push(...mints); return new Map(); } };
  const result = await refreshMarketData(db, { quotes, info: null, launches }, now, { maxTokens: cap });
  expect(result.launchTokensSelected).toBe(1);
  expect(result.tokensConsidered).toBeLessThanOrEqual(cap);
  expect(requests).toContain(mint);
  const token = await db.token.findUniqueOrThrow({ where: { mint } });
  // Start just before this id; without young-pool retry it has no eligible relation/price/placeholder.
  await cursor(GENERAL_PRICE_CURSOR_KEY, token.id.slice(0, -1));
  const usable = new FixtureMarketData({ snapshots: [snapshot(mint)] });
  await refreshMarketData(db, { quotes: usable, info: null, launches: null }, new Date(+now + 300_000), { maxTokens: cap });
  expect(await db.tokenMetric.count({ where: { tokenId: token.id } })).toBe(1);
});

it('keeps the general cursor on a throttled batch for the next scheduled run', async () => {
  await cursor(GENERAL_PRICE_CURSOR_KEY, prefix);
  const quotes: MarketQuoteSource = { name: 'throttled', getSnapshots: async mints => {
    if (mints.includes(WSOL_MINT)) return new Map();
    throw new MarketDataError('rate_limited', 'retry next run');
  } };
  const result = await refreshMarketData(db, { quotes, info: null, launches: null }, now, { maxTokens: cap });
  expect(result.errors.join(' ')).toContain('rate_limited');
  expect((await db.systemSetting.findUniqueOrThrow({ where: { key: GENERAL_PRICE_CURSOR_KEY } })).value).toBe(prefix);
});

it('rotates holder attempts past a failing token, preserves missingness, and stops on throttling', async () => {
  const bad = await make('b0'), good = await make('b1'), partial = await make('b2');
  const quotes = new FixtureMarketData({ snapshots: [bad, good, partial].map(t => snapshot(t.mint)) });
  const calls: string[] = [];
  let throttled = false;
  const source = { name: 'info-test', getTokenInfo: async (mint: string) => {
    calls.push(mint);
    if (throttled) throw new MarketDataError('rate_limited', 'wait');
    if (mint === bad.mint) throw new MarketDataError('network', 'unavailable');
    return info(mint, { holders: 123, top10Pct: mint === partial.mint ? null : 25 });
  } };
  await cursor(INFO_CURSOR_KEY, prefix);
  for (let i = 0; i < 3; i++) await refreshMarketData(db, { quotes, info: source, launches: null }, new Date(+now + i * 1_000), { maxTokens: 100_000, maxInfoCalls: 1 });
  expect(calls).toEqual([bad.mint, good.mint, partial.mint]);
  expect(await db.tokenHolderMetric.count({ where: { tokenId: bad.id } })).toBe(0);
  expect(await db.tokenHolderMetric.count({ where: { tokenId: partial.id } })).toBe(0);
  expect(await db.tokenHolderMetric.findFirst({ where: { tokenId: good.id } })).toMatchObject({ holders: 123, top10Pct: 25 });
  const before = (await db.systemSetting.findUniqueOrThrow({ where: { key: INFO_CURSOR_KEY } })).value;
  throttled = true;
  await refreshMarketData(db, { quotes, info: source, launches: null }, new Date(+now + 3_000), { maxTokens: 100_000, maxInfoCalls: 20 });
  expect(calls).toHaveLength(4);
  expect((await db.systemSetting.findUniqueOrThrow({ where: { key: INFO_CURSOR_KEY } })).value).toBe(before);
});
