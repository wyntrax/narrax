import { MONITOR_RULES, type MonitorRules } from './rules';
import type { EntryContext, NarrativeStageName } from './entryContext';

export type ExitAction = 'HOLD' | 'REDUCE' | 'SELL';
export type SignalLevel = 'WARN' | 'REDUCE' | 'SELL';

export interface Signal {
  code: string;
  level: SignalLevel;
  /** A plain sentence built from our own numbers. Never contains outside text. */
  detail: string;
}

export interface PositionFacts {
  now: Date;
  entryPriceUsd: number;
  /** Null for rows with no usable baseline. Rules that need a baseline are then reported unavailable. */
  entry: EntryContext | null;
  /** Latest market row, or null when there is none. */
  market: { at: Date; priceUsd: number; liquidityUsd: number; volume24hUsd: number; price1hAgoUsd: number | null } | null;
  /** Highest price seen since the position opened, or null when history is missing. */
  highWaterUsd: number | null;
  holders: { top10Pct: number } | null;
  riskFlags: string[] | null;
  narrative: { stage: NarrativeStageName; score: number; velocity: number } | null;
  /** Tracked wallets that bought this token and have since sold. Null when it could not be computed. */
  smartMoneyExits: { entities: number; leaders: number } | null;
}

export interface Evaluation {
  action: ExitAction;
  /** Share of the position to sell: 0 for HOLD, rules.reduceFractionPct for REDUCE, 100 for SELL. */
  fractionPct: number;
  signals: Signal[];
  /** Checks that could not run, with the reason. Always shown, so a quiet monitor is never mistaken for a clean one. */
  unavailable: string[];
  /** True when there was no fresh price, so price rules did not run. */
  blind: boolean;
  pnlPct: number | null;
  highWaterUsd: number | null;
  summary: string;
}

const RANK: Record<SignalLevel, number> = { WARN: 0, REDUCE: 1, SELL: 2 };
const f1 = (x: number) => (Math.round(x * 10) / 10).toFixed(1);

/**
 * Deterministic exit rules. The strongest signal sets the action, and enough warnings together become a REDUCE.
 * Missing data skips a rule and is listed under `unavailable`; it never counts as a pass or a fail.
 * Price rules (stop loss, take profit, trailing stop, liquidity, volume, momentum) need a price no older than
 * rules.maxDataAgeMs. Without one the position is blind and a DATA_STALE warning is raised.
 */
export function evaluatePosition(facts: PositionFacts, rules: MonitorRules = MONITOR_RULES): Evaluation {
  const signals: Signal[] = [];
  const unavailable: string[] = ['DEV_ACTIVITY: developer wallet data is not collected'];
  const add = (code: string, level: SignalLevel, detail: string) => signals.push({ code, level, detail });
  const { entry } = facts;

  const fresh = facts.market != null && facts.now.getTime() - facts.market.at.getTime() <= rules.maxDataAgeMs;
  const m = fresh ? facts.market! : null;
  let pnlPct: number | null = null;
  let highWater = facts.highWaterUsd;

  if (!m) {
    add('DATA_STALE', 'WARN', facts.market ? `Latest price is ${Math.round((facts.now.getTime() - facts.market.at.getTime()) / 60_000)} minutes old, so price rules did not run.` : 'No price data, so price rules did not run.');
    unavailable.push('PRICE_RULES: no fresh price');
  } else {
    pnlPct = facts.entryPriceUsd > 0 ? (m.priceUsd / facts.entryPriceUsd - 1) * 100 : null;
    highWater = Math.max(facts.entryPriceUsd, highWater ?? 0, m.priceUsd);
    const exit = entry?.exit;
    if (!exit) unavailable.push('EXIT_RULES: no stored stop, target or trailing stop');
    if (exit && pnlPct != null) {
      if (exit.stopLossPct != null && pnlPct <= -exit.stopLossPct) add('STOP_LOSS', 'SELL', `Down ${f1(-pnlPct)}% from entry, past the ${f1(exit.stopLossPct)}% stop.`);
      if (exit.takeProfitPct != null && pnlPct >= exit.takeProfitPct) add('TAKE_PROFIT', 'REDUCE', `Up ${f1(pnlPct)}% from entry, past the ${f1(exit.takeProfitPct)}% target.`);
      if (exit.trailingStopPct != null) {
        const drawdown = (1 - m.priceUsd / highWater) * 100;
        if (drawdown >= exit.trailingStopPct) add('TRAILING_STOP', 'SELL', `Down ${f1(drawdown)}% from its high since entry, past the ${f1(exit.trailingStopPct)}% trailing stop.`);
      }
    }
    if (entry) {
      const liqDrop = entry.liquidityUsd > 0 ? (1 - m.liquidityUsd / entry.liquidityUsd) * 100 : null;
      if (m.liquidityUsd < rules.liquidity.sellFloorUsd) add('LIQUIDITY_FLOOR', 'SELL', `Liquidity is ${Math.round(m.liquidityUsd)} USD, below the ${rules.liquidity.sellFloorUsd} USD floor where exits may fail.`);
      else if (liqDrop != null && liqDrop >= rules.liquidity.sellDropPct) add('LIQUIDITY_COLLAPSE', 'SELL', `Liquidity is down ${f1(liqDrop)}% from entry.`);
      else if (liqDrop != null && liqDrop >= rules.liquidity.reduceDropPct) add('LIQUIDITY_DROP', 'REDUCE', `Liquidity is down ${f1(liqDrop)}% from entry.`);
      if (entry.volume24hUsd > 0 && m.volume24hUsd / entry.volume24hUsd * 100 < rules.volumeWarnBelowPctOfEntry) add('VOLUME_COLLAPSE', 'WARN', `24h volume is ${f1(m.volume24hUsd / entry.volume24hUsd * 100)}% of its level at entry.`);
    } else unavailable.push('ENTRY_COMPARISONS: no stored entry baseline');
    if (m.price1hAgoUsd != null && m.price1hAgoUsd > 0) {
      const chg = (m.priceUsd / m.price1hAgoUsd - 1) * 100;
      if (chg <= -rules.momentumWarnDropPct1h) add('MOMENTUM_LOSS', 'WARN', `Down ${f1(-chg)}% over the last hour.`);
    } else unavailable.push('MOMENTUM: no price from an hour ago');
  }

  if (facts.riskFlags?.includes('HONEYPOT')) add('HONEYPOT_FLAGGED', 'SELL', 'Flagged as a honeypot. An exit may not be possible.');
  if (facts.riskFlags == null) unavailable.push('TOKEN_RISK: no risk record');

  if (facts.holders && entry?.top10Pct != null && facts.holders.top10Pct - entry.top10Pct >= rules.concentrationWarnRisePts) {
    add('CONCENTRATION_RISE', 'WARN', `Top-10 holders went from ${f1(entry.top10Pct)}% to ${f1(facts.holders.top10Pct)}% of supply.`);
  } else if (!facts.holders || entry?.top10Pct == null) unavailable.push('CONCENTRATION: holder data missing for entry or now');

  if (facts.narrative && entry?.narrative) {
    const n = facts.narrative, e = entry.narrative;
    if (n.stage === 'DEAD') add('NARRATIVE_DEAD', 'SELL', 'The narrative this position was opened on is now dead.');
    else if (n.stage === 'DECAYING') add('NARRATIVE_DECAYING', 'REDUCE', 'The narrative this position was opened on is decaying.');
    else if (n.stage === 'SATURATED' && e.stage !== 'SATURATED') add('NARRATIVE_SATURATED', 'WARN', 'The narrative is now saturated.');
    if (e.score - n.score >= rules.narrative.reduceScoreDropPts) add('NARRATIVE_SCORE_DROP', 'REDUCE', `Narrative score fell from ${f1(e.score)} to ${f1(n.score)}.`);
    if (e.velocity > 0 && (1 - n.velocity / e.velocity) * 100 >= rules.narrative.warnVelocityDropPct) add('NARRATIVE_SLOWING', 'WARN', 'Narrative velocity has fallen sharply since entry.');
  } else if (entry?.narrative) unavailable.push('NARRATIVE: no current narrative reading');

  if (facts.smartMoneyExits) {
    const { entities, leaders } = facts.smartMoneyExits;
    if (entities >= rules.smartMoney.sellEntities) add('SMART_MONEY_EXIT', 'SELL', `${entities} independent tracked wallets have sold.`);
    else if (entities >= rules.smartMoney.reduceEntities || leaders >= 1) add('SMART_MONEY_EXIT', 'REDUCE', `${entities} independent tracked wallets (${leaders} leaders) have sold.`);
  } else unavailable.push('SMART_MONEY_EXITS: could not be computed');

  const warnings = signals.filter((s) => s.level === 'WARN' && s.code !== 'DATA_STALE').length;
  if (warnings >= rules.warningsToReduce) add('MULTIPLE_WARNINGS', 'REDUCE', `${warnings} warning signals are active at once.`);

  const top = signals.reduce<SignalLevel | null>((acc, s) => (acc == null || RANK[s.level] > RANK[acc] ? s.level : acc), null);
  const action: ExitAction = top === 'SELL' ? 'SELL' : top === 'REDUCE' ? 'REDUCE' : 'HOLD';
  const fractionPct = action === 'SELL' ? 100 : action === 'REDUCE' ? rules.reduceFractionPct : 0;
  const lead = signals.filter((s) => s.level === top).map((s) => s.code).join(', ');
  const summary = action === 'HOLD' ? (signals.length ? `HOLD with warnings: ${signals.map((s) => s.code).join(', ')}.` : 'HOLD: no exit signal.') : `${action}: ${lead}.`;
  return { action, fractionPct, signals, unavailable, blind: !m, pnlPct, highWaterUsd: highWater, summary };
}
