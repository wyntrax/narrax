import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@narra/database';
import {
  METRIC_PROVENANCE_PRUNE_BATCH,
  METRIC_PROVENANCE_RETENTION_MS,
  pruneExpiredMetricProvenance,
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
