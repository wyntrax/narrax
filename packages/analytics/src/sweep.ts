import type { ExitRules } from '@narra/positions';
import { REFERENCE_EXIT } from './compare';
import { replayExit, withRules, type ReplayEvent, type ReplayOptions } from './replay';
import { GATES, bootstrapMeanCI, insufficiencyNote, mean, type Verdict } from './stats';

export interface Candidate { label: string; opts: ReplayOptions }

export interface SweepRow { label: string; trainMean: number | null; testMean: number | null }

export interface SweepResult {
  combinations: number;
  trainEvents: number;
  testEvents: number;
  /** The ten best in training. Their test means show how much of the training edge survived. */
  top: SweepRow[];
  best: SweepRow | null;
  reference: SweepRow | null;
  /** Mean per-event gain of the best-in-training over the reference, on the held-out test events only. */
  testGain: { mean: number; ci: [number, number] | null } | null;
  verdict: Verdict;
  note: string;
}

/**
 * Tries every candidate on the earlier part of the history (training), picks the best, and checks it against the reference
 * on the later part (test) that was never used to choose. With many candidates the best-in-training is better than
 * average by chance alone, so only the test result counts, and it needs the same evidence gates as any other comparison.
 */
export function sweepRules(events: ReplayEvent[], candidates: Candidate[], referenceLabel: string, trainFrac = 0.7): SweepResult {
  const ref = candidates.find((c) => c.label === referenceLabel);
  const sorted = [...events].sort((a, b) => a.at.getTime() - b.at.getTime());
  const empty = (note: string): SweepResult => ({ combinations: candidates.length, trainEvents: 0, testEvents: 0, top: [], best: null, reference: null, testGain: null, verdict: 'INSUFFICIENT_DATA', note });
  if (!ref) throw new Error('The reference candidate is not in the list');

  const usable = sorted.filter((e) => replayExit(e, ref.opts) != null);
  if (usable.length < 2) return empty(`${usable.length} replayable events`);
  const split = Math.max(1, Math.min(usable.length - 1, Math.floor(usable.length * trainFrac)));
  const nets = candidates.map((c) => usable.map((e) => replayExit(e, c.opts)?.netReturnPct ?? null));
  const rows = candidates.map((c, k): SweepRow => {
    const col = nets[k]!;
    const tr = col.slice(0, split).filter((x): x is number => x != null), te = col.slice(split).filter((x): x is number => x != null);
    return { label: c.label, trainMean: mean(tr), testMean: mean(te) };
  });
  const refIdx = candidates.indexOf(ref);
  let bestIdx = 0;
  rows.forEach((r, k) => { if ((r.trainMean ?? -Infinity) > (rows[bestIdx]!.trainMean ?? -Infinity)) bestIdx = k; });
  const test = usable.slice(split);
  const diffs = test.map((_, i) => (nets[bestIdx]![split + i] ?? NaN) - (nets[refIdx]![split + i] ?? NaN)).filter(Number.isFinite);
  const tokens = new Set(test.map((e) => e.tokenId)).size, gate = insufficiencyNote(diffs.length, tokens);
  const ci = bootstrapMeanCI(diffs), gain = diffs.length ? { mean: mean(diffs)!, ci } : null;
  const caveat = `${candidates.length} combinations were tried on the same history, so the best in training is optimistic by construction. Only the held-out test events count.`;
  let verdict: Verdict = 'INSUFFICIENT_DATA', note = `${gate ?? ''} ${caveat}`.trim();
  if (!gate && ci) {
    if (bestIdx === refIdx) { verdict = 'NO_CLEAR_DIFFERENCE'; note = `The reference was best in training. ${caveat}`; }
    else { verdict = ci[0] > 0 ? 'BETTER' : ci[1] < 0 ? 'WORSE' : 'NO_CLEAR_DIFFERENCE'; note = caveat; }
  }
  return {
    combinations: candidates.length, trainEvents: split, testEvents: usable.length - split,
    top: [...rows].sort((a, b) => (b.trainMean ?? -Infinity) - (a.trainMean ?? -Infinity)).slice(0, 10), best: rows[bestIdx]!, reference: rows[refIdx]!, testGain: gain, verdict, note,
  };
}

const exitLabel = (e: ExitRules) => `stop=${e.stopLossPct ?? 'none'} target=${e.takeProfitPct ?? 'none'} trail=${e.trailingStopPct ?? 'none'}`;
export const REFERENCE_EXIT_LABEL = exitLabel(REFERENCE_EXIT);

/** Stop, target and trailing stop levels. The reference set is one of the combinations. */
export function exitLevelCandidates(): Candidate[] {
  const out: Candidate[] = [];
  for (const stopLossPct of [null, 15, 25, 35, 50]) for (const takeProfitPct of [null, 50, 100, 200]) for (const trailingStopPct of [null, 15, 25, 35]) {
    const exit = { stopLossPct, takeProfitPct, trailingStopPct };
    out.push({ label: exitLabel(exit), opts: { exit } });
  }
  return out;
}

export const LIVE_RULES_LABEL = 'liquidity reduce=40 sell=70, momentum=25, warnings=2 (live)';

/** The replayable monitor thresholds, with the exit levels held at the reference set. The live values are one combination. */
export function monitorRuleCandidates(): Candidate[] {
  const out: Candidate[] = [];
  for (const reduceDropPct of [25, 40, 55]) for (const sellDropPct of [55, 70, 85]) for (const mom of [15, 25, 40]) for (const warn of [1, 2, 3]) {
    const live = reduceDropPct === 40 && sellDropPct === 70 && mom === 25 && warn === 2;
    out.push({
      label: live ? LIVE_RULES_LABEL : `liquidity reduce=${reduceDropPct} sell=${sellDropPct}, momentum=${mom}, warnings=${warn}`,
      opts: { exit: REFERENCE_EXIT, rules: withRules({ liquidity: { reduceDropPct, sellDropPct }, momentumWarnDropPct1h: mom, warningsToReduce: warn }) },
    });
  }
  return out;
}
export { GATES };
