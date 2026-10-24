import { Prisma, type PrismaClient } from '@narra/database';

/** PostgreSQL DESC puts missing related profiles first unless NULLS LAST is explicit.
 * Rank before cursor/limit so unscored wallets stay last across every page. */
export async function walletScorePage(db: PrismaClient, q: { source?: string; term?: string; cursor?: string; limit: number }) {
  const rows = await db.$queryRaw<{id:string}[]>(Prisma.sql`
    WITH ranked AS (
      SELECT w.id, row_number() OVER (ORDER BY p.score DESC NULLS LAST, w.id ASC) AS rn
      FROM "TrackedWallet" w LEFT JOIN "WalletProfile" p ON p."walletId"=w.id
      WHERE w.active=true
        ${q.source ? Prisma.sql`AND w.source=${q.source}` : Prisma.empty}
        ${q.term ? Prisma.sql`AND (w.address LIKE ${`${q.term}%`} OR w.label ILIKE ${`%${q.term}%`})` : Prisma.empty}
    ) SELECT id FROM ranked
      ${q.cursor ? Prisma.sql`WHERE rn > (SELECT rn FROM ranked WHERE id=${q.cursor})` : Prisma.empty}
      ORDER BY rn LIMIT ${q.limit + 1}
  `);
  return rows.map(r=>r.id);
}
