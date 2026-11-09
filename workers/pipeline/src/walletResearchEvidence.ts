import type { Prisma } from '@narra/database';
import { z } from 'zod';

type Db = Pick<Prisma.TransactionClient, 'tokenMetric' | 'systemSetting'>;
export const WALLET_MARKET_MAX_AGE_MS = 15 * 60_000;
export const SOL_HISTORY_PREFIX = 'market.solUsd.history.';
const Provenance = z.object({ metricId: z.string(), at: z.string().datetime(), source: z.literal('dexscreener'), marketCapIsFdv: z.boolean(), pairAddress: z.string().min(1) });
const Sol = z.object({ priceUsd: z.number().finite().positive(), at: z.string().datetime(), source: z.string().min(1) });

/** Only observations at or BEFORE the event. The exact row must have its own provenance. */
export async function walletMarketEvidence(db: Db, tokenId: string, at: Date) {
  return (await walletMarketLookup(db,tokenId,at)).market;
}

/** Bounded fallback past invalid rows, never past the pre-event freshness window. */
export async function walletMarketLookup(db: Db, tokenId: string, at: Date) {
  const excluded: string[] = [];
  let reason = 'NO_MARKET_IN_WINDOW';
  for (let i=0;i<20;i++) {
    const metric = await db.tokenMetric.findFirst({ where: { tokenId, id: { notIn: excluded }, at: { gte: new Date(+at-WALLET_MARKET_MAX_AGE_MS), lte: at } }, orderBy: [{ at: 'desc' }, { id: 'desc' }] });
    if (!metric) {
      if (!excluded.length) {
        const first = await db.tokenMetric.findFirst({ where: { tokenId }, orderBy: [{ at: 'asc' }, { id: 'asc' }] });
        reason = !first ? 'NO_TOKEN_MARKET_HISTORY' : +first.at>+at ? 'TRADE_BEFORE_MARKET_HISTORY' : 'NO_MARKET_IN_WINDOW';
      }
      return { market: null, reason };
    }
    excluded.push(metric.id);
    if (+metric.at>+at || +at-+metric.at>WALLET_MARKET_MAX_AGE_MS || metric.priceUsd==null || !(Number(metric.priceUsd)>0) || !Number.isFinite(Number(metric.priceUsd)) || metric.liquidityUsd==null || !Number.isFinite(Number(metric.liquidityUsd)) || Number(metric.liquidityUsd)<0) { reason='INVALID_MARKET_VALUES'; continue; }
    const row = await db.systemSetting.findUnique({ where: { key: `research.marketMetric.${metric.id}` } });
    const p = Provenance.safeParse(row?.value);
    if (!p.success || p.data.metricId!==metric.id || p.data.at!==metric.at.toISOString()) { reason='INVALID_MARKET_PROVENANCE'; continue; }
    const cap = Number(metric.marketCapUsd), validCap = !p.data.marketCapIsFdv && Number.isFinite(cap) && cap>0;
    return { market: { metricId: metric.id, at: metric.at.toISOString(), priceUsd: Number(metric.priceUsd), marketCapUsd: validCap ? cap : null, liquidityUsd: Number(metric.liquidityUsd), source: p.data.source, pairAddress: p.data.pairAddress, marketCapIsFdv: p.data.marketCapIsFdv }, reason: validCap ? null : p.data.marketCapIsFdv ? 'FDV_ONLY' : 'INVALID_MARKET_CAP' };
  }
  return { market: null, reason: 'MARKET_LOOKUP_LIMIT' };
}

export async function walletTradeEvidence(db: Db, tokenId: string, at: Date, amountSol: number) {
  const [lookup, solRow] = await Promise.all([walletMarketLookup(db, tokenId, at), db.systemSetting.findUnique({ where: { key: 'market.solUsd' } })]);
  const market=lookup.market;
  const parsed = Sol.safeParse(solRow?.value);
  let sol = parsed.success && Date.parse(parsed.data.at) <= +at && +at - Date.parse(parsed.data.at) <= WALLET_MARKET_MAX_AGE_MS ? parsed.data : null;
  if (!sol) {
    const historical = await db.systemSetting.findFirst({ where: { key: { gte: `${SOL_HISTORY_PREFIX}${new Date(+at-WALLET_MARKET_MAX_AGE_MS).toISOString()}`, lte: `${SOL_HISTORY_PREFIX}${at.toISOString()}` } }, orderBy: { key: 'desc' } });
    const old = Sol.safeParse(historical?.value);
    if (old.success && historical?.key === `${SOL_HISTORY_PREFIX}${old.data.at}` && Date.parse(old.data.at)<=+at && +at-Date.parse(old.data.at)<=WALLET_MARKET_MAX_AGE_MS) sol=old.data;
  }
  return { amountUsd: sol ? amountSol * sol.priceUsd : null, marketCapUsd: market?.marketCapUsd ?? null,
    evidence: { version: 1, eventAt: at.toISOString(), market, sol, reasons: [...(!market ? ['NO_CONTEMPORANEOUS_MARKET'] : []), ...(lookup.reason ? [lookup.reason] : []), ...(!sol ? ['NO_CONTEMPORANEOUS_SOL'] : [])] } };
}
