import { atOrAfter, atOrBefore, indexAfter, type Point } from './series';

/** Named, UNVALIDATED settings for labelling what happened after a decision. */
export const OUTCOME_CONFIG = {
  /** The price used as the decision's entry must be no older than this (same as the monitor's price freshness). */
  entryToleranceMs: 15 * 60_000,
  /** A horizon price may be this much later than the horizon itself. Past this the horizon is unmeasured. */
  horizonToleranceMs: 30 * 60_000,
  shortHorizonMs: 3_600_000,
  longHorizonMs: 24 * 3_600_000,
  /** The label is decided on the 24h price return, before costs: at or above this is a WIN, at or below the loss line a LOSS. */
  winReturnPct: 10,
  lossReturnPct: -10,
} as const;

export type OutcomeLabel = 'WIN' | 'LOSS' | 'FLAT' | 'UNKNOWN';
export type OutcomeStatus = 'PENDING' | 'FINAL';

export interface Outcome {
  status: OutcomeStatus;
  /** Why the outcome is UNKNOWN, when it is. */
  unknownReason: 'NO_ENTRY_PRICE' | 'NO_HORIZON_PRICE' | 'NOT_YET' | null;
  entryPriceUsd: number | null;
  return1hPct: number | null;
  return24hPct: number | null;
  /** Highest and lowest price within the 24h window, against the entry, in percent. */
  maxGainPct: number | null;
  maxDrawdownPct: number | null;
  /** Seconds from the decision to the highest price in the window. Only set when the decision was followed by a gain of at least winReturnPct. */
  leadTimeSeconds: number | null;
  label: OutcomeLabel;
}

const pct = (to: number, from: number) => (to / from - 1) * 100;

/**
 * What happened to a token's price after a decision. It only reads the stored series. A horizon with no price near it is
 * UNKNOWN, never zero and never carried forward. Tokens that rug often stop being tracked, so UNKNOWN is not random:
 * reports must show the unknown rate next to every win rate.
 */
export function measureOutcome(a: { decidedAt: Date; series: Point[]; now: Date; config?: typeof OUTCOME_CONFIG }): Outcome {
  const c = a.config ?? OUTCOME_CONFIG, t0 = a.decidedAt.getTime(), now = a.now.getTime();
  const lateEnough = now >= t0 + c.longHorizonMs + c.horizonToleranceMs;
  const empty = { entryPriceUsd: null, return1hPct: null, return24hPct: null, maxGainPct: null, maxDrawdownPct: null, leadTimeSeconds: null, label: 'UNKNOWN' as const };

  const entry = atOrBefore(a.series, t0, c.entryToleranceMs);
  if (!entry) return { ...empty, status: now >= t0 + c.entryToleranceMs ? 'FINAL' : 'PENDING', unknownReason: 'NO_ENTRY_PRICE' };
  const p0 = entry.priceUsd;

  const at1 = t0 + c.shortHorizonMs <= now ? atOrAfter(a.series, t0 + c.shortHorizonMs, c.horizonToleranceMs) : null;
  const at24 = t0 + c.longHorizonMs <= now ? atOrAfter(a.series, t0 + c.longHorizonMs, c.horizonToleranceMs) : null;

  let hi = p0, lo = p0, hiAt = t0;
  const end = Math.min(now, t0 + c.longHorizonMs);
  for (let i = indexAfter(a.series, t0); i < a.series.length && a.series[i]!.at.getTime() <= end; i++) {
    const p = a.series[i]!;
    if (p.priceUsd > hi) { hi = p.priceUsd; hiAt = p.at.getTime(); }
    if (p.priceUsd < lo) lo = p.priceUsd;
  }
  // Final once the 24h price exists (a later reading cannot change it), or once the wait for a late one has run out.
  const final = lateEnough || at24 != null;
  const status: OutcomeStatus = final ? 'FINAL' : 'PENDING';
  const r24 = at24 ? pct(at24.priceUsd, p0) : null, maxGain = pct(hi, p0);
  const label: OutcomeLabel = r24 == null ? 'UNKNOWN' : r24 >= c.winReturnPct ? 'WIN' : r24 <= c.lossReturnPct ? 'LOSS' : 'FLAT';
  return {
    status, entryPriceUsd: p0, return1hPct: at1 ? pct(at1.priceUsd, p0) : null, return24hPct: r24, maxGainPct: maxGain, maxDrawdownPct: pct(lo, p0),
    leadTimeSeconds: maxGain >= c.winReturnPct ? Math.round((hiAt - t0) / 1000) : null, label,
    unknownReason: label !== 'UNKNOWN' ? null : final ? 'NO_HORIZON_PRICE' : 'NOT_YET',
  };
}
