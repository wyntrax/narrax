import type { PrismaClient } from '@narra/database';

/** Retain 8 days so 7-day `/tokens/:mint/history` lookups keep full provenance with a 24h buffer. */
export const METRIC_PROVENANCE_RETENTION_MS = 8 * 86_400_000;
export const METRIC_PROVENANCE_PRUNE_BATCH = 2_000;
/** Retain 45 days of wallet trades: covers the full 30-day intelligence/ranking window with a 15-day buffer. */
export const WALLET_TRADE_RETENTION_MS = 45 * 86_400_000;
export const WALLET_TRADE_PRUNE_BATCH = 5_000;

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

/**
 * Deletes stale `research.tokenMetadata.<tokenId>` cache rows belonging to unpriced tokens
 * with no narratives or positions (mostly historical `WalletTrade` dust), preserving `.cursor`.
 */
export async function pruneExpiredTokenMetadata(
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
      SELECT s."key"
      FROM "SystemSetting" s
      WHERE s."key" LIKE 'research.tokenMetadata.%'
        AND s."key" <> 'research.tokenMetadata.cursor'
        AND s."updatedAt" < ${cutoff}
        AND NOT EXISTS (SELECT 1 FROM "TokenMetric" tm WHERE tm."tokenId" = split_part(s."key", '.', 3))
        AND NOT EXISTS (SELECT 1 FROM "NarrativeTokenRelation" nr WHERE nr."tokenId" = split_part(s."key", '.', 3))
        AND NOT EXISTS (SELECT 1 FROM "Position" p WHERE p."tokenId" = split_part(s."key", '.', 3))
      LIMIT ${batchSize}
    )
  `;
  return { deleted: Number(deleted) || 0 };
}

/**
 * Deletes stale `research.market.<tokenId>` and `research.holders.<tokenId>` snapshot pointers
 * once no recent metrics, narrative links, or positions still reference the token.
 */
export async function pruneStaleTokenSnapshots(
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
      SELECT s."key"
      FROM "SystemSetting" s
      WHERE (s."key" LIKE 'research.market.%' OR s."key" LIKE 'research.holders.%')
        AND s."updatedAt" < ${cutoff}
        AND NOT EXISTS (
          SELECT 1 FROM "TokenMetric" tm
          WHERE tm."tokenId" = split_part(s."key", '.', 3) AND tm."at" >= ${cutoff}
        )
        AND NOT EXISTS (
          SELECT 1 FROM "TokenHolderMetric" th
          WHERE th."tokenId" = split_part(s."key", '.', 3) AND th."at" >= ${cutoff}
        )
        AND NOT EXISTS (
          SELECT 1 FROM "NarrativeTokenRelation" nr
          WHERE nr."tokenId" = split_part(s."key", '.', 3)
        )
        AND NOT EXISTS (
          SELECT 1 FROM "Position" p
          WHERE p."tokenId" = split_part(s."key", '.', 3)
        )
      LIMIT ${batchSize}
    )
  `;
  return { deleted: Number(deleted) || 0 };
}

/**
 * Deletes expired `WalletTrade` rows older than the 45-day retention horizon in bounded batches
 * using the `(at, id)` index so table bloat stays bounded without long locks.
 */
export async function pruneExpiredWalletTrades(
  db: PrismaClient,
  now: Date = new Date(),
  options: PruneProvenanceOptions = {},
): Promise<{ deleted: number }> {
  if (typeof db.$executeRaw !== 'function') return { deleted: 0 };
  const retentionMs = options.retentionMs ?? WALLET_TRADE_RETENTION_MS;
  const batchSize = Math.max(1, Math.min(10_000, Math.trunc(options.batchSize ?? WALLET_TRADE_PRUNE_BATCH)));
  const cutoff = new Date(now.getTime() - retentionMs);
  const deleted = await db.$executeRaw`
    DELETE FROM "WalletTrade"
    WHERE "id" IN (
      SELECT "id"
      FROM "WalletTrade"
      WHERE "at" < ${cutoff}
      ORDER BY "at" ASC, "id" ASC
      LIMIT ${batchSize}
    )
  `;
  return { deleted: Number(deleted) || 0 };
}
