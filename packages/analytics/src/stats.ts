/**
 * Evidence gates. Below these, numbers are still shown but nothing is called better or worse.
 * UNVALIDATED starting values: a gate this low only stops the most obviously empty comparisons.
 */
export const GATES = {
  /** Fewest independent events a group needs before any verdict. */
  minSample: 30,
  /** Fewest distinct tokens. Many events from a few tokens are one bet counted many times. */
  minDistinctTokens: 15,
  /** Events on the same token closer together than this are one event: their 24h windows overlap. */
  dedupeWindowMs: 24 * 3_600_000,
  bootstrapIterations: 2000,
  seed: 20260101,
} as const;

export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);

export function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** 95% percentile-bootstrap interval for the mean. Deterministic: same input, same interval. */
export function bootstrapMeanCI(values: number[], iterations: number = GATES.bootstrapIterations, seed: number = GATES.seed): [number, number] | null {
  if (values.length < 2) return null;
  const rnd = mulberry32(seed), n = values.length, means: number[] = [];
  for (let i = 0; i < iterations; i++) { let s = 0; for (let j = 0; j < n; j++) s += values[Math.floor(rnd() * n)]!; means.push(s / n); }
  means.sort((a, b) => a - b);
  return [quantile(means, 0.025)!, quantile(means, 0.975)!];
}

/** 95% interval for a difference of two independent means. */
export function bootstrapDiffCI(a: number[], b: number[], iterations: number = GATES.bootstrapIterations, seed: number = GATES.seed): [number, number] | null {
  if (a.length < 2 || b.length < 2) return null;
  const rnd = mulberry32(seed), diffs: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let sa = 0, sb = 0;
    for (let j = 0; j < a.length; j++) sa += a[Math.floor(rnd() * a.length)]!;
    for (let j = 0; j < b.length; j++) sb += b[Math.floor(rnd() * b.length)]!;
    diffs.push(sa / a.length - sb / b.length);
  }
  diffs.sort((x, y) => x - y);
  return [quantile(diffs, 0.025)!, quantile(diffs, 0.975)!];
}

/** Wilson score interval for a rate. Honest at small n, unlike the plain normal interval. */
export function wilson(k: number, n: number, z = 1.96): [number, number] | null {
  if (n <= 0) return null;
  const p = k / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
}

export interface Item { tokenId: string; ret: number }

export interface Described {
  n: number;
  distinctTokens: number;
  mean: number | null;
  median: number | null;
  p10: number | null;
  p90: number | null;
  stdev: number | null;
  meanCi: [number, number] | null;
  /** Share of events with a return above `winAbove`. */
  winRate: number | null;
  winRateCi: [number, number] | null;
  sufficient: boolean;
  /** Why the numbers cannot support a verdict, or null. */
  note: string | null;
}

export const insufficiencyNote = (n: number, tokens: number): string | null => {
  const why: string[] = [];
  if (n < GATES.minSample) why.push(`${n} events, need at least ${GATES.minSample}`);
  if (tokens < GATES.minDistinctTokens) why.push(`${tokens} distinct tokens, need at least ${GATES.minDistinctTokens}`);
  return why.length ? `INSUFFICIENT DATA: ${why.join('; ')}` : null;
};

export function describeReturns(items: Item[], winAbove = 0): Described {
  const v = items.map((i) => i.ret).filter(Number.isFinite), sorted = [...v].sort((a, b) => a - b);
  const tokens = new Set(items.map((i) => i.tokenId)).size, m = mean(v);
  const wins = v.filter((x) => x > winAbove).length, note = insufficiencyNote(v.length, tokens);
  return {
    n: v.length, distinctTokens: tokens, mean: m, median: quantile(sorted, 0.5), p10: quantile(sorted, 0.1), p90: quantile(sorted, 0.9),
    stdev: m == null || v.length < 2 ? null : Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1)),
    meanCi: bootstrapMeanCI(v), winRate: v.length ? wins / v.length : null, winRateCi: wilson(wins, v.length), sufficient: note == null, note,
  };
}

export type Verdict = 'BETTER' | 'WORSE' | 'NO_CLEAR_DIFFERENCE' | 'INSUFFICIENT_DATA';

export interface Comparison { diff: number | null; ci: [number, number] | null; verdict: Verdict; note: string | null }

/** A against B on mean return. A verdict needs both groups past the gates and an interval that excludes zero. */
export function compareMeans(a: Item[], b: Item[]): Comparison {
  const da = describeReturns(a), db = describeReturns(b);
  const diff = da.mean != null && db.mean != null ? da.mean - db.mean : null;
  const ci = bootstrapDiffCI(a.map((x) => x.ret), b.map((x) => x.ret));
  const note = da.note ?? db.note;
  if (note || !ci || diff == null) return { diff, ci, verdict: 'INSUFFICIENT_DATA', note: note ?? 'too few events to form an interval' };
  return { diff, ci, verdict: ci[0] > 0 ? 'BETTER' : ci[1] < 0 ? 'WORSE' : 'NO_CLEAR_DIFFERENCE', note: null };
}

/** Keep the first event per token in each window, so overlapping outcome windows are not counted twice. */
export function dedupeEvents<T extends { tokenId: string; at: Date }>(events: T[], windowMs: number = GATES.dedupeWindowMs): T[] {
  const last = new Map<string, number>(), out: T[] = [];
  for (const e of [...events].sort((x, y) => x.at.getTime() - y.at.getTime())) {
    const prev = last.get(e.tokenId);
    if (prev == null || e.at.getTime() - prev >= windowMs) { out.push(e); last.set(e.tokenId, e.at.getTime()); }
  }
  return out;
}
