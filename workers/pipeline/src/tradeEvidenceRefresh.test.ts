import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@narra/database';
import { WSOL_MINT, type MarketSnapshot, type TokenInfo } from '@narra/market-data';
import { refreshTradeEvidence } from './tradeEvidenceRefresh';
import type { HolderRpcSource } from './holderRpc';

const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const NOW = new Date('2026-11-26T12:00:00Z');

function makeSnap(overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    mint: MINT,
    symbol: 'TEST',
    name: 'Test Token',
    priceUsd: 0.12,
    marketCapUsd: 1_200_000,
    marketCapIsFdv: false,
    liquidityUsd: 85_000,
    volume24hUsd: 240_000,
    priceChange1hPct: 4.5,
    pairAddress: 'PairAddress11111111111111111111111111111111',
    dexId: 'raydium',
    pairCreatedAt: new Date(NOW.getTime() - 3 * 3_600_000),
    ...overrides,
  };
}

function makeMockDb(existingToken: Record<string, unknown> | null, settings: Record<string, unknown> = {}) {
  const settingsStore = new Map<string, unknown>(Object.entries(settings));
  let metricSeq = 0;
  let holderSeq = 0;
  const createdMetrics: Record<string, unknown>[] = [];
  const createdHolders: Record<string, unknown>[] = [];
  const createdRisks: Record<string, unknown>[] = [];
  const tokenUpdates: Record<string, unknown>[] = [];

  const tx = {
    tokenMetric: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `metric-${++metricSeq}`, ...data };
        createdMetrics.push(row);
        return row;
      }),
    },
    tokenHolderMetric: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `holder-${++holderSeq}`, ...data };
        createdHolders.push(row);
        return row;
      }),
    },
    systemSetting: {
      upsert: vi.fn(async ({ where, create, update }: { where: { key: string }; create: { value: unknown }; update: { value: unknown } }) => {
        settingsStore.set(where.key, settingsStore.has(where.key) ? update.value : create.value);
        return { key: where.key, value: settingsStore.get(where.key) };
      }),
      create: vi.fn(async ({ data }: { data: { key: string; value: unknown } }) => {
        settingsStore.set(data.key, data.value);
        return data;
      }),
    },
  };

  const db = {
    token: {
      findUnique: vi.fn(async () => existingToken),
      upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => ({
        id: 'tok-new',
        mint: create.mint,
        symbol: create.symbol,
        name: create.name,
        blacklisted: false,
        createdOnChainAt: null,
        marketQuoteFailures: 0,
        marketQuarantineUntil: null,
        metrics: [],
        holders: [],
        risk: [],
      })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        tokenUpdates.push(data);
        return { id: existingToken?.id ?? 'tok-new', ...data };
      }),
    },
    systemSetting: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) =>
        settingsStore.has(where.key) ? { value: settingsStore.get(where.key) } : null,
      ),
      upsert: tx.systemSetting.upsert,
      create: tx.systemSetting.create,
    },
    tokenHolderMetric: {
      create: tx.tokenHolderMetric.create,
      findFirst: vi.fn(async () => createdHolders[createdHolders.length - 1] ?? null),
    },
    tokenRiskMetric: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        createdRisks.push(data);
        return { id: `risk-${createdRisks.length}`, ...data };
      }),
    },
    $queryRaw: vi.fn(async () => []),
    $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
  } as unknown as PrismaClient;

  return { db, createdMetrics, createdHolders, createdRisks, tokenUpdates, settingsStore };
}

describe('refreshTradeEvidence', () => {
  it('skips all external calls when market, holders, and risk are already fresh', async () => {
    const freshAt = new Date(NOW.getTime() - 5 * 60_000);
    const { db } = makeMockDb(
      {
        id: 'tok-1',
        mint: MINT,
        symbol: 'TEST',
        name: 'Test',
        blacklisted: false,
        createdOnChainAt: new Date(NOW.getTime() - 5 * 3_600_000),
        marketQuoteFailures: 0,
        marketQuarantineUntil: null,
        metrics: [{ id: 'm1', at: freshAt, liquidityUsd: 50_000 }],
        holders: [{ at: freshAt, holders: 200, top10Pct: 22 }],
        risk: [{ at: freshAt }],
      },
      { 'research.market.tok-1': { metricId: 'm1', stale: false } },
    );
    const quotes = { name: 'dexscreener', getSnapshots: vi.fn() };
    const info = { name: 'geckoterminal', getTokenInfo: vi.fn() };
    const holderFallback: HolderRpcSource = { get: vi.fn() };

    const res = await refreshTradeEvidence(db, { quotes, info, holderFallback }, MINT, NOW);
    expect(res.status).toBe('already_fresh');
    expect(quotes.getSnapshots).not.toHaveBeenCalled();
    expect(info.getTokenInfo).not.toHaveBeenCalled();
    expect(holderFallback.get).not.toHaveBeenCalled();
  });

  it('selectively refreshes only market when holders and risk are still fresh', async () => {
    const staleMarket = new Date(NOW.getTime() - 25 * 60_000);
    const freshInfo = new Date(NOW.getTime() - 20 * 60_000);
    const { db, createdMetrics } = makeMockDb(
      {
        id: 'tok-1',
        mint: MINT,
        symbol: 'TEST',
        name: 'Test',
        blacklisted: false,
        createdOnChainAt: new Date(NOW.getTime() - 5 * 3_600_000),
        marketQuoteFailures: 0,
        marketQuarantineUntil: null,
        metrics: [{ id: 'm1', at: staleMarket, liquidityUsd: 50_000 }],
        holders: [{ at: freshInfo, holders: 200, top10Pct: 22 }],
        risk: [{ at: freshInfo }],
      },
      { 'research.market.tok-1': { metricId: 'm1', stale: false } },
    );
    const quotes = { name: 'dexscreener', getSnapshots: vi.fn(async () => new Map([[MINT, makeSnap()]])) };
    const info = { name: 'geckoterminal', getTokenInfo: vi.fn() };
    const holderFallback: HolderRpcSource = { get: vi.fn() };

    const res = await refreshTradeEvidence(db, { quotes, info, holderFallback }, MINT, NOW);
    expect(res.status).toBe('refreshed');
    expect(res.marketWritten).toBe(true);
    expect(res.holdersWritten).toBe(false);
    expect(res.riskWritten).toBe(false);
    expect(createdMetrics).toHaveLength(1);
    expect(quotes.getSnapshots).toHaveBeenCalledTimes(1);
    expect(info.getTokenInfo).not.toHaveBeenCalled();
    expect(holderFallback.get).not.toHaveBeenCalled();
  });

  it('auto-indexes unknown mint and short-circuits with zero RPC calls when no active pool exists', async () => {
    const { db } = makeMockDb(null);
    const quotes = { name: 'dexscreener', getSnapshots: vi.fn(async () => new Map()) };
    const info = { name: 'geckoterminal', getTokenInfo: vi.fn() };
    const holderFallback: HolderRpcSource = { get: vi.fn() };

    const res = await refreshTradeEvidence(db, { quotes, info, holderFallback }, MINT, NOW);
    expect(res.status).toBe('no_pool');
    expect(res.tokenCreated).toBe(true);
    expect(res.marketWritten).toBe(false);
    expect(quotes.getSnapshots).toHaveBeenCalledTimes(1);
    expect(info.getTokenInfo).not.toHaveBeenCalled();
    expect(holderFallback.get).not.toHaveBeenCalled();
  });

  it('uses holderFallback when token-info holders are stale and writes risk with fresh holder counts', async () => {
    const { db, createdMetrics, createdHolders, createdRisks } = makeMockDb(null);
    const quotes = { name: 'dexscreener', getSnapshots: vi.fn(async () => new Map([[MINT, makeSnap()]])) };
    const staleHolderDate = new Date(NOW.getTime() - 3 * 3_600_000);
    const info = {
      name: 'geckoterminal',
      getTokenInfo: vi.fn(async (): Promise<TokenInfo> => ({
        mint: MINT,
        name: 'Test Token',
        symbol: 'TEST',
        websites: [],
        twitterHandle: null,
        holders: 120,
        top10Pct: 28,
        holdersUpdatedAt: staleHolderDate,
        mintAuthorityActive: false,
        freezeAuthorityActive: false,
        isHoneypot: false,
      })),
    };
    const holderFallback: HolderRpcSource = {
      get: vi.fn(async () => ({
        ok: true as const,
        mint: MINT,
        holders: 340,
        top10Pct: 19.5,
        sourceAt: new Date(NOW.getTime() - 5_000),
        slot: 123456,
        program: 'spl-token',
        accounts: 340,
      })),
    };

    const res = await refreshTradeEvidence(db, { quotes, info, holderFallback }, MINT, NOW);
    expect(res.status).toBe('refreshed');
    expect(res.marketWritten).toBe(true);
    expect(res.holdersWritten).toBe(true);
    expect(res.holderFallbackUsed).toBe(true);
    expect(res.riskWritten).toBe(true);
    expect(createdMetrics).toHaveLength(1);
    expect(createdHolders.length).toBeGreaterThanOrEqual(1);
    expect(createdRisks).toHaveLength(1);
    // Risk flags should NOT contain stale/unknown holder flags because holderFallback succeeded first.
    expect(createdRisks[0]!.flags).not.toContain('HOLDERS_UNKNOWN');
    expect(createdRisks[0]!.flags).not.toContain('HOLDER_OBSERVATION_STALE_OR_UNKNOWN');
  });

  it('rejects WSOL and skips blacklisted tokens with zero provider calls', async () => {
    const { db } = makeMockDb({ id: 'tok-bad', mint: MINT, blacklisted: true, metrics: [], holders: [], risk: [] });
    const quotes = { name: 'dexscreener', getSnapshots: vi.fn() };
    const info = { name: 'geckoterminal', getTokenInfo: vi.fn() };

    expect((await refreshTradeEvidence(db, { quotes, info }, WSOL_MINT, NOW)).status).toBe('invalid_mint');
    expect((await refreshTradeEvidence(db, { quotes, info }, MINT, NOW)).status).toBe('blacklisted');
    expect(quotes.getSnapshots).not.toHaveBeenCalled();
    expect(info.getTokenInfo).not.toHaveBeenCalled();
  });
});
