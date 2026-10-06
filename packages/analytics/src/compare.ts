import type { ExitRules } from '@narra/positions';
import { OUTCOME_CONFIG, measureOutcome } from './outcome';
import { DEFAULT_ROUND_TRIP_COST_PCT, replayExit, type ReplayEvent } from './replay';
import { GATES, compareMeans, dedupeEvents, describeReturns, mean, quantile, type Comparison, type Described, type Item } from './stats';

/**
 * One fixed set of exit levels, so strategies are compared under the same exits. It is a reference point,
 * not a recommendation. UNVALIDATED.
 */
export const REFERENCE_EXIT: ExitRules = { stopLossPct: 25, takeProfitPct: 100, trailingStopPct: 25 };

export interface StrategyEvent extends ReplayEvent {
  confidence?: number;
  codes?: string[];
  /** The exit levels the decision itself carried (AI decisions only). */
  ownExit?: ExitRules | null;
}

export interface StrategyResult {
  name: string;
  /** Events after dropping overlaps (same token within 24h). */
  events: number;
  /** Younger than 24h plus tolerance: not counted yet. */
  pending: number;
  /** Final but with no price at the 24h mark. Not random: tokens that rug often stop being tracked. */
  unknown: number;
  unknownRate: number | null;
  /** Buy and hold 24h, net of the round-trip cost. */
  hold: Described;
  holdItems: Item[];
  /** The same entries run through the live exit rules at the reference exit levels, net of cost. */
  withRules: Described;
  ruleItems: Item[];
  /** Mean hold return if every unknown had been a total loss. A floor on how bad the missing data could make it look. */
  holdMeanIfUnknownTotalLoss: number | null;
  /** Median seconds from the signal to the high, over events that were followed by a gain. */
  medianLeadTimeSeconds: number | null;
  /** AI only: the decisions' own exit levels instead of the reference ones. */
  withOwnExit: Described | null;
}

export function evaluateStrategy(name: string, raw: StrategyEvent[], now: Date, opts: { costPct?: number; exit?: ExitRules } = {}): StrategyResult {
  const cost = opts.costPct ?? DEFAULT_ROUND_TRIP_COST_PCT, exit = opts.exit ?? REFERENCE_EXIT;
  const events = dedupeEvents(raw), holdItems: Item[] = [], ruleItems: Item[] = [], ownItems: Item[] = [], leads: number[] = [];
  let pending = 0, unknown = 0;
  for (const e of events) {
    const o = measureOutcome({ decidedAt: e.at, series: e.series, now });
    if (o.status === 'PENDING') { pending++; continue; }
    if (o.return24hPct == null) { unknown++; continue; }
    holdItems.push({ tokenId: e.tokenId, ret: o.return24hPct - cost });
    if (o.leadTimeSeconds != null) leads.push(o.leadTimeSeconds);
    const r = replayExit(e, { exit, costPct: cost });
    if (r) ruleItems.push({ tokenId: e.tokenId, ret: r.netReturnPct });
    if (e.ownExit) { const own = replayExit(e, { exit: e.ownExit, costPct: cost }); if (own) ownItems.push({ tokenId: e.tokenId, ret: own.netReturnPct }); }
  }
  const finals = holdItems.length + unknown;
  return {
    name, events: events.length, pending, unknown, unknownRate: finals ? unknown / finals : null, hold: describeReturns(holdItems), holdItems,
    withRules: describeReturns(ruleItems), ruleItems,
    holdMeanIfUnknownTotalLoss: finals ? mean([...holdItems.map((i) => i.ret), ...Array<number>(unknown).fill(-100 - cost)]) : null,
    medianLeadTimeSeconds: quantile([...leads].sort((a, b) => a - b), 0.5), withOwnExit: ownItems.length ? describeReturns(ownItems) : null,
  };
}

export interface StrategyComparison { name: string; vsBaselineHold: Comparison; vsBaselineRules: Comparison }

/** Each strategy against the baseline of tracked tokens at arbitrary times. "Beating a coin flip" is the first bar to clear. */
export function compareToBaseline(results: StrategyResult[], baselineName: string): StrategyComparison[] {
  const base = results.find((r) => r.name === baselineName);
  return results.filter((r) => r.name !== baselineName).map((r) => ({
    name: r.name,
    vsBaselineHold: base ? compareMeans(r.holdItems, base.holdItems) : { diff: null, ci: null, verdict: 'INSUFFICIENT_DATA', note: 'no baseline' },
    vsBaselineRules: base ? compareMeans(r.ruleItems, base.ruleItems) : { diff: null, ci: null, verdict: 'INSUFFICIENT_DATA', note: 'no baseline' },
  }));
}

export interface Bucket { label: string; described: Described }

/** Returns grouped by a number (confidence, score), each group judged on its own sample size. */
export function calibrateByBucket(items: (Item & { key: number })[], edges: number[]): Bucket[] {
  const out: Bucket[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i]!, hi = edges[i + 1]!, last = i === edges.length - 2;
    out.push({ label: `${lo} to ${hi}`, described: describeReturns(items.filter((x) => x.key >= lo && (last ? x.key <= hi : x.key < hi))) });
  }
  return out;
}

/** Returns grouped by reason code. One decision counts under every code it carries. */
export function calibrateBySignal(items: (Item & { codes: string[] })[]): Bucket[] {
  const by = new Map<string, Item[]>();
  for (const it of items) for (const c of new Set(it.codes)) by.set(c, [...(by.get(c) ?? []), it]);
  return [...by.entries()].map(([label, v]) => ({ label, described: describeReturns(v) })).sort((a, b) => b.described.n - a.described.n);
}

export const MIN_EVENTS_NOTE = `${GATES.minSample} independent events across ${GATES.minDistinctTokens} tokens`;
export { OUTCOME_CONFIG };
