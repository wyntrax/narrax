import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@narra/database';
import {
  METRIC_PROVENANCE_PRUNE_BATCH,
  METRIC_PROVENANCE_RETENTION_MS,
  pruneExpiredMetricProvenance,
  pruneExpiredTokenMetadata,
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
