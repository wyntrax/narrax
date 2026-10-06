import { z } from 'zod';
import { Prisma, type PrismaClient } from '@narra/database';
import { NarrativeStage } from '@narra/shared';
import { encodeCursor, decodeCursor, Limit } from './paging';

const num = z.coerce.number().finite();
const nonNeg = num.min(0);

/** The screener's filters. Every one is optional. A filter on a value a token has no reading for excludes that token: unknown is never treated as zero. */
export const ScreenerQuery = z.object({
  limit: Limit,
  cursor: z.string().max(300).optional(),
  q: z.string().min(1).max(64).optional(),
  minMarketCapUsd: nonNeg.optional(), maxMarketCapUsd: nonNeg.optional(),
  minLiquidityUsd: nonNeg.optional(), maxLiquidityUsd: nonNeg.optional(),
  minVolume24hUsd: nonNeg.optional(),
  minHolders: z.coerce.number().int().min(0).optional(),
  maxTop10Pct: z.coerce.number().min(0).max(100).optional(),
  maxDevHoldingPct: z.coerce.number().min(0).max(100).optional(),
  minSmartWalletHolders: z.coerce.number().int().min(0).optional(),
  /** Risk score is 0 to 100, higher is riskier. */
  maxRiskScore: z.coerce.number().min(0).max(100).optional(),
  minAgeMinutes: nonNeg.optional(), maxAgeMinutes: nonNeg.optional(),
  /** Tokens linked to a narrative at this stage, or this slug, or with an OG score at least this high. */
  narrativeStage: NarrativeStage.optional(),
  narrative: z.string().regex(/^[a-z0-9-]{1,80}$/).optional(),
  minOgScore: z.coerce.number().min(0).max(100).optional(),
  /** Leaves out tokens whose latest risk reading has the honeypot flag. */
  excludeHoneypot: z.enum(['true', 'false']).optional(),
  includeBlacklisted: z.enum(['true', 'false']).optional(),
  sort: z.enum(['symbol', 'marketCap', 'liquidity', 'volume24h', 'holders', 'risk', 'age', 'og']).default('symbol'),
  order: z.enum(['asc', 'desc']).optional(),
});
export type ScreenerQuery = z.infer<typeof ScreenerQuery>;

const FILTER_KEYS = ['minMarketCapUsd', 'maxMarketCapUsd', 'minLiquidityUsd', 'maxLiquidityUsd', 'minVolume24hUsd', 'minHolders', 'maxTop10Pct', 'maxDevHoldingPct', 'minSmartWalletHolders', 'maxRiskScore', 'minAgeMinutes', 'maxAgeMinutes', 'narrativeStage', 'narrative', 'minOgScore', 'excludeHoneypot', 'includeBlacklisted'] as const;

/** True when the request needs the screener query. A plain list or text search stays on the simple path. */
export const isScreenerRequest = (q: ScreenerQuery) => q.sort !== 'symbol' || q.order !== undefined || FILTER_KEYS.some((k) => q[k] !== undefined);

// Sort keys map to fixed SQL fragments. User input never reaches the SQL text, only whitelisted names and bound parameters.
const SORTS = {
  symbol: { col: Prisma.sql`t."symbol"`, type: 'text', dir: 'asc' },
  marketCap: { col: Prisma.sql`m."marketCapUsd"`, type: 'num', dir: 'desc' },
  liquidity: { col: Prisma.sql`m."liquidityUsd"`, type: 'num', dir: 'desc' },
  volume24h: { col: Prisma.sql`m."volume24hUsd"`, type: 'num', dir: 'desc' },
  holders: { col: Prisma.sql`h."holders"`, type: 'num', dir: 'desc' },
  risk: { col: Prisma.sql`r."riskScore"`, type: 'num', dir: 'asc' },
  age: { col: Prisma.sql`t."createdOnChainAt"`, type: 'time', dir: 'desc' },
  og: { col: Prisma.sql`og."best"`, type: 'num', dir: 'desc' },
} as const;

const CursorShape = z.tuple([z.union([z.string(), z.number()]), z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)]);

export interface ScreenerRow { id: string; mint: string; symbol: string; name: string; blacklisted: boolean; createdOnChainAt: Date | null; priceUsd: unknown; marketCapUsd: unknown; liquidityUsd: unknown; volume24hUsd: unknown; holders: number | null; top10Pct: number | null; riskScore: number | null; ogScore: number | null }

/**
 * Filters and sorts tokens by their latest readings. Returns null for a cursor that does not decode (the route answers 400).
 * Keyset pagination on (sort column, id): rows with an unknown sort value are excluded, so the order is total and stable.
 */
export async function runScreener(db: PrismaClient, q: ScreenerQuery, now: Date): Promise<{ rows: ScreenerRow[]; nextCursor: string | null } | null> {
  const spec = SORTS[q.sort];
  const dir = q.order ?? spec.dir;
  const where: Prisma.Sql[] = [];
  const add = (cond: Prisma.Sql) => where.push(cond);

  if (q.includeBlacklisted !== 'true') add(Prisma.sql`t."blacklisted" = false`);
  if (q.q) {
    const like = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    add(Prisma.sql`(t."symbol" ILIKE ${like} OR t."name" ILIKE ${like} OR t."mint" LIKE ${`${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`})`);
  }
  if (q.minMarketCapUsd !== undefined) add(Prisma.sql`m."marketCapUsd" >= ${q.minMarketCapUsd}`);
  if (q.maxMarketCapUsd !== undefined) add(Prisma.sql`m."marketCapUsd" <= ${q.maxMarketCapUsd}`);
  if (q.minLiquidityUsd !== undefined) add(Prisma.sql`m."liquidityUsd" >= ${q.minLiquidityUsd}`);
  if (q.maxLiquidityUsd !== undefined) add(Prisma.sql`m."liquidityUsd" <= ${q.maxLiquidityUsd}`);
  if (q.minVolume24hUsd !== undefined) add(Prisma.sql`m."volume24hUsd" >= ${q.minVolume24hUsd}`);
  if (q.minHolders !== undefined) add(Prisma.sql`h."holders" >= ${q.minHolders}`);
  if (q.maxTop10Pct !== undefined) add(Prisma.sql`h."top10Pct" <= ${q.maxTop10Pct}`);
  if (q.maxDevHoldingPct !== undefined) add(Prisma.sql`h."devHoldingPct" <= ${q.maxDevHoldingPct}`);
  if (q.minSmartWalletHolders !== undefined) add(Prisma.sql`h."smartWalletHolders" >= ${q.minSmartWalletHolders}`);
  if (q.maxRiskScore !== undefined) add(Prisma.sql`r."riskScore" <= ${q.maxRiskScore}`);
  // Age needs a known launch time. A token without one is excluded when an age filter is used.
  if (q.minAgeMinutes !== undefined) add(Prisma.sql`t."createdOnChainAt" <= ${new Date(now.getTime() - q.minAgeMinutes * 60_000)}`);
  if (q.maxAgeMinutes !== undefined) add(Prisma.sql`t."createdOnChainAt" >= ${new Date(now.getTime() - q.maxAgeMinutes * 60_000)}`);
  if (q.excludeHoneypot === 'true') add(Prisma.sql`(r."tokenId" IS NOT NULL AND NOT ('HONEYPOT' = ANY(r."flags")))`); // no risk reading yet counts as unknown, so it is left out
  if (q.narrativeStage) add(Prisma.sql`EXISTS (SELECT 1 FROM "NarrativeTokenRelation" x JOIN "Narrative" nn ON nn."id" = x."narrativeId" WHERE x."tokenId" = t."id" AND nn."stage"::text = ${q.narrativeStage} AND x."relation"::text NOT IN ('UNRELATED', 'SUSPICIOUS'))`);
  if (q.narrative) add(Prisma.sql`EXISTS (SELECT 1 FROM "NarrativeTokenRelation" x JOIN "Narrative" nn ON nn."id" = x."narrativeId" WHERE x."tokenId" = t."id" AND nn."slug" = ${q.narrative} AND x."relation"::text NOT IN ('UNRELATED', 'SUSPICIOUS'))`);
  if (q.minOgScore !== undefined) add(Prisma.sql`og."best" >= ${q.minOgScore}`);

  // Sorting by a reading requires that reading to exist.
  if (spec.type !== 'text') add(Prisma.sql`${spec.col} IS NOT NULL`);

  if (q.cursor) {
    const c = decodeCursor(q.cursor, CursorShape);
    if (!c) return null;
    const [val, id] = c;
    const op = dir === 'asc' ? Prisma.sql`>` : Prisma.sql`<`;
    let v: unknown;
    if (spec.type === 'num') { if (typeof val !== 'number' || !Number.isFinite(val)) return null; v = val; }
    else if (spec.type === 'time') { const d = typeof val === 'string' ? new Date(val) : null; if (!d || Number.isNaN(d.getTime())) return null; v = d; }
    else { if (typeof val !== 'string') return null; v = val; }
    // Ties on the sort value fall back to ascending id.
    add(Prisma.sql`(${spec.col} ${op} ${v} OR (${spec.col} = ${v} AND t."id" > ${id}))`);
  }

  const orderDir = dir === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  const rows = await db.$queryRaw<ScreenerRow[]>(Prisma.sql`
    SELECT t."id", t."mint", t."symbol", t."name", t."blacklisted", t."createdOnChainAt",
      m."priceUsd" AS "priceUsd", m."marketCapUsd" AS "marketCapUsd", m."liquidityUsd" AS "liquidityUsd", m."volume24hUsd" AS "volume24hUsd",
      h."holders" AS "holders", h."top10Pct" AS "top10Pct", r."riskScore" AS "riskScore", og."best" AS "ogScore"
    FROM "Token" t
    LEFT JOIN LATERAL (SELECT * FROM "TokenMetric" WHERE "tokenId" = t."id" ORDER BY "at" DESC LIMIT 1) m ON true
    LEFT JOIN LATERAL (SELECT * FROM "TokenHolderMetric" WHERE "tokenId" = t."id" ORDER BY "at" DESC LIMIT 1) h ON true
    LEFT JOIN LATERAL (SELECT * FROM "TokenRiskMetric" WHERE "tokenId" = t."id" ORDER BY "at" DESC LIMIT 1) r ON true
    LEFT JOIN LATERAL (SELECT MAX("ogScore") AS "best" FROM "NarrativeTokenRelation" WHERE "tokenId" = t."id" AND "relation"::text NOT IN ('UNRELATED', 'SUSPICIOUS')) og ON true
    ${where.length ? Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}` : Prisma.empty}
    ORDER BY ${spec.col} ${orderDir}, t."id" ASC
    LIMIT ${q.limit + 1}`);

  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  let nextCursor: string | null = null;
  if (rows.length > q.limit && last) {
    const dec = (v: unknown) => Number(String(v));
    const key: string | number = {
      symbol: () => last.symbol, age: () => (last.createdOnChainAt as Date).toISOString(),
      marketCap: () => dec(last.marketCapUsd), liquidity: () => dec(last.liquidityUsd), volume24h: () => dec(last.volume24hUsd),
      holders: () => last.holders as number, risk: () => last.riskScore as number, og: () => last.ogScore as number,
    }[q.sort]();
    nextCursor = encodeCursor([key, last.id]);
  }
  return { rows: page, nextCursor };
}
