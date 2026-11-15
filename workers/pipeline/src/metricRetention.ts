import type { PrismaClient } from '@narra/database';

/** Retain 8 days so 7-day `/tokens/:mint/history` lookups keep full provenance with a 24h buffer. */
export const METRIC_PROVENANCE_RETENTION_MS = 8 * 86_400_000;
export const METRIC_PROVENANCE_PRUNE_BATCH = 2_000;

export interface PruneProvenanceOptions {
  retentionMs?: number;
  batchSize?: number;
}

/**
 * Deletes expired immutable `research.marketMetric.*` and `research.holderMetric.*` rows
 * in bounded batches so `SystemSetting` cannot grow unboundedly or stall the DB.
 */
export async function pruneExpiredMetricProvenance(
  db: PrismaClient,
  now: Date = new Date(),
  options: PruneProvenanceOptions = {},
): Promise<{ deleted: number }> {
  if (typeof db.$executeRaw !== 'function') return { deleted: 0 };
  const retentionMs = options.retentionMs ?? METRIC_PROVENANCE_RETENTION_MS;
  const batchSize = Math.max(1, Math.min(10_000, Math.trunc(options.batchSize ?? METRIC_PROVENANCE_PRUNE_BATCH)));
  const cutoff = new Date(now.getTime() - retentionMs);
  const deleted = await db.$executeRaw`
    DELETE FROM "SystemSetting"
    WHERE "key" IN (
      SELECT "key"
      FROM "SystemSetting"
      WHERE ("key" LIKE 'research.marketMetric.%' OR "key" LIKE 'research.holderMetric.%')
        AND "updatedAt" < ${cutoff}
      LIMIT ${batchSize}
    )
  `;
  return { deleted: Number(deleted) || 0 };
}
