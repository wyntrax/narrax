import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@narra/database';
import {
  METRIC_PROVENANCE_PRUNE_BATCH,
  METRIC_PROVENANCE_RETENTION_MS,
  WALLET_TRADE_PRUNE_BATCH,
  WALLET_TRADE_RETENTION_MS,
  pruneExpiredMetricProvenance,
  pruneExpiredTokenMetadata,
  pruneExpiredWalletTrades,
  pruneStaleTokenSnapshots,
} from './metricRetention';

describe('pruneExpiredMetricProvenance', () => {
  it('deletes expired metric provenance rows in bounded batches using the cutoff timestamp', async () => {
    const now = new Date('2032-02-01T00:00:00Z');
    const calls: unknown[] = [];
    const db = {
      $executeRaw: vi.fn(async (_strings: TemplateStringsArray, cutoff: Date, batchSize: number) => {
        calls.push({ cutoff, batchSize });
        return 42;
      }),
    };

    const result = await pruneExpiredMetricProvenance(db as unknown as PrismaClient, now);

    expect(result).toEqual({ deleted: 42 });
    expect(calls).toEqual([
      {
        cutoff: new Date(now.getTime() - METRIC_PROVENANCE_RETENTION_MS),
        batchSize: METRIC_PROVENANCE_PRUNE_BATCH,
      },
    ]);
  });

  it('is a safe no-op when $executeRaw is unavailable in partial mocks', async () => {
    const result = await pruneExpiredMetricProvenance({} as unknown as PrismaClient, new Date());
    expect(result).toEqual({ deleted: 0 });
  });
});

describe('pruneExpiredTokenMetadata', () => {
  it('deletes stale orphaned tokenMetadata rows in bounded batches while preserving the cursor', async () => {
    const now = new Date('2032-02-01T00:00:00Z');
    const calls: { sql: string; cutoff: Date; batchSize: number }[] = [];
    const db = {
      $executeRaw: vi.fn(async (strings: TemplateStringsArray, cutoff: Date, batchSize: number) => {
        calls.push({ sql: strings.join('?'), cutoff, batchSize });
        return 17;
      }),
    };

    const result = await pruneExpiredTokenMetadata(db as unknown as PrismaClient, now);
    expect(result).toEqual({ deleted: 17 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.sql).toContain("research.tokenMetadata.cursor");
    expect(calls[0]!.cutoff).toEqual(new Date(now.getTime() - METRIC_PROVENANCE_RETENTION_MS));
    expect(calls[0]!.batchSize).toBe(METRIC_PROVENANCE_PRUNE_BATCH);
  });
});

describe('pruneStaleTokenSnapshots', () => {
  it('deletes stale market and holder snapshot pointers once recent metrics, narratives, and positions are absent', async () => {
    const now = new Date('2032-02-01T00:00:00Z');
    const calls: { sql: string; cutoffs: Date[]; batchSize: number }[] = [];
    const db = {
      $executeRaw: vi.fn(async (strings: TemplateStringsArray, c1: Date, c2: Date, c3: Date, batchSize: number) => {
        calls.push({ sql: strings.join('?'), cutoffs: [c1, c2, c3], batchSize });
        return 85;
      }),
    };

    const result = await pruneStaleTokenSnapshots(db as unknown as PrismaClient, now);
    const expectedCutoff = new Date(now.getTime() - METRIC_PROVENANCE_RETENTION_MS);

    expect(result).toEqual({ deleted: 85 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.sql).toContain("research.market.%");
    expect(calls[0]!.sql).toContain("research.holders.%");
    expect(calls[0]!.sql).toContain('"TokenMetric"');
    expect(calls[0]!.sql).toContain('"TokenHolderMetric"');
    expect(calls[0]!.sql).toContain('"NarrativeTokenRelation"');
    expect(calls[0]!.sql).toContain('"Position"');
    expect(calls[0]!.cutoffs).toEqual([expectedCutoff, expectedCutoff, expectedCutoff]);
    expect(calls[0]!.batchSize).toBe(METRIC_PROVENANCE_PRUNE_BATCH);
  });

  it('is a safe no-op when $executeRaw is unavailable in partial mocks', async () => {
    const result = await pruneStaleTokenSnapshots({} as unknown as PrismaClient, new Date());
    expect(result).toEqual({ deleted: 0 });
  });
});

describe('pruneExpiredWalletTrades', () => {
  it('deletes expired WalletTrade rows in bounded batches ordered by (at, id)', async () => {
    const now = new Date('2032-02-01T00:00:00Z');
    const calls: { sql: string; cutoff: Date; batchSize: number }[] = [];
    const db = {
      $executeRaw: vi.fn(async (strings: TemplateStringsArray, cutoff: Date, batchSize: number) => {
        calls.push({ sql: strings.join('?'), cutoff, batchSize });
        return 500;
      }),
    };

    const result = await pruneExpiredWalletTrades(db as unknown as PrismaClient, now);

    expect(result).toEqual({ deleted: 500 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.sql).toContain('"WalletTrade"');
    expect(calls[0]!.sql).toContain('ORDER BY "at" ASC, "id" ASC');
    expect(calls[0]!.cutoff).toEqual(new Date(now.getTime() - WALLET_TRADE_RETENTION_MS));
    expect(calls[0]!.batchSize).toBe(WALLET_TRADE_PRUNE_BATCH);
  });

  it('is a safe no-op when $executeRaw is unavailable in partial mocks', async () => {
    const result = await pruneExpiredWalletTrades({} as unknown as PrismaClient, new Date());
    expect(result).toEqual({ deleted: 0 });
  });
});
