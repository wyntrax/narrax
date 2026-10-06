import type { WalletStats } from './stats';

/** A wallet needs at least this many closed trades before it gets a score at all. */
export const MIN_CLOSED_LEGS = 5;

/** Lower end of the 95% confidence interval for a win rate. Small samples score low on purpose. */
export function wilsonLowerBound(wins: number, n: number, z = 1.96): number {
  if (n === 0) return 0;
  const p = wins / n;
  const d = 1 + (z * z) / n;
  return Math.max(0, (p + (z * z) / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d);
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * Wallet score 0 to 100, or null when there is too little data.
 * Quality (win rate lower bound 35, median ROI 30, profit factor 20, drawdown 15) is scaled by a track-record
 * multiplier that grows from 0.6 to 1.0 as closed trades go from 0 to 20. Sample size only discounts a record,
 * it never adds points, so a wallet that trades a lot and loses still scores low.
 */
export function walletScore(s: WalletStats): number | null {
  const n = s.legs.length;
  if (n < MIN_CLOSED_LEGS) return null;
  const wins = s.legs.filter((l) => l.pnlSol > 0).length;
  const profitFactor = s.grossLossSol > 0 ? s.grossWinSol / s.grossLossSol : s.grossWinSol > 0 ? 4 : 0;
  const quality =
    0.35 * wilsonLowerBound(wins, n) +
    0.30 * (clamp(s.medianRoi ?? 0, 0, 2) / 2) +
    0.20 * (Math.min(profitFactor, 4) / 4) +
    0.15 * (1 - clamp(s.maxDrawdown, 0, 1));
  return Math.round(quality * (0.6 + 0.4 * Math.min(n / 20, 1)) * 1000) / 10;
}
