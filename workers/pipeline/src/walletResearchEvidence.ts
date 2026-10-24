import type { Prisma } from '@narra/database';
import { z } from 'zod';

type Db = Pick<Prisma.TransactionClient, 'tokenMetric' | 'systemSetting'>;
export const WALLET_MARKET_MAX_AGE_MS = 15 * 60_000;
const Provenance = z.object({ metricId: z.string(), at: z.string().datetime(), source: z.literal('dexscreener'), marketCapIsFdv: z.boolean(), pairAddress: z.string().min(1) });
const Sol = z.object({ priceUsd: z.number().finite().positive(), at: z.string().datetime(), source: z.string().min(1) });

/** Only observations at or BEFORE the event. The exact row must have its own provenance. */
export async function walletMarketEvidence(db: Db, tokenId: string, at: Date) {
  const metric = await db.tokenMetric.findFirst({ where: { tokenId, at: { gte: new Date(+at - WALLET_MARKET_MAX_AGE_MS), lte: at } }, orderBy: [{ at: 'desc' }, { id: 'desc' }] });
  if (!metric || !(Number(metric.priceUsd) > 0) || !Number.isFinite(Number(metric.priceUsd)) || !Number.isFinite(Number(metric.liquidityUsd))) return null;
  const row = await db.systemSetting.findUnique({ where: { key: `research.marketMetric.${metric.id}` } });
  const p = Provenance.safeParse(row?.value);
  if (!p.success || p.data.metricId !== metric.id || p.data.at !== metric.at.toISOString()) return null;
  const cap = Number(metric.marketCapUsd);
  return { metricId: metric.id, at: metric.at.toISOString(), priceUsd: Number(metric.priceUsd), marketCapUsd: p.data.marketCapIsFdv || !Number.isFinite(cap) || cap <= 0 ? null : cap, liquidityUsd: Number(metric.liquidityUsd), source: p.data.source, pairAddress: p.data.pairAddress, marketCapIsFdv: p.data.marketCapIsFdv };
}

export async function walletTradeEvidence(db: Db, tokenId: string, at: Date, amountSol: number) {
  const [market, solRow] = await Promise.all([walletMarketEvidence(db, tokenId, at), db.systemSetting.findUnique({ where: { key: 'market.solUsd' } })]);
  const parsed = Sol.safeParse(solRow?.value);
  const sol = parsed.success && Date.parse(parsed.data.at) <= +at && +at - Date.parse(parsed.data.at) <= WALLET_MARKET_MAX_AGE_MS ? parsed.data : null;
  return { amountUsd: sol ? amountSol * sol.priceUsd : null, marketCapUsd: market?.marketCapUsd ?? null,
    evidence: { version: 1, eventAt: at.toISOString(), market, sol, reasons: [...(!market ? ['NO_CONTEMPORANEOUS_MARKET'] : []), ...(!sol ? ['NO_CONTEMPORANEOUS_SOL'] : [])] } };
}
