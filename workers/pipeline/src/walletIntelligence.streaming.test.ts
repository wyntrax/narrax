import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@narra/database';
import { recomputeWalletIntelligence, slimPerformanceTrade } from './walletIntelligence';
import type { IntelligenceTradeRow } from './walletIntelligenceRead';

describe('slimPerformanceTrade', () => {
  const at = new Date('2040-01-01T12:00:00Z');
  const baseRow = (over: Partial<IntelligenceTradeRow> = {}): IntelligenceTradeRow => ({
    id: 't1',
    walletId: 'w1',
    tokenId: 'tok1',
    side: 'BUY',
    amountSol: { toString: () => '1.25' } as never,
    tokenAmount: { toString: () => '500' } as never,
    at,
    marketCapUsd: { toString: () => '85000' } as never,
    evidence: {
      eventAt: at.toISOString(),
      signature: 'sig-long-payload',
      solPriceUsd: 200,
      market: {
        at: at.toISOString(),
        source: 'dexscreener',
        marketCapIsFdv: false,
        pairAddress: 'pair1',
        dexId: 'raydium',
        priceChange1hPct: 12,
      },
    },
    ...over,
  });

  it('keeps only the DexScreener non-FDV evidence fields needed for entry-band classification', () => {
    const slim = slimPerformanceTrade(baseRow());
    expect(slim).toEqual({
      id: 't1',
      tokenId: 'tok1',
      side: 'BUY',
      amountSol: '1.25',
      tokenAmount: '500',
      marketCapUsd: '85000',
      evidence: {
        eventAt: at.toISOString(),
        market: { at: at.toISOString(), source: 'dexscreener', marketCapIsFdv: false },
      },
      at,
    });
  });

  it('drops evidence and marketCapUsd on sells or FDV/non-dexscreener entries', () => {
    expect(slimPerformanceTrade(baseRow({ side: 'SELL' }))).toMatchObject({
      evidence: null,
      marketCapUsd: null,
    });
    expect(
      slimPerformanceTrade(
        baseRow({
          evidence: {
            eventAt: at.toISOString(),
            market: { at: at.toISOString(), source: 'dexscreener', marketCapIsFdv: true },
          },
        }),
      ),
    ).toMatchObject({ evidence: null, marketCapUsd: null });
    expect(
      slimPerformanceTrade(
        baseRow({
          evidence: {
            eventAt: at.toISOString(),
            market: { at: at.toISOString(), source: 'geckoterminal', marketCapIsFdv: false },
          },
        }),
      ),
    ).toMatchObject({ evidence: null, marketCapUsd: null });
  });
});

describe('recomputeWalletIntelligence streaming cap', () => {
  it('caps stored performance rows at 10,000 per wallet while accounting all tradesUsed', async () => {
    const now = new Date('2040-01-01T12:00:00Z');
    const total = 10_005;
    const allRows = Array.from({ length: total }, (_, i) => ({
      id: `r-${String(i).padStart(5, '0')}`,
      walletId: 'w1',
      tokenId: `tok-${i}`,
      side: 'BUY' as const,
      amountSol: '0.1',
      tokenAmount: '10',
      at: new Date(+now - (total - i) * 1000),
      marketCapUsd: '80000',
      evidence: { eventAt: new Date(+now - (total - i) * 1000).toISOString(), market: { at: new Date(+now - (total - i) * 1000).toISOString(), source: 'dexscreener', marketCapIsFdv: false } },
    }));

    const settings = new Map<string, unknown>();
    const db = {
      trackedWallet: { findMany: async () => [{ id: 'w1', clusterId: null, cluster: null }], updateMany: async () => ({ count: 0 }) },
      $queryRaw: async (_sql: TemplateStringsArray, _from: Date, _to: Date, after: { values: unknown[] }, take: number) => {
        const start = after.values.length ? allRows.findIndex((r) => r.id === after.values[1]) + 1 : 0;
        return allRows.slice(start, start + take);
      },
      $executeRaw: async () => 0,
      systemSetting: {
        deleteMany: async () => ({ count: 0 }),
        createMany: async (args: { data: { key: string; value: unknown }[] }) => {
          for (const item of args.data) settings.set(item.key, item.value);
          return { count: args.data.length };
        },
      },
      walletProfile: { deleteMany: async () => ({ count: 0 }) },
      walletMetric: { createMany: async () => ({ count: 0 }) },
      walletRelationship: { deleteMany: async () => ({ count: 0 }), createMany: async () => ({ count: 0 }) },
      walletCluster: { deleteMany: async () => ({ count: 0 }), create: async () => ({}) },
      consensusSignal: { findMany: async () => [], deleteMany: async () => ({ count: 0 }), create: async () => ({}) },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
    };

    const summary = await recomputeWalletIntelligence(db as unknown as PrismaClient, now);
    expect(summary.readPages).toBe(3);
    expect(summary.tradesUsed).toBe(10_005);
    expect(settings.get('wallet.performance.w1')).toMatchObject({ capped: true, observedTrades: 10_000 });
    expect(settings.get('wallet.intelligence.w1')).toMatchObject({ observedTrades: 10_005, observedBuys: 10_005, observedSells: 0 });
  });
});
