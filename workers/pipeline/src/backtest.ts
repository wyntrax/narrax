import type { Prisma, PrismaClient } from '@narra/database';
import {
  DEFAULT_ROUND_TRIP_COST_PCT, GATES, LIVE_RULES_LABEL, OUTCOME_CONFIG, REFERENCE_EXIT_LABEL, atOrBefore, calibrateByBucket, calibrateBySignal, compareToBaseline, dedupeEvents, evaluateStrategy,
  exitLevelCandidates, measureOutcome, medianGapMs, monitorRuleCandidates, sortSeries, summarizeFindings, sweepRules, type BacktestReport, type Item, type Point, type StrategyEvent,
} from '@narra/analytics';
import { AgentDecisionSchema } from '@narra/shared';
import { ExitRulesSchema } from '@narra/positions';

const num = (d: { toString(): string }) => Number(d.toString());
/** Refuse rather than run out of memory: all stored readings for the range are held at once. */
const MAX_METRIC_ROWS = 1_500_000;
const HOUR = 3_600_000;

export interface BacktestConfig {
  from: Date;
  to: Date;
  now?: Date;
  costPct?: number;
  /** Opportunity score that counts as a signal for the "opportunity score" strategy. Unvalidated. */
  opportunityMin?: number;
  /** Narrative component score that counts as a signal for the "narrative only" strategy. Unvalidated. */
  narrativeMin?: number;
  /** Consensus score that counts as a signal for the "smart money only" strategy. Unvalidated. */
  consensusMin?: number;
  /** A rise of this much over the previous hour counts as a momentum signal. Unvalidated. */
  momentumPct?: number;
  /** The sweeps replay every candidate on every event, so they use at most this many of the most recent events. */
  maxSweepEvents?: number;
}

export const STRATEGIES = ['AI', 'OPPORTUNITY_SCORE', 'NARRATIVE_ONLY', 'SMART_MONEY_ONLY', 'MOMENTUM', 'BASELINE'] as const;

/**
 * Replays the monitor and the opportunity signals over stored history, writes nothing except through saveBacktestRun,
 * and reports honestly: each group's sample size, an interval, and "INSUFFICIENT DATA" below the gates.
 * Every strategy is judged the same way: price 24 hours after the signal, net of a flat cost, with and without the live exit rules.
 */
export async function runBacktest(db: PrismaClient, cfg: BacktestConfig): Promise<BacktestReport> {
  const now = cfg.now ?? new Date(), cost = cfg.costPct ?? DEFAULT_ROUND_TRIP_COST_PCT;
  const oppMin = cfg.opportunityMin ?? 70, narrMin = cfg.narrativeMin ?? 70, consMin = cfg.consensusMin ?? 60, momPct = cfg.momentumPct ?? 20;
  const pad = OUTCOME_CONFIG.longHorizonMs + OUTCOME_CONFIG.horizonToleranceMs;
  const readFrom = new Date(cfg.from.getTime() - HOUR - OUTCOME_CONFIG.entryToleranceMs), readTo = new Date(Math.min(now.getTime(), cfg.to.getTime() + pad));

  const perToken = await db.tokenMetric.groupBy({ by: ['tokenId'], where: { at: { gte: readFrom, lte: readTo } }, _count: { _all: true } });
  const totalRows = perToken.reduce((a, t) => a + t._count._all, 0);
  if (totalRows > MAX_METRIC_ROWS) throw new Error(`${totalRows} stored readings is more than one run can hold (${MAX_METRIC_ROWS}). Narrow the date range.`);

  const series = new Map<string, Point[]>();
  for (const t of perToken) {
    const rows = await db.tokenMetric.findMany({ where: { tokenId: t.tokenId, at: { gte: readFrom, lte: readTo } }, orderBy: { at: 'asc' }, select: { at: true, priceUsd: true, liquidityUsd: true, volume24hUsd: true } });
    series.set(t.tokenId, sortSeries(rows.map((r) => ({ at: r.at, priceUsd: num(r.priceUsd), liquidityUsd: num(r.liquidityUsd), volume24hUsd: num(r.volume24hUsd) }))));
  }

  /** An event at time `at` on a token, priced from the latest reading at or before it. No reading, no event. */
  const mkEvent = (tokenId: string, at: Date, extra: Partial<StrategyEvent> = {}): StrategyEvent | null => {
    const s = series.get(tokenId);
    const p = s ? atOrBefore(s, at.getTime(), OUTCOME_CONFIG.entryToleranceMs) : null;
    return s && p ? { tokenId, at, priceUsd: p.priceUsd, liquidityUsd: p.liquidityUsd, volume24hUsd: p.volume24hUsd, series: s, ...extra } : null;
  };
  const keep = (xs: (StrategyEvent | null)[]) => xs.filter((x): x is StrategyEvent => x != null);
  const inRange = { gte: cfg.from, lte: cfg.to };

  const decisions = await db.agentDecision.findMany({ where: { userId: null, createdAt: inRange }, orderBy: { createdAt: 'asc' }, include: { analysis: { include: { opportunity: { select: { tokenId: true } } } } } });
  const buys = decisions.filter((d) => d.action === 'BUY');
  const ai = keep(buys.map((d) => {
    const p = AgentDecisionSchema.safeParse(d.payload), ex = ExitRulesSchema.safeParse(p.success ? p.data.exit : null);
    return mkEvent(d.analysis.opportunity.tokenId, d.createdAt, { confidence: d.confidence, codes: p.success ? p.data.reasonCodes : [], ownExit: ex.success ? ex.data : null });
  }));

  const opps = await db.opportunity.findMany({ where: { createdAt: inRange }, select: { tokenId: true, score: true, narrativeScore: true, createdAt: true }, orderBy: { createdAt: 'asc' } });
  const oppEvents = keep(opps.filter((o) => o.score >= oppMin).map((o) => mkEvent(o.tokenId, o.createdAt)));
  const narrEvents = keep(opps.filter((o) => o.narrativeScore >= narrMin).map((o) => mkEvent(o.tokenId, o.createdAt)));
  const cons = await db.consensusSignal.findMany({ where: { at: inRange, score: { gte: consMin } }, select: { tokenId: true, at: true }, orderBy: { at: 'asc' } });
  const smartEvents = keep(cons.map((c) => mkEvent(c.tokenId, c.at)));

  const momentum: StrategyEvent[] = [], baseline: StrategyEvent[] = [];
  for (const [tokenId, s] of series) {
    let lastBaseline = -Infinity;
    for (const p of s) {
      if (p.at < cfg.from || p.at > cfg.to) continue;
      const ago = atOrBefore(s, p.at.getTime() - HOUR, OUTCOME_CONFIG.entryToleranceMs);
      if (ago && (p.priceUsd / ago.priceUsd - 1) * 100 >= momPct) momentum.push({ tokenId, at: p.at, priceUsd: p.priceUsd, liquidityUsd: p.liquidityUsd, volume24hUsd: p.volume24hUsd, series: s });
      if (p.at.getTime() - lastBaseline >= GATES.dedupeWindowMs) { baseline.push({ tokenId, at: p.at, priceUsd: p.priceUsd, liquidityUsd: p.liquidityUsd, volume24hUsd: p.volume24hUsd, series: s }); lastBaseline = p.at.getTime(); }
    }
  }

  const groups: Record<(typeof STRATEGIES)[number], StrategyEvent[]> = { AI: ai, OPPORTUNITY_SCORE: oppEvents, NARRATIVE_ONLY: narrEvents, SMART_MONEY_ONLY: smartEvents, MOMENTUM: momentum, BASELINE: baseline };
  const strategies = STRATEGIES.map((name) => evaluateStrategy(name, groups[name], now, { costPct: cost }));
  const comparisons = compareToBaseline(strategies, 'BASELINE');

  /** 24h net return of each event whose outcome is final and known. */
  const returns = <T extends StrategyEvent>(events: T[]) => dedupeEvents(events).flatMap((e) => {
    const o = measureOutcome({ decidedAt: e.at, series: e.series, now });
    return o.status === 'FINAL' && o.return24hPct != null ? [{ e, ret: o.return24hPct - cost }] : [];
  });
  const aiRows = returns(ai);
  const aiByConfidence = calibrateByBucket(aiRows.map((r): Item & { key: number } => ({ tokenId: r.e.tokenId, ret: r.ret, key: r.e.confidence ?? 0 })), [0.6, 0.7, 0.8, 0.9, 1]);
  const aiBySignal = calibrateBySignal(aiRows.map((r) => ({ tokenId: r.e.tokenId, ret: r.ret, codes: r.e.codes ?? [] })));
  const oppAll = keep(opps.map((o) => mkEvent(o.tokenId, o.createdAt, { confidence: o.score })));
  const oppByScore = calibrateByBucket(returns(oppAll).map((r) => ({ tokenId: r.e.tokenId, ret: r.ret, key: r.e.confidence ?? 0 })), [0, 40, 55, 70, 85, 100]);

  // The sweeps pool every kind of entry: how an exit rule behaves does not depend on what picked the entry, and one source alone is too small.
  const pooled = dedupeEvents([...ai, ...oppEvents, ...smartEvents, ...momentum, ...baseline]).slice(-(cfg.maxSweepEvents ?? 600));
  const enough = pooled.length >= 10;
  const sweeps = {
    exitLevels: enough ? sweepRules(pooled, exitLevelCandidates(), REFERENCE_EXIT_LABEL) : null,
    monitorRules: enough ? sweepRules(pooled, monitorRuleCandidates(), LIVE_RULES_LABEL) : null,
  };

  const gaps = [...series.values()].map((s) => medianGapMs(s)).filter((g): g is number => g != null).sort((a, b) => a - b);
  let first: Date | null = null, last: Date | null = null;
  for (const s of series.values()) if (s.length) { if (!first || s[0]!.at < first) first = s[0]!.at; const e = s[s.length - 1]!.at; if (!last || e > last) last = e; }
  const { findings, noConclusion } = summarizeFindings(strategies, comparisons, sweeps);
  return {
    generatedAt: now.toISOString(),
    coverage: {
      from: cfg.from.toISOString(), to: cfg.to.toISOString(), tokens: series.size, metricPoints: totalRows, firstPointAt: first?.toISOString() ?? null, lastPointAt: last?.toISOString() ?? null,
      medianGapMinutes: gaps.length ? gaps[gaps.length >> 1]! / 60_000 : null, decisions: decisions.length, buyDecisions: buys.length,
    },
    costPct: cost, strategies, comparisons, aiByConfidence, aiBySignal, oppByScore, sweeps, findings, noConclusion,
  };
}

/** Keeps a run for later comparison, with the settings it used. */
export async function saveBacktestRun(db: PrismaClient, report: BacktestReport, cfg: BacktestConfig): Promise<string> {
  const row = await db.backtestRun.create({
    data: {
      kind: 'FULL',
      params: { from: cfg.from.toISOString(), to: cfg.to.toISOString(), costPct: report.costPct, opportunityMin: cfg.opportunityMin ?? 70, narrativeMin: cfg.narrativeMin ?? 70, consensusMin: cfg.consensusMin ?? 60, momentumPct: cfg.momentumPct ?? 20, gates: GATES } as unknown as Prisma.InputJsonValue,
      report: JSON.parse(JSON.stringify(report)) as Prisma.InputJsonValue,
    },
  });
  return row.id;
}
