/** One stored market reading for a token. This is everything a replay is allowed to know at time `at`. */
export interface Point {
  at: Date;
  priceUsd: number;
  liquidityUsd: number;
  volume24hUsd: number;
}

/** Ascending by time, with unusable rows (no positive finite price) dropped. Never mutates the input. */
export function sortSeries(points: Point[]): Point[] {
  return points.filter((p) => Number.isFinite(p.priceUsd) && p.priceUsd > 0 && Number.isFinite(p.at.getTime())).sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Index of the first point strictly after `t` (series.length if none). Binary search; the series must be sorted. */
export function indexAfter(series: Point[], t: number): number {
  let lo = 0, hi = series.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (series[mid]!.at.getTime() <= t) lo = mid + 1; else hi = mid; }
  return lo;
}

/** The latest point at or before `t`, but only if it is no older than `tolMs`. Looking back, never forward. */
export function atOrBefore(series: Point[], t: number, tolMs: number): Point | null {
  const i = indexAfter(series, t) - 1;
  const p = i >= 0 ? series[i]! : null;
  return p && t - p.at.getTime() <= tolMs ? p : null;
}

/** The earliest point at or after `t`, but only if it is no more than `tolMs` later. */
export function atOrAfter(series: Point[], t: number, tolMs: number): Point | null {
  const i = indexAfter(series, t - 1); // first point with at >= t
  const p = i < series.length ? series[i]! : null;
  return p && p.at.getTime() - t <= tolMs ? p : null;
}

/** Typical spacing between readings. Rules that look an hour back or watch for a collapse are only as good as this. */
export function medianGapMs(series: Point[]): number | null {
  if (series.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < series.length; i++) gaps.push(series[i]!.at.getTime() - series[i - 1]!.at.getTime());
  gaps.sort((a, b) => a - b);
  return gaps[gaps.length >> 1]!;
}
