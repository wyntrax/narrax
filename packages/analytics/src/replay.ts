import { MONITOR_RULES, evaluatePosition, type EntryContext, type ExitRules, type MonitorRules } from '@narra/positions';
import { exitSizePct, shouldActOnEvaluation } from '@narra/trading';
import { OUTCOME_CONFIG } from './outcome';
import { atOrAfter, atOrBefore, indexAfter, type Point } from './series';

/**
 * Round-trip cost taken off every replayed return, in percent: two swaps' fees, price impact and slippage.
 * A guess. Paper trading has real fills to calibrate it against once there are enough of them.
 */
export const DEFAULT_ROUND_TRIP_COST_PCT = 3;

export interface RuleOverrides {
  liquidity?: Partial<{ reduceDropPct: number; sellDropPct: number; sellFloorUsd: number }>;
  momentumWarnDropPct1h?: number;
  volumeWarnBelowPctOfEntry?: number;
  warningsToReduce?: number;
  reduceFractionPct?: number;
}

/** The live monitor rules with some numbers replaced. The shape is unchanged, so evaluatePosition runs as it does in production. */
export function withRules(o: RuleOverrides = {}): MonitorRules {
  return {
    ...MONITOR_RULES, ...(o.momentumWarnDropPct1h != null ? { momentumWarnDropPct1h: o.momentumWarnDropPct1h } : {}),
    ...(o.volumeWarnBelowPctOfEntry != null ? { volumeWarnBelowPctOfEntry: o.volumeWarnBelowPctOfEntry } : {}),
    ...(o.warningsToReduce != null ? { warningsToReduce: o.warningsToReduce } : {}),
    ...(o.reduceFractionPct != null ? { reduceFractionPct: o.reduceFractionPct } : {}),
    liquidity: { ...MONITOR_RULES.liquidity, ...o.liquidity },
  } as unknown as MonitorRules;
}

export interface ReplayEvent {
  tokenId: string;
  at: Date;
  /** Market reading at the event. The entry price. */
  priceUsd: number;
  liquidityUsd: number;
  volume24hUsd: number;
  /** The token's whole sorted series. A replay at time t reads only points at or before t. */
  series: Point[];
}

export interface ReplayExit { at: Date; shareOfPosition: number; priceUsd: number; codes: string[]; action: 'SELL' | 'REDUCE' }

export interface ReplayResult {
  exits: ReplayExit[];
  closedBy: 'RULE' | 'MAX_HOLD' | 'DATA_END';
  grossReturnPct: number;
  netReturnPct: number;
  /** Buying and holding to the same end point, after the same cost. */
  holdNetReturnPct: number;
  /** Net return of the rules minus net return of holding. Positive means the exit rules helped. */
  exitBenefitPct: number;
  triggers: string[];
}

export interface ReplayOptions {
  rules?: MonitorRules;
  exit: ExitRules;
  maxHoldMs?: number;
  costPct?: number;
}

/**
 * Replays the live exit rules, unchanged, over stored history after one entry. At each stored reading it builds the facts
 * the monitor would have had then, runs evaluatePosition, and lets the same partial-exit rule as the fan-out decide whether
 * to act. A signal is acted on at the NEXT reading, which models the delay before a real fill and avoids looking ahead.
 *
 * Not replayable, because no point-in-time history is stored: narrative stage and score, smart-money exits, holder
 * concentration, honeypot flags, developer activity. Those rules stay unvalidated and the monitor lists them as unavailable.
 */
export function replayExit(ev: ReplayEvent, o: ReplayOptions): ReplayResult | null {
  const tol = OUTCOME_CONFIG.entryToleranceMs, hold = o.maxHoldMs ?? OUTCOME_CONFIG.longHorizonMs, cost = o.costPct ?? DEFAULT_ROUND_TRIP_COST_PCT;
  const t0 = ev.at.getTime(), p0 = ev.priceUsd;
  if (!(p0 > 0)) return null;
  const entry: EntryContext = {
    version: 1, capturedAt: ev.at.toISOString(), priceUsd: p0, liquidityUsd: ev.liquidityUsd, volume24hUsd: ev.volume24hUsd,
    holders: null, top10Pct: null, narrative: null, smartMoney: null, exit: o.exit,
  };
  const start = indexAfter(ev.series, t0);
  const window: Point[] = [];
  for (let i = start; i < ev.series.length && ev.series[i]!.at.getTime() <= t0 + hold; i++) window.push(ev.series[i]!);
  if (!window.length) return null;

  let remaining = 1, high = p0, reduceCount = 0;
  let reducedFor: string[] = [];
  const exits: ReplayExit[] = [], triggers = new Set<string>();
  for (let i = 0; i < window.length && remaining > 1e-9; i++) {
    const p = window[i]!;
    high = Math.max(high, p.priceUsd);
    const ago = atOrBefore(ev.series, p.at.getTime() - 3_600_000, tol);
    const e = evaluatePosition({
      now: p.at, entryPriceUsd: p0, entry, market: { at: p.at, priceUsd: p.priceUsd, liquidityUsd: p.liquidityUsd, volume24hUsd: p.volume24hUsd, price1hAgoUsd: ago?.priceUsd ?? null },
      highWaterUsd: high, holders: null, riskFlags: null, narrative: null, smartMoneyExits: null,
    }, o.rules ?? MONITOR_RULES);
    const act = shouldActOnEvaluation({ action: e.action, fractionPct: e.fractionPct, signals: e.signals, createdAt: p.at }, { reducedForCodes: reducedFor, reduceCount }, p.at);
    if (!act.act) continue;
    act.codes.forEach((c) => triggers.add(c));
    const sell = e.action === 'SELL', share = sell ? remaining : (remaining * exitSizePct(e)) / 100;
    const fill = window[i + 1] ?? p; // the next reading, or this one if the data ends
    exits.push({ at: fill.at, shareOfPosition: share, priceUsd: fill.priceUsd, codes: act.codes, action: sell ? 'SELL' : 'REDUCE' });
    remaining -= share;
    if (!sell) { reducedFor = [...new Set([...reducedFor, ...act.codes])]; reduceCount++; }
  }

  const last = atOrBefore(ev.series, t0 + hold, OUTCOME_CONFIG.horizonToleranceMs) ?? window[window.length - 1]!;
  const reachedEnd = !!atOrAfter(ev.series, t0 + hold - OUTCOME_CONFIG.horizonToleranceMs, OUTCOME_CONFIG.horizonToleranceMs) && last.at.getTime() >= t0 + hold - OUTCOME_CONFIG.horizonToleranceMs;
  let gross = 0;
  for (const x of exits) gross += x.shareOfPosition * ((x.priceUsd / p0 - 1) * 100);
  if (remaining > 1e-9) gross += remaining * ((last.priceUsd / p0 - 1) * 100);
  const holdNet = (last.priceUsd / p0 - 1) * 100 - cost, net = gross - cost;
  return { exits, closedBy: remaining <= 1e-9 ? 'RULE' : reachedEnd ? 'MAX_HOLD' : 'DATA_END', grossReturnPct: gross, netReturnPct: net, holdNetReturnPct: holdNet, exitBenefitPct: net - holdNet, triggers: [...triggers] };
}
