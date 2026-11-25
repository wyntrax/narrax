import type { Prisma } from '@narra/database';
import { z } from 'zod';

type Db = Pick<Prisma.TransactionClient, 'tokenMetric' | 'systemSetting'>;
export const WALLET_MARKET_MAX_AGE_MS = 15 * 60_000;
export const SOL_HISTORY_PREFIX = 'market.solUsd.history.';
/** Fixed-supply launchpad tokens (pump.fun, letsbonk) have a protocol-enforced 1B supply. */
export const FIXED_LAUNCHPAD_SUPPLY = 1_000_000_000;
/** Minimum swap size (SOL) for swap-implied market cap so flat fees/rounding on dust swaps never skew price. */
export const SWAP_IMPLIED_MIN_SOL = 0.005;
const SWAP_IMPLIED_MIN_CAP_USD = 1_000;
const SWAP_IMPLIED_MAX_CAP_USD = 100_000_000_000;

export const isFixedOneBillionMint = (mint: string | null | undefined): boolean =>
  typeof mint === 'string' && (mint.endsWith('pump') || mint.endsWith('bonk'));

export function swapImpliedMarketCap(
  mint: string | null | undefined,
  at: Date,
  amountSol: number,
  amountUsd: number | null,
  tokenAmount: number | null | undefined,
) {
  if (
    !isFixedOneBillionMint(mint) ||
    !Number.isFinite(amountSol) || amountSol < SWAP_IMPLIED_MIN_SOL ||
    amountUsd == null || !Number.isFinite(amountUsd) || amountUsd <= 0 ||
    tokenAmount == null || !Number.isFinite(tokenAmount) || tokenAmount <= 0
  ) {
    return null;
  }
  const priceUsd = amountUsd / tokenAmount;
  const marketCapUsd = priceUsd * FIXED_LAUNCHPAD_SUPPLY;
  if (!Number.isFinite(marketCapUsd) || marketCapUsd < SWAP_IMPLIED_MIN_CAP_USD || marketCapUsd > SWAP_IMPLIED_MAX_CAP_USD) {
    return null;
  }
  return {
    metricId: null,
    at: at.toISOString(),
    priceUsd,
    marketCapUsd,
    liquidityUsd: null,
    source: 'swap_implied' as const,
    pairAddress: null,
    marketCapIsFdv: false as const,
    supply: FIXED_LAUNCHPAD_SUPPLY,
    supplyBasis: 'FIXED_LAUNCHPAD_1B' as const,
  };
}
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

export async function walletTradeEvidence(
  db: Db,
  tokenId: string,
  at: Date,
  amountSol: number,
  swapCtx?: { mint?: string | null; tokenAmount?: number | null },
) {
  const [lookup, solRow] = await Promise.all([walletMarketLookup(db, tokenId, at), db.systemSetting.findUnique({ where: { key: 'market.solUsd' } })]);
  const parsed = Sol.safeParse(solRow?.value);
  let sol = parsed.success && Date.parse(parsed.data.at) <= +at && +at - Date.parse(parsed.data.at) <= WALLET_MARKET_MAX_AGE_MS ? parsed.data : null;
  if (!sol) {
    const historical = await db.systemSetting.findFirst({ where: { key: { gte: `${SOL_HISTORY_PREFIX}${new Date(+at-WALLET_MARKET_MAX_AGE_MS).toISOString()}`, lte: `${SOL_HISTORY_PREFIX}${at.toISOString()}` } }, orderBy: { key: 'desc' } });
    const old = Sol.safeParse(historical?.value);
    if (old.success && historical?.key === `${SOL_HISTORY_PREFIX}${old.data.at}` && Date.parse(old.data.at)<=+at && +at-Date.parse(old.data.at)<=WALLET_MARKET_MAX_AGE_MS) sol=old.data;
  }
  const amountUsd = sol ? amountSol * sol.priceUsd : null;
  const implied = lookup.market?.marketCapUsd == null ? swapImpliedMarketCap(swapCtx?.mint, at, amountSol, amountUsd, swapCtx?.tokenAmount) : null;
  const market = lookup.market?.marketCapUsd != null ? lookup.market : implied ?? lookup.market;
  const marketCapUsd = market?.marketCapUsd ?? null;
  return { amountUsd, marketCapUsd,
    evidence: { version: 1, eventAt: at.toISOString(), market, sol, reasons: [...(!market ? ['NO_CONTEMPORANEOUS_MARKET'] : []), ...(implied ? [] : lookup.reason ? [lookup.reason] : []), ...(!sol ? ['NO_CONTEMPORANEOUS_SOL'] : [])] } };
}
