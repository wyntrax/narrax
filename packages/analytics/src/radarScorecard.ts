import { atOrAfter, atOrBefore, indexAfter, sortSeries, type Point } from './series';
import { DEFAULT_ROUND_TRIP_COST_PCT } from './replay';
import { dedupeEvents, describeReturns, quantile, type Described, type Item } from './stats';

/**
 * Early Radar scorecard. This is measurement, not a promotion: it reads the frozen entry snapshot
 * written at alert time and the stored 5-minute prices only. Nothing here writes, predicts or trades.
 *
 * Named, UNVALIDATED starting values:
 * - Horizons are 15m/1h/4h/24h because the live data says the morning pop is gone by the next day.
 * - Take-profit fills are capped at the target (a limit sell); stops fill at the first close beyond
 *   the stop (gap risk is not hidden). Only closes are used: no intra-bar high or low exists in storage.
 * - Trailing stops arm only after the peak reaches the activation level, then exit on a close below
 *   peak * (1 - trail). All rules subtract one round-trip cost.
 */
export const RADAR_HORIZONS = [
  { hours: 0.25, label: '15 minutes', toleranceMs: 10 * 60_000 },
  { hours: 1, label: '1 hour', toleranceMs: 30 * 60_000 },
  { hours: 4, label: '4 hours', toleranceMs: 30 * 60_000 },
  { hours: 24, label: '24 hours', toleranceMs: 30 * 60_000 },
] as const;

export const RADAR_PEAKS = [
  { hours: 1, label: 'first hour' },
  { hours: 4, label: 'first 4 hours' },
  { hours: 24, label: 'first 24 hours' },
] as const;

export const RADAR_CALL_DEDUPE_MS = 24 * 3_600_000;

export interface RadarCall {
  id: string;
  tokenId: string;
  mint: string | null;
  alertedAt: Date;
  profile: string;
  tier: string;
  route: string;
  matchKind: string;
  score: number | null;
  entryPriceUsd: number | null;
  entryAt: Date | null;
  entryMarketCapUsd: number | null;
  entryUnknownReason: string | null;
}

export type RadarStatus = 'OBSERVED' | 'UNKNOWN' | 'PENDING';

export interface RadarHorizonResult {
  hours: number;
  label: string;
  status: RadarStatus;
  returnPct: number | null;
  observedAt: Date | null;
  unknownReason: string | null;
}

export interface RadarPeakResult {
  windowHours: number;
  label: string;
  status: RadarStatus;
  peakGainPct: number | null;
  peakAt: Date | null;
  timeToPeakSeconds: number | null;
  endReturnPct: number | null;
  giveBackPct: number | null;
  postPeakLowPct: number | null;
}

export type RadarExitReason = 'TAKE_PROFIT' | 'STOP' | 'TRAILING' | 'TIME' | 'NO_DATA' | 'PENDING';

export interface RadarExitRule {
  id: string;
  label: string;
  maxHoldHours: number;
  takeProfitPct?: number;
  stopLossPct?: number;
  trailingStopPct?: number;
  trailingActivatePct?: number;
}

/** A reference set, not a recommendation. It compares holding with exiting at fixed, repeatable levels. */
export const RADAR_EXIT_RULES: readonly RadarExitRule[] = [
  { id: 'hold-1h', label: 'Hold 1 hour', maxHoldHours: 1 },
  { id: 'hold-4h', label: 'Hold 4 hours', maxHoldHours: 4 },
  { id: 'hold-24h', label: 'Hold 24 hours', maxHoldHours: 24 },
  { id: 'tp25', label: 'Take profit +25% (4h)', maxHoldHours: 4, takeProfitPct: 25 },
  { id: 'tp50', label: 'Take profit +50% (4h)', maxHoldHours: 4, takeProfitPct: 50 },
  { id: 'tp100', label: 'Take profit +100% (4h)', maxHoldHours: 4, takeProfitPct: 100 },
  { id: 'stop25', label: 'Stop -25% (4h)', maxHoldHours: 4, stopLossPct: 25 },
  { id: 'trail25', label: 'Trail 25% after +10% (4h)', maxHoldHours: 4, trailingStopPct: 25, trailingActivatePct: 10 },
  {
    id: 'tp50-trail25-stop25',
    label: 'TP +50% / trail 25% / stop -25% (4h)',
    maxHoldHours: 4,
    takeProfitPct: 50,
    stopLossPct: 25,
    trailingStopPct: 25,
    trailingActivatePct: 10,
  },
];

export interface RadarExitResult {
  rule: string;
  status: RadarStatus;
  exitAt: Date | null;
  exitPriceUsd: number | null;
  reason: RadarExitReason;
  grossReturnPct: number | null;
  netReturnPct: number | null;
  holdNetReturnPct: number | null;
  exitBenefitPct: number | null;
}

export interface RadarCallResult {
  call: RadarCall;
  entryKnown: boolean;
  horizons: RadarHorizonResult[];
  peaks: RadarPeakResult[];
  exits: RadarExitResult[];
}

export interface RadarHorizonSummary {
  hours: number;
  label: string;
  raw: number;
  independent: number;
  known: number;
  tokens: number;
  pending: number;
  unknown: number;
  unknownRate: number | null;
  returns: Described;
}

export interface RadarPeakSummary {
  windowHours: number;
  label: string;
  raw: number;
  independent: number;
  known: number;
  tokens: number;
  pending: number;
  unknown: number;
  positivePeaks: number;
  medianPeakGainPct: number | null;
  medianEndReturnPct: number | null;
  medianGiveBackPct: number | null;
  medianTimeToPeakSeconds: number | null;
  peaks: Described;
}

export interface RadarExitSummary {
  id: string;
  label: string;
  raw: number;
  independent: number;
  known: number;
  tokens: number;
  pending: number;
  unknown: number;
  net: Described;
  medianHoldNetPct: number | null;
  medianBenefitPct: number | null;
  /** Median benefit over calls the rule actually changed. Null when it never changed an exit. */
  medianBenefitWhenDifferent: number | null;
  beatHoldRate: number | null;
  exitReasons: Record<string, number>;
}

export interface RadarDay {
  day: string;
  calls: number;
  tokens: number;
}

export interface RadarBucket {
  key: string;
  label: string;
  calls: number;
  independent: number;
  overlapExcluded: number;
  distinctTokens: number;
  entryUnknown: number;
  horizons: RadarHorizonSummary[];
  peaks: RadarPeakSummary[];
  exits: RadarExitSummary[];
}

export interface RadarScorecard {
  from: Date;
  to: Date;
  now: Date;
  costPct: number;
  newestCallAt: Date | null;
  oldestCallAt: Date | null;
  calls: number;
  independentCalls: number;
  overlapExcluded: number;
  distinctTokens: number;
  entryUnknown: number;
  daily: RadarDay[];
  overall: RadarBucket;
  byProfile: RadarBucket[];
  byTier: RadarBucket[];
  byScore: RadarBucket[];
  byEntryMarketCap: RadarBucket[];
  notes: string[];
}

export interface RadarScorecardOptions {
  from: Date;
  to: Date;
  now: Date;
  costPct?: number;
}

const positive = (n: number | null | undefined): number | null => (n != null && Number.isFinite(n) && n > 0 ? n : null);
const pct = (to: number, from: number) => (to / from - 1) * 100;

/** Keep the first call per token in each 24h window. Two calls on one token are one bet, not two. */
export function dedupeRadarCalls(calls: RadarCall[], windowMs: number = RADAR_CALL_DEDUPE_MS): RadarCall[] {
  const wrapped = calls.map((call) => ({ ...call, at: call.alertedAt }));
  return dedupeEvents(wrapped, windowMs).map(({ at: _at, ...call }) => call);
}

export function measureRadarHorizon(
  call: RadarCall,
  series: Point[],
  horizon: (typeof RADAR_HORIZONS)[number],
  now: Date,
): RadarHorizonResult {
  const base = { hours: horizon.hours, label: horizon.label };
  const entry = positive(call.entryPriceUsd);
  const target = call.alertedAt.getTime() + horizon.hours * 3_600_000;
  const nowMs = now.getTime();
  if (entry == null) return { ...base, status: 'UNKNOWN', returnPct: null, observedAt: null, unknownReason: 'NO_ENTRY_PRICE' };
  if (nowMs < target) return { ...base, status: 'PENDING', returnPct: null, observedAt: null, unknownReason: 'NOT_YET' };
  const point = atOrAfter(series, target, horizon.toleranceMs);
  if (!point) {
    const pending = nowMs < target + horizon.toleranceMs;
    return {
      ...base,
      status: pending ? 'PENDING' : 'UNKNOWN',
      returnPct: null,
      observedAt: null,
      unknownReason: pending ? 'NOT_YET' : 'NO_HORIZON_PRICE',
    };
  }
  const ret = pct(point.priceUsd, entry);
  return {
    ...base,
    status: Number.isFinite(ret) ? 'OBSERVED' : 'UNKNOWN',
    returnPct: Number.isFinite(ret) ? ret : null,
    observedAt: point.at,
    unknownReason: Number.isFinite(ret) ? null : 'NO_HORIZON_PRICE',
  };
}

export function measureRadarPeak(
  call: RadarCall,
  series: Point[],
  window: (typeof RADAR_PEAKS)[number],
  now: Date,
): RadarPeakResult {
  const base = { windowHours: window.hours, label: window.label };
  const empty = {
    ...base,
    peakGainPct: null,
    peakAt: null,
    timeToPeakSeconds: null,
    endReturnPct: null,
    giveBackPct: null,
    postPeakLowPct: null,
  };
  const entry = positive(call.entryPriceUsd);
  if (entry == null) return { ...empty, status: 'UNKNOWN' };
  const start = call.alertedAt.getTime();
  const end = start + window.hours * 3_600_000;
  if (now.getTime() < end + 30 * 60_000) return { ...empty, status: 'PENDING' };

  let peak = entry, peakAt = call.alertedAt;
  let lowAfterPeak = entry;
  const first = indexAfter(series, start);
  for (let i = first; i < series.length && series[i]!.at.getTime() <= end; i++) {
    const point = series[i]!;
    if (point.priceUsd > peak) {
      peak = point.priceUsd;
      peakAt = point.at;
      lowAfterPeak = point.priceUsd;
    } else if (point.priceUsd < lowAfterPeak) {
      lowAfterPeak = point.priceUsd;
    }
  }
  const endPoint = atOrBefore(series, end, 30 * 60_000);
  if (peak === entry && !endPoint) return { ...empty, status: 'UNKNOWN' };
  return {
    ...base,
    status: 'OBSERVED',
    peakGainPct: pct(peak, entry),
    peakAt,
    timeToPeakSeconds: peak > entry ? Math.round((peakAt.getTime() - start) / 1000) : null,
    endReturnPct: endPoint ? pct(endPoint.priceUsd, entry) : null,
    giveBackPct: endPoint && peak > 0 ? ((peak - endPoint.priceUsd) / peak) * 100 : null,
    postPeakLowPct: peak > 0 ? pct(lowAfterPeak, peak) : null,
  };
}

export function replayRadarExit(
  call: RadarCall,
  series: Point[],
  rule: RadarExitRule,
  now: Date,
  costPct: number = DEFAULT_ROUND_TRIP_COST_PCT,
): RadarExitResult {
  const empty = {
    rule: rule.id,
    exitAt: null,
    exitPriceUsd: null,
    grossReturnPct: null,
    netReturnPct: null,
    holdNetReturnPct: null,
    exitBenefitPct: null,
  };
  const entry = positive(call.entryPriceUsd);
  if (entry == null) return { ...empty, status: 'UNKNOWN', reason: 'NO_DATA' };
  const start = call.alertedAt.getTime(), end = start + rule.maxHoldHours * 3_600_000;
  if (now.getTime() < end + 30 * 60_000) return { ...empty, status: 'PENDING', reason: 'PENDING' };

  const takeProfit = rule.takeProfitPct != null ? entry * (1 + rule.takeProfitPct / 100) : null;
  const stop = rule.stopLossPct != null ? entry * (1 - rule.stopLossPct / 100) : null;
  const trail = rule.trailingStopPct != null ? rule.trailingStopPct / 100 : null;
  const activate = rule.trailingActivatePct != null ? entry * (1 + rule.trailingActivatePct / 100) : null;

  let peak = entry, armed = false, exitPrice: number | null = null, exitAt: Date | null = null;
  let reason: RadarExitReason = 'TIME';
  const first = indexAfter(series, start);
  for (let i = first; i < series.length && series[i]!.at.getTime() <= end; i++) {
    const point = series[i]!;
    if (stop != null && point.priceUsd <= stop) {
      exitPrice = point.priceUsd;
      exitAt = point.at;
      reason = 'STOP';
      break;
    }
    if (takeProfit != null && point.priceUsd >= takeProfit) {
      exitPrice = takeProfit;
      exitAt = point.at;
      reason = 'TAKE_PROFIT';
      break;
    }
    if (point.priceUsd > peak) peak = point.priceUsd;
    if (activate != null && peak >= activate) armed = true;
    if (armed && trail != null && point.priceUsd <= peak * (1 - trail)) {
      exitPrice = point.priceUsd;
      exitAt = point.at;
      reason = 'TRAILING';
      break;
    }
  }

  const endPoint = atOrBefore(series, end, 30 * 60_000) ?? lastInWindow(series, start, end);
  if (exitPrice == null) {
    if (!endPoint) return { ...empty, status: 'UNKNOWN', reason: 'NO_DATA' };
    exitPrice = endPoint.priceUsd;
    exitAt = endPoint.at;
    reason = 'TIME';
  }
  const gross = pct(exitPrice, entry);
  const holdGross = endPoint ? pct(endPoint.priceUsd, entry) : null;
  const holdNet = holdGross == null ? null : holdGross - costPct;
  return {
    rule: rule.id,
    status: 'OBSERVED',
    exitAt,
    exitPriceUsd: exitPrice,
    reason,
    grossReturnPct: gross,
    netReturnPct: gross - costPct,
    holdNetReturnPct: holdNet,
    exitBenefitPct: holdNet == null ? null : gross - costPct - holdNet,
  };
}

function lastInWindow(series: Point[], start: number, end: number): Point | null {
  let last: Point | null = null;
  for (let i = indexAfter(series, start); i < series.length && series[i]!.at.getTime() <= end; i++) last = series[i]!;
  return last;
}

export function evaluateRadarCall(call: RadarCall, series: Point[], now: Date, costPct: number = DEFAULT_ROUND_TRIP_COST_PCT): RadarCallResult {
  const sorted = sortSeries(series);
  return {
    call,
    entryKnown: positive(call.entryPriceUsd) != null,
    horizons: RADAR_HORIZONS.map((h) => measureRadarHorizon(call, sorted, h, now)),
    peaks: RADAR_PEAKS.map((p) => measureRadarPeak(call, sorted, p, now)),
    exits: RADAR_EXIT_RULES.map((r) => replayRadarExit(call, sorted, r, now, costPct)),
  };
}

function horizonSummary(rows: RadarCallResult[], raw: number, horizon: { hours: number; label: string }): RadarHorizonSummary {
  const hs = rows.map((r) => ({ row: r, h: r.horizons.find((x) => x.hours === horizon.hours)! }));
  const known = hs.filter((x) => x.h.status === 'OBSERVED' && x.h.returnPct != null);
  const items: Item[] = known.map((x) => ({ tokenId: x.row.call.tokenId, ret: x.h.returnPct! }));
  const returns = describeReturns(items);
  const pending = hs.filter((x) => x.h.status === 'PENDING').length;
  const unknown = hs.filter((x) => x.h.status === 'UNKNOWN').length;
  return {
    hours: horizon.hours,
    label: horizon.label,
    raw,
    independent: rows.length,
    known: returns.n,
    tokens: returns.distinctTokens,
    pending,
    unknown,
    unknownRate: returns.n + unknown > 0 ? unknown / (returns.n + unknown) : null,
    returns,
  };
}

function peakSummary(rows: RadarCallResult[], raw: number, window: { hours: number; label: string }): RadarPeakSummary {
  const ps = rows.map((r) => ({ row: r, p: r.peaks.find((x) => x.windowHours === window.hours)! }));
  const known = ps.filter((x) => x.p.status === 'OBSERVED');
  const peakItems: Item[] = known.filter((x) => x.p.peakGainPct != null).map((x) => ({ tokenId: x.row.call.tokenId, ret: x.p.peakGainPct! }));
  const endItems: Item[] = known.filter((x) => x.p.endReturnPct != null).map((x) => ({ tokenId: x.row.call.tokenId, ret: x.p.endReturnPct! }));
  const giveBackItems: Item[] = known.filter((x) => x.p.giveBackPct != null).map((x) => ({ tokenId: x.row.call.tokenId, ret: x.p.giveBackPct! }));
  const times = known.filter((x) => x.p.timeToPeakSeconds != null).map((x) => x.p.timeToPeakSeconds!).sort((a, b) => a - b);
  const peaks = describeReturns(peakItems, 0);
  return {
    windowHours: window.hours,
    label: window.label,
    raw,
    independent: rows.length,
    known: peaks.n,
    tokens: peaks.distinctTokens,
    pending: ps.filter((x) => x.p.status === 'PENDING').length,
    unknown: ps.filter((x) => x.p.status === 'UNKNOWN').length,
    positivePeaks: peakItems.filter((i) => i.ret > 0).length,
    medianPeakGainPct: peaks.median,
    medianEndReturnPct: describeReturns(endItems).median,
    medianGiveBackPct: describeReturns(giveBackItems).median,
    medianTimeToPeakSeconds: quantile(times, 0.5),
    peaks,
  };
}

function exitSummary(rows: RadarCallResult[], raw: number, rule: RadarExitRule): RadarExitSummary {
  const rs = rows.map((r) => ({ row: r, e: r.exits.find((x) => x.rule === rule.id)! }));
  const known = rs.filter((x) => x.e.status === 'OBSERVED' && x.e.netReturnPct != null);
  const items: Item[] = known.map((x) => ({ tokenId: x.row.call.tokenId, ret: x.e.netReturnPct! }));
  const holdItems: Item[] = known.filter((x) => x.e.holdNetReturnPct != null).map((x) => ({ tokenId: x.row.call.tokenId, ret: x.e.holdNetReturnPct! }));
  const benefitItems = known.filter((x) => x.e.exitBenefitPct != null).map((x) => x.e.exitBenefitPct!);
  const reasons: Record<string, number> = {};
  for (const x of known) reasons[x.e.reason] = (reasons[x.e.reason] ?? 0) + 1;
  return {
    id: rule.id,
    label: rule.label,
    raw,
    independent: rows.length,
    known: items.length,
    tokens: new Set(known.map((x) => x.row.call.tokenId)).size,
    pending: rs.filter((x) => x.e.status === 'PENDING').length,
    unknown: rs.filter((x) => x.e.status === 'UNKNOWN').length,
    net: describeReturns(items),
    medianHoldNetPct: describeReturns(holdItems).median,
    medianBenefitPct: benefitItems.length ? quantile([...benefitItems].sort((a, b) => a - b), 0.5) : null,
    medianBenefitWhenDifferent: (() => {
      const changed = benefitItems.filter((x) => Math.abs(x) > 1e-9).sort((a, b) => a - b);
      return changed.length ? quantile(changed, 0.5) : null;
    })(),
    beatHoldRate: benefitItems.length ? benefitItems.filter((x) => x > 0).length / benefitItems.length : null,
    exitReasons: reasons,
  };
}

function buildBucket(key: string, label: string, calls: RadarCall[], results: Map<string, RadarCallResult>): RadarBucket {
  const independent24 = dedupeRadarCalls(calls);
  const rowsFor = (subset: RadarCall[]) => subset.map((c) => results.get(c.id)!).filter(Boolean);
  return {
    key,
    label,
    calls: calls.length,
    independent: independent24.length,
    overlapExcluded: calls.length - independent24.length,
    distinctTokens: new Set(independent24.map((c) => c.tokenId)).size,
    entryUnknown: independent24.filter((c) => positive(c.entryPriceUsd) == null).length,
    horizons: RADAR_HORIZONS.map((h) => horizonSummary(rowsFor(dedupeRadarCalls(calls, h.hours * 3_600_000)), calls.length, h)),
    peaks: RADAR_PEAKS.map((p) => peakSummary(rowsFor(dedupeRadarCalls(calls, p.hours * 3_600_000)), calls.length, p)),
    exits: RADAR_EXIT_RULES.map((r) => exitSummary(rowsFor(dedupeRadarCalls(calls, r.maxHoldHours * 3_600_000)), calls.length, r)),
  };
}

function group(calls: RadarCall[], key: (c: RadarCall) => string): Map<string, RadarCall[]> {
  const out = new Map<string, RadarCall[]>();
  for (const call of calls) {
    const k = key(call);
    out.set(k, [...(out.get(k) ?? []), call]);
  }
  return out;
}

export const scoreBand = (score: number | null): string => {
  if (score == null) return 'unknown';
  if (score < 55) return 'under 55';
  if (score < 60) return '55 to 59';
  if (score < 70) return '60 to 69';
  if (score < 80) return '70 to 79';
  return '80 and above';
};

export const entryCapBand = (cap: number | null): string => {
  if (cap == null) return 'unknown';
  if (cap < 20_000) return 'under $20k';
  if (cap < 50_000) return '$20k to $50k';
  if (cap < 100_000) return '$50k to $100k';
  return '$100k and above';
};

const bandOrder = (a: string, b: string, order: readonly string[]) => {
  const ai = order.indexOf(a), bi = order.indexOf(b);
  return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.localeCompare(b);
};

export function buildRadarScorecard(
  calls: RadarCall[],
  pricesByToken: Map<string, Point[]>,
  options: RadarScorecardOptions,
): RadarScorecard {
  const costPct = options.costPct ?? DEFAULT_ROUND_TRIP_COST_PCT;
  const inRange = calls.filter((c) => c.alertedAt >= options.from && c.alertedAt <= options.to);
  const results = new Map<string, RadarCallResult>();
  for (const call of inRange) results.set(call.id, evaluateRadarCall(call, pricesByToken.get(call.tokenId) ?? [], options.now, costPct));

  const overall = buildBucket('all', 'All calls', inRange, results);
  const buckets = (key: (c: RadarCall) => string, order?: readonly string[]) =>
    [...group(inRange, key).entries()]
      .map(([k, rows]) => buildBucket(k, k, rows, results))
      .sort((a, b) => (order ? bandOrder(a.key, b.key, order) : b.independent - a.independent || a.key.localeCompare(b.key)));

  const dayMap = new Map<string, { calls: number; tokens: Set<string> }>();
  for (const call of inRange) {
    const day = call.alertedAt.toISOString().slice(0, 10);
    const row = dayMap.get(day) ?? { calls: 0, tokens: new Set<string>() };
    row.calls++;
    row.tokens.add(call.tokenId);
    dayMap.set(day, row);
  }
  const daily = [...dayMap.entries()]
    .map(([day, row]) => ({ day, calls: row.calls, tokens: row.tokens.size }))
    .sort((a, b) => a.day.localeCompare(b.day));

  const sorted = [...inRange].sort((a, b) => +a.alertedAt - +b.alertedAt || a.id.localeCompare(b.id));
  return {
    from: options.from,
    to: options.to,
    now: options.now,
    costPct,
    newestCallAt: sorted.length ? sorted[sorted.length - 1]!.alertedAt : null,
    oldestCallAt: sorted.length ? sorted[0]!.alertedAt : null,
    calls: inRange.length,
    independentCalls: overall.independent,
    overlapExcluded: overall.overlapExcluded,
    distinctTokens: overall.distinctTokens,
    entryUnknown: overall.entryUnknown,
    daily,
    overall,
    byProfile: buckets((c) => c.profile),
    byTier: buckets((c) => c.tier, ['WATCH', 'IMPORTANT', 'STRONG', 'CRITICAL']),
    byScore: buckets((c) => scoreBand(c.score), ['under 55', '55 to 59', '60 to 69', '70 to 79', '80 and above', 'unknown']),
    byEntryMarketCap: buckets((c) => entryCapBand(c.entryMarketCapUsd), ['under $20k', '$20k to $50k', '$50k to $100k', '$100k and above', 'unknown']),
    notes: [
      'Medians are shown first. One +1,000% call moves a mean; medians describe the typical call.',
      'Returns use stored 5-minute closes. There is no intra-bar high or low in storage, so take-profit fills are capped at the target and stops fill at the first close beyond the stop.',
      'UNKNOWN is not random: a token that stops trading often has no horizon price. The unknown rate is shown next to every sample.',
      'A bucket needs at least 30 independent events across 15 tokens before any number is treated as a result. Below that it is marked INSUFFICIENT.',
      'This is in-sample research on a small cohort. It is not a forecast, not financial advice, and it changes no trading limit.',
    ],
  };
}

const f = (n: number | null, digits = 1) => (n == null || !Number.isFinite(n) ? 'n/a' : `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`);
const i = (n: number | null) => (n == null || !Number.isFinite(n) ? 'n/a' : Math.round(n).toLocaleString('en-US'));
const secs = (n: number | null) => {
  if (n == null || !Number.isFinite(n)) return 'n/a';
  if (n < 60) return `${Math.round(n)}s`;
  if (n < 3600) return `${Math.round(n / 60)}m`;
  return `${(n / 3600).toFixed(1)}h`;
};
const evidence = (d: Described) => (d.sufficient ? 'ok' : 'INSUFFICIENT');
const pctOrDash = (n: number | null) => (n == null ? 'n/a' : f(n * 100));

function bucketTable(buckets: RadarBucket[]): string {
  const lines = [
    '| Group | Calls | 24h indep. | Tokens | 1h median | 4h median | 24h median | 4h peak median | 4h hold net | TP +50% net |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const b of buckets) {
    const h1 = b.horizons.find((x) => x.hours === 1)!;
    const h4 = b.horizons.find((x) => x.hours === 4)!;
    const h24 = b.horizons.find((x) => x.hours === 24)!;
    const p4 = b.peaks.find((x) => x.windowHours === 4)!;
    const hold = b.exits.find((x) => x.id === 'hold-4h')!;
    const tp = b.exits.find((x) => x.id === 'tp50')!;
    lines.push(
      `| ${b.label} | ${b.calls} | ${b.independent} | ${b.distinctTokens} | ${f(h1.returns.median)} | ${f(h4.returns.median)} | ${f(h24.returns.median)} | ${f(p4.medianPeakGainPct)} | ${f(hold.net.median)} | ${f(tp.net.median)} |`,
    );
  }
  return lines.join('\n');
}

function horizonTable(b: RadarBucket): string {
  const lines = [
    '| Horizon | Independent | Known | Tokens | Median | p10 | p90 | Mean | Win rate | Unknown | Pending | Evidence |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|',
  ];
  for (const h of b.horizons) {
    lines.push(
      `| ${h.label} | ${h.independent} | ${h.known} | ${h.tokens} | ${f(h.returns.median)} | ${f(h.returns.p10)} | ${f(h.returns.p90)} | ${f(h.returns.mean)} | ${pctOrDash(h.returns.winRate)} | ${h.unknownRate == null ? 'n/a' : pctOrDash(h.unknownRate)} | ${h.pending} | ${evidence(h.returns)} |`,
    );
  }
  return lines.join('\n');
}

function peakTable(b: RadarBucket): string {
  const lines = [
    '| Window | Independent | n | Median peak | Median close | Median give-back | Median time to peak | Peaks above 0 | Evidence |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---|',
  ];
  for (const p of b.peaks) {
    lines.push(
      `| ${p.label} | ${p.independent} | ${p.known} | ${f(p.medianPeakGainPct)} | ${f(p.medianEndReturnPct)} | ${f(p.medianGiveBackPct)} | ${secs(p.medianTimeToPeakSeconds)} | ${p.positivePeaks}/${p.known} | ${evidence(p.peaks)} |`,
    );
  }
  return lines.join('\n');
}

function exitTable(b: RadarBucket): string {
  const lines = [
    '| Rule | Independent | n | Median net | Mean net | Win rate | Median hold net (baseline) | Median benefit when changed | Beat hold | Exit reasons | Evidence |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|',
  ];
  for (const e of b.exits) {
    const reasons = Object.entries(e.exitReasons)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ');
    lines.push(
      `| ${e.label} | ${e.independent} | ${e.known} | ${f(e.net.median)} | ${f(e.net.mean)} | ${pctOrDash(e.net.winRate)} | ${f(e.medianHoldNetPct)} | ${f(e.medianBenefitWhenDifferent)} | ${pctOrDash(e.beatHoldRate)} | ${reasons || 'n/a'} | ${evidence(e.net)} |`,
    );
  }
  return lines.join('\n');
}

export function renderRadarScorecard(s: RadarScorecard): string {
  const lines: string[] = [
    '# Early Radar scorecard',
    '',
    `Generated ${s.now.toISOString()}. Calls from ${s.from.toISOString()} to ${s.to.toISOString()} (frozen entry snapshots).`,
    '',
    '## Read this first',
    '',
    '- This measures the calls already made. It does not claim the next call will repeat.',
    '- Medians are the headline; means are printed but are outlier-sensitive. A single +1,000% call can carry a mean.',
    '- Take-profit fills are capped at the target. Stops fill at the first stored close beyond the stop, so gap losses are kept. Only 5-minute closes exist; there is no intra-bar high or low.',
    '- Time exits use the last stored close in the window. When a token stopped trading before the horizon, that close can be stale; the horizon Unknown column is the cleaner measure of missing data.',
    '- UNKNOWN is not zero and is not random. Tokens that rug or stop trading often have no horizon price.',
    '- Below 30 independent events across 15 tokens, a row is descriptive only and is marked INSUFFICIENT.',
    '',
    '## Coverage',
    '',
    `- Calls: **${s.calls}** (${s.independentCalls} independent after the 24h overlap rule; ${s.overlapExcluded} overlapping calls excluded)`,
    '- Each horizon and exit rule uses its own overlap window. A 15m row is not deduplicated against a call two hours later; a 24h row is.',
    `- Distinct tokens: **${s.distinctTokens}**`,
    `- Calls with no frozen entry price: **${s.entryUnknown}** (excluded from returns, counted as unknown)`,
    `- Newest call: ${s.newestCallAt?.toISOString() ?? 'n/a'}`,
    `- Oldest call: ${s.oldestCallAt?.toISOString() ?? 'n/a'}`,
    `- Round-trip cost subtracted: **${s.costPct}%** (a guess, not a calibrated fill)`,
    '',
  ];

  if (s.daily.length) {
    lines.push('| Day (UTC) | Calls | Tokens |', '|---|---:|---:|');
    for (const d of s.daily) lines.push(`| ${d.day} | ${d.calls} | ${d.tokens} |`);
    lines.push('');
  }

  lines.push(
    '## Returns by horizon (all calls)',
    '',
    horizonTable(s.overall),
    '',
    'A positive mean with a flat median means a few calls paid and the typical call did not. Read the median first.',
    '',
    '## Peak capture (all calls)',
    '',
    peakTable(s.overall),
    '',
    'Peak is the highest stored close after the alert. Give-back is the fall from that peak to the window close. If the peak is large and the close is negative, the edge is in the exit, not the hold.',
    '',
    '## Exit replay (all calls)',
    '',
    exitTable(s.overall),
    '',
    'The reference rules are fixed, repeatable starting values, not a recommendation. "Median benefit when changed" covers only calls where the rule exited before the window ended; n/a means the rule never changed an exit. "Beat hold" is the share of all calls where it did better after cost.',
    '',
    '## By profile',
    '',
    bucketTable(s.byProfile),
    '',
    '## By tier',
    '',
    bucketTable(s.byTier),
    '',
    '## By score band',
    '',
    bucketTable(s.byScore),
    '',
    'If a higher score does not produce a better median, the score is an attention score, not an expected-return score.',
    '',
    '## By entry market cap',
    '',
    bucketTable(s.byEntryMarketCap),
    '',
    '## What this does not prove',
    '',
    '- It does not prove the calls are tradable at scale, or that the entry price was available to a real buyer.',
    '- It does not prove the exit rules work on other market regimes or on tokens the system did not track.',
    '- It does not cover 7-day or longer outcomes, which the separate tracker measures.',
    '- It does not include fees, priority fees or MEV beyond the flat round-trip cost.',
    '- It is in-sample. No parameter was held out.',
    '',
    '## Notes',
    '',
    ...s.notes.map((n) => `- ${n}`),
    '',
  );
  return lines.join('\n');
}
