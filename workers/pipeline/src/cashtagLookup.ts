import { Prisma, type PrismaClient } from '@narra/database';

export interface ActiveCashtagToken {
  id: string;
  symbol: string;
  name: string;
  createdOnChainAt: Date | null;
  deployer: string | null;
}

const CHUNK = 500;

/**
 * Resolves a batch of cashtag symbols (case-insensitively) against active, non-blacklisted tokens
 * that have at least one `TokenMetric` row since `since`. A symbol resolves only when exactly one
 * matching token exists (ambiguous or missing symbols map to `null`).
 *
 * Uses a materialized `TokenMetric(at, tokenId)` index-only scan joined via `Token_pkey` once per
 * batch instead of per-cashtag `ILIKE` queries that force parallel sequential scans on `Token`.
 */
export async function resolveUniqueCashtags(
  db: PrismaClient,
  refs: readonly string[],
  since: Date,
): Promise<Map<string, ActiveCashtagToken | null>> {
  const upperRefs = [...new Set(refs.map((r) => r.trim().toUpperCase()).filter(Boolean))];
  const out = new Map<string, ActiveCashtagToken | null>(upperRefs.map((ref) => [ref, null]));
  if (!upperRefs.length) return out;

  const grouped = new Map<string, ActiveCashtagToken[]>();
  const record = (row: ActiveCashtagToken) => {
    const key = row.symbol.toUpperCase();
    const list = grouped.get(key) ?? [];
    if (list.length < 2) {
      list.push(row);
      grouped.set(key, list);
    }
  };

  if (typeof db.$queryRaw === 'function') {
    for (let i = 0; i < upperRefs.length; i += CHUNK) {
      const slice = upperRefs.slice(i, i + CHUNK);
      const rows = await db.$queryRaw<ActiveCashtagToken[]>`
        WITH active AS MATERIALIZED (
          SELECT DISTINCT "tokenId"
          FROM "TokenMetric"
          WHERE "at" >= ${since}
        )
        SELECT t."id", t."symbol", t."name", t."createdOnChainAt", t."deployer"
        FROM active a
        JOIN "Token" t ON t."id" = a."tokenId"
        WHERE t."blacklisted" = false
          AND UPPER(t."symbol") IN (${Prisma.join(slice)})
      `;
      for (const row of rows) record(row);
    }
  } else {
    for (const ref of upperRefs) {
      const matches = await db.token.findMany({
        where: { symbol: { equals: ref, mode: 'insensitive' }, blacklisted: false, metrics: { some: { at: { gte: since } } } },
        select: { id: true, symbol: true, name: true, createdOnChainAt: true, deployer: true },
        take: 2,
      });
      for (const row of matches) record(row);
    }
  }

  for (const ref of upperRefs) {
    const list = grouped.get(ref);
    if (list?.length === 1) out.set(ref, list[0]!);
  }
  return out;
}
