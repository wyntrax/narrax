import { PAPER_FEE_SOL } from './constants';

const LAMPORTS = 1_000_000_000;
/** SOL amounts are kept to one lamport so sums do not drift. */
export const roundSol = (n: number) => Math.round(n * LAMPORTS) / LAMPORTS;

/** Thrown when a fill cannot be computed from the inputs. A paper fill is never guessed. */
export class PaperFillError extends Error {}

const needPositive = (name: string, v: number) => {
  if (!Number.isFinite(v) || v <= 0) throw new PaperFillError(`${name} must be a positive number`);
};
const needImpact = (v: number) => {
  if (!Number.isFinite(v) || v < 0) throw new PaperFillError('Price impact must be a number of zero or more');
};
const needUnits = (name: string, v: string): bigint => {
  if (!/^\d+$/.test(v)) throw new PaperFillError(`${name} must be a whole number of base units`);
  return BigInt(v);
};

export interface PaperBuyInput {
  /** SOL to spend, already clamped by the Risk Governor. */
  sizeSol: number;
  /** Latest market price for the token, in USD. */
  marketPriceUsd: number;
  /** From a fresh Jupiter quote taken for exactly this size. */
  quote: { outAmount: string; priceImpactPct: number };
  feeSol?: number;
}

export interface PaperBuyFill {
  sizeSol: number;
  feeSol: number;
  baseUnits: string;
  expectedPriceUsd: number;
  fillPriceUsd: number;
  slippageBps: number;
  /** The entry fee is realized at once, so the daily-loss check sees it. Sells then book proceeds minus cost minus their own fee. */
  realizedPnlSol: number;
  /** Change in the paper cash balance. */
  cashDeltaSol: number;
}

/**
 * A paper buy. Token units come from the quote. The USD fill price is the market price worsened by the quote's
 * price impact: it is an approximation, because DEX Screener's price and Jupiter's route price can differ and we
 * hold no token decimals. It is consistent with how the monitor measures PnL (current market price over entry price).
 */
export function paperBuyFill(i: PaperBuyInput): PaperBuyFill {
  needPositive('Size', i.sizeSol);
  needPositive('Market price', i.marketPriceUsd);
  needImpact(i.quote.priceImpactPct);
  const units = needUnits('Quote output', i.quote.outAmount);
  if (units <= 0n) throw new PaperFillError('The quote returned no tokens');
  const feeSol = i.feeSol ?? PAPER_FEE_SOL;
  if (!Number.isFinite(feeSol) || feeSol < 0) throw new PaperFillError('Fee must be zero or more');
  return {
    sizeSol: roundSol(i.sizeSol), feeSol: roundSol(feeSol), baseUnits: units.toString(),
    expectedPriceUsd: i.marketPriceUsd, fillPriceUsd: i.marketPriceUsd * (1 + i.quote.priceImpactPct / 100),
    slippageBps: i.quote.priceImpactPct * 100, realizedPnlSol: roundSol(-feeSol), cashDeltaSol: roundSol(-(i.sizeSol + feeSol)),
  };
}

/** Same rounding processExecution uses to size the exit quote: held units times the fraction in basis points. */
export function sellUnits(baseUnits: string, exitFraction: number): bigint {
  const held = needUnits('Position units', baseUnits);
  if (!Number.isFinite(exitFraction) || exitFraction <= 0 || exitFraction > 1) throw new PaperFillError('Exit fraction must be above 0 and at most 1');
  return (held * BigInt(Math.round(exitFraction * 10_000))) / 10_000n;
}

export interface PaperSellInput {
  /** The position as it stands now: remaining units and remaining cost basis in SOL. */
  position: { baseUnits: string; costSol: number };
  exitFraction: number;
  marketPriceUsd: number;
  /** From a fresh quote for exactly the units being sold. inAmount is checked against them. */
  quote: { inAmount: string; outAmount: string; priceImpactPct: number };
  feeSol?: number;
}

export interface PaperSellFill {
  unitsSold: string;
  remainingUnits: string;
  proceedsSol: number;
  feeSol: number;
  costSoldSol: number;
  remainingCostSol: number;
  realizedPnlSol: number;
  expectedPriceUsd: number;
  fillPriceUsd: number;
  slippageBps: number;
  /** True when nothing is left, so the position closes. */
  closes: boolean;
  /** Change in the paper cash balance. */
  cashDeltaSol: number;
}

export function paperSellFill(i: PaperSellInput): PaperSellFill {
  needPositive('Market price', i.marketPriceUsd);
  needImpact(i.quote.priceImpactPct);
  if (!Number.isFinite(i.position.costSol) || i.position.costSol < 0) throw new PaperFillError('Position cost must be zero or more');
  const held = needUnits('Position units', i.position.baseUnits);
  const sold = sellUnits(i.position.baseUnits, i.exitFraction);
  if (sold <= 0n) throw new PaperFillError('The exit rounds to zero units');
  if (needUnits('Quote input', i.quote.inAmount) !== sold) throw new PaperFillError('The quote was not for the units being sold');
  const proceedsLamports = needUnits('Quote output', i.quote.outAmount);
  const feeSol = i.feeSol ?? PAPER_FEE_SOL;
  if (!Number.isFinite(feeSol) || feeSol < 0) throw new PaperFillError('Fee must be zero or more');

  const closes = sold === held;
  const costSold = closes ? i.position.costSol : (i.position.costSol * Number(sold)) / Number(held);
  const proceedsSol = Number(proceedsLamports) / LAMPORTS;
  return {
    unitsSold: sold.toString(), remainingUnits: (held - sold).toString(), proceedsSol: roundSol(proceedsSol), feeSol: roundSol(feeSol),
    costSoldSol: roundSol(costSold), remainingCostSol: closes ? 0 : roundSol(i.position.costSol - costSold),
    realizedPnlSol: roundSol(proceedsSol - costSold - feeSol),
    expectedPriceUsd: i.marketPriceUsd, fillPriceUsd: Math.max(0, i.marketPriceUsd * (1 - i.quote.priceImpactPct / 100)),
    slippageBps: i.quote.priceImpactPct * 100, closes, cashDeltaSol: roundSol(proceedsSol - feeSol),
  };
}

/** Paper cash: the start balance, less what buys cost (amount and fee), plus what sells brought in (amount less fee). */
export function paperBalance(i: { startSol: number; buys: { amountSol: number; feeSol: number }; sells: { amountSol: number; feeSol: number } }): number {
  return roundSol(i.startSol - (i.buys.amountSol + i.buys.feeSol) + (i.sells.amountSol - i.sells.feeSol));
}

/**
 * Cash plus each open paper position valued at the current price relative to its entry price.
 * Every position needs a price: a missing one throws, so the total is never understated by treating it as zero.
 */
export function paperPortfolioValue(cashSol: number, positions: { costSol: number; entryPriceUsd: number; priceUsd: number | null }[]): number {
  let total = cashSol;
  for (const p of positions) {
    if (p.priceUsd == null || !Number.isFinite(p.priceUsd) || p.priceUsd <= 0) throw new PaperFillError('A held token has no current price');
    if (!Number.isFinite(p.entryPriceUsd) || p.entryPriceUsd <= 0) throw new PaperFillError('A position has no entry price');
    total += p.costSol * (p.priceUsd / p.entryPriceUsd);
  }
  return roundSol(total);
}
