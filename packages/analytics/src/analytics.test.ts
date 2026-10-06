import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROUND_TRIP_COST_PCT, GATES, REFERENCE_EXIT, REFERENCE_EXIT_LABEL, atOrAfter, atOrBefore, bootstrapMeanCI, calibrateByBucket, calibrateBySignal, compareMeans, dedupeEvents,
  describeReturns, evaluateStrategy, exitLevelCandidates, measureOutcome, medianGapMs, monitorRuleCandidates, LIVE_RULES_LABEL, renderMarkdown, replayExit, sortSeries, summarizeFindings,
  sweepRules, wilson, withRules, type Point, type ReplayEvent, type StrategyEvent,
} from './index';

const T0 = new Date('2026-09-01T00:00:00Z');
const MIN = 60_000;
const at = (m: number, base: Date = T0) => new Date(base.getTime() + m * MIN);
/** [minute, price] pairs to a series. Liquidity and volume stay flat unless given. */
const mk = (pairs: [number, number][], base: Date = T0, liq = 100_000, vol = 500_000): Point[] =>
  pairs.map(([m, p]) => ({ at: at(m, base), priceUsd: p, liquidityUsd: liq, volume24hUsd: vol }));
const ev = (series: Point[], tokenId = 't1', base: Date = T0): ReplayEvent => ({ tokenId, at: base, priceUsd: 100, liquidityUsd: 100_000, volume24hUsd: 500_000, series });
const DAY = 1440;

describe('series', () => {
  const s = mk([[0, 100], [10, 101], [20, 102]]);
  it('looks back and forward only within tolerance', () => {
    expect(atOrBefore(s, at(15).getTime(), 10 * MIN)?.priceUsd).toBe(101);
    expect(atOrBefore(s, at(15).getTime(), 4 * MIN)).toBeNull();
    expect(atOrBefore(s, at(-1).getTime(), 99 * MIN)).toBeNull(); // never reads a later point
    expect(atOrAfter(s, at(15).getTime(), 10 * MIN)?.priceUsd).toBe(102);
    expect(atOrAfter(s, at(21).getTime(), 99 * MIN)).toBeNull();
    expect(atOrAfter(s, at(10).getTime(), 0)?.priceUsd).toBe(101);
  });
  it('sorts and drops unusable rows without changing the input', () => {
    const raw: Point[] = [...mk([[20, 3], [0, 1]]), ...mk([[5, 0], [6, NaN], [7, -1]])];
    expect(sortSeries(raw).map((p) => p.priceUsd)).toEqual([1, 3]);
    expect(raw).toHaveLength(5);
    expect(medianGapMs(s)).toBe(10 * MIN);
    expect(medianGapMs(mk([[0, 1]]))).toBeNull();
  });
});

describe('stats', () => {
  it('Wilson interval matches the textbook value', () => {
    const [lo, hi] = wilson(5, 10)!;
    expect(lo).toBeCloseTo(0.2366, 3);
    expect(hi).toBeCloseTo(0.7634, 3);
    expect(wilson(0, 0)).toBeNull();
  });
  it('the bootstrap is deterministic and brackets the mean', () => {
    const v = Array.from({ length: 40 }, (_, i) => i);
    expect(bootstrapMeanCI(v)).toEqual(bootstrapMeanCI(v));
    const [lo, hi] = bootstrapMeanCI(v)!;
    expect(lo).toBeLessThan(19.5); expect(hi).toBeGreaterThan(19.5);
  });
  it('drops overlapping events on the same token only', () => {
    const e = (tokenId: string, m: number) => ({ tokenId, at: at(m) });
    const kept = dedupeEvents([e('a', 0), e('a', 60), e('b', 60), e('a', DAY), e('a', DAY + 5)]);
    expect(kept.map((k) => `${k.tokenId}${(k.at.getTime() - T0.getTime()) / MIN}`)).toEqual(['a0', 'b60', `a${DAY}`]);
  });
  it('gates: few events or few tokens means no verdict, however big the difference', () => {
    const items = (n: number, ret: number, tokens: number) => Array.from({ length: n }, (_, i) => ({ tokenId: `t${i % tokens}`, ret: ret + (i % 5) }));
    expect(compareMeans(items(10, 50, 10), items(10, 0, 10)).verdict).toBe('INSUFFICIENT_DATA');
    expect(compareMeans(items(60, 50, 3), items(60, 0, 3)).verdict).toBe('INSUFFICIENT_DATA'); // many events, three tokens
    expect(describeReturns(items(60, 50, 3)).note).toContain('3 distinct tokens');
    expect(compareMeans(items(60, 50, 30), items(60, 0, 30)).verdict).toBe('BETTER');
    expect(compareMeans(items(60, 0, 30), items(60, 50, 30)).verdict).toBe('WORSE');
    expect(compareMeans(items(60, 3, 30), items(60, 3, 30)).verdict).toBe('NO_CLEAR_DIFFERENCE');
  });
  it('describes returns with a win rate and its interval', () => {
    const d = describeReturns([{ tokenId: 'a', ret: 10 }, { tokenId: 'b', ret: -5 }, { tokenId: 'c', ret: 5 }, { tokenId: 'd', ret: -1 }]);
    expect(d).toMatchObject({ n: 4, distinctTokens: 4, mean: 2.25, winRate: 0.5, sufficient: false });
    expect(d.winRateCi![0]).toBeLessThan(0.5);
    expect(describeReturns([])).toMatchObject({ n: 0, mean: null, winRate: null, sufficient: false });
  });
});

describe('measureOutcome', () => {
  const series = mk([[0, 100], [30, 105], [60, 110], [300, 160], [DAY, 130], [DAY + 20, 131]]);
  const final = at(DAY + 31 + 1);
  it('measures returns, the best and worst price in the window, and the lead time to the high', () => {
    const o = measureOutcome({ decidedAt: T0, series, now: final });
    expect(o).toMatchObject({ status: 'FINAL', label: 'WIN', unknownReason: null, entryPriceUsd: 100 });
    expect(o.return1hPct).toBeCloseTo(10); expect(o.return24hPct).toBeCloseTo(30);
    expect(o.maxGainPct).toBeCloseTo(60); expect(o.maxDrawdownPct).toBeCloseTo(0);
    expect(o.leadTimeSeconds).toBe(300 * 60);
  });
  it('labels LOSS and FLAT on the 24h return', () => {
    expect(measureOutcome({ decidedAt: T0, series: mk([[0, 100], [DAY, 85]]), now: final })).toMatchObject({ label: 'LOSS', leadTimeSeconds: null });
    expect(measureOutcome({ decidedAt: T0, series: mk([[0, 100], [DAY, 105]]), now: final }).label).toBe('FLAT');
    expect(measureOutcome({ decidedAt: T0, series: mk([[0, 100], [DAY, 110]]), now: final }).label).toBe('WIN'); // exactly at the line
  });
  it('is pending, not labelled, until the 24h window and its tolerance have passed', () => {
    // Once the 24h price exists the outcome is final, even before the wait for a late reading would have run out.
    expect(measureOutcome({ decidedAt: T0, series, now: at(DAY + 10) })).toMatchObject({ status: 'FINAL', label: 'WIN' });
    const waiting = measureOutcome({ decidedAt: T0, series: mk([[0, 100], [60, 110]]), now: at(DAY + 10) });
    expect(waiting).toMatchObject({ status: 'PENDING', label: 'UNKNOWN', unknownReason: 'NOT_YET' });
    const early = measureOutcome({ decidedAt: T0, series, now: at(90) });
    expect(early).toMatchObject({ status: 'PENDING', label: 'UNKNOWN', unknownReason: 'NOT_YET' });
    expect(early.return1hPct).toBeCloseTo(10); // the 1h horizon is already known
    expect(early.return24hPct).toBeNull();
  });
  it('a missing price is unknown, never zero or carried forward', () => {
    const noHorizon = measureOutcome({ decidedAt: T0, series: mk([[0, 100], [60, 90], [600, 10]]), now: final });
    expect(noHorizon).toMatchObject({ status: 'FINAL', label: 'UNKNOWN', unknownReason: 'NO_HORIZON_PRICE', return24hPct: null });
    expect(noHorizon.maxDrawdownPct).toBeCloseTo(-90); // what is known is still reported
    const noEntry = measureOutcome({ decidedAt: T0, series: mk([[60, 100], [DAY, 100]]), now: final });
    expect(noEntry).toMatchObject({ status: 'FINAL', label: 'UNKNOWN', unknownReason: 'NO_ENTRY_PRICE', entryPriceUsd: null });
  });
  it('an entry price from after the decision is never used', () => {
    expect(measureOutcome({ decidedAt: T0, series: mk([[5, 100], [DAY, 200]]), now: final }).unknownReason).toBe('NO_ENTRY_PRICE');
  });
});

describe('replayExit: known answers on hand-made paths', () => {
  const noCost = { costPct: 0 };
  it('a stop loss fires on the first reading past the stop and fills at the NEXT reading', () => {
    const r = replayExit(ev(mk([[0, 100], [5, 100], [10, 90], [15, 70], [20, 65], [25, 60], [DAY, 60]])), { exit: { stopLossPct: 25, takeProfitPct: null, trailingStopPct: null }, ...noCost })!;
    expect(r.exits).toHaveLength(1);
    expect(r.exits[0]).toMatchObject({ action: 'SELL', priceUsd: 65, shareOfPosition: 1, codes: ['STOP_LOSS'] });
    expect(r.exits[0]!.at).toEqual(at(20));
    expect(r.closedBy).toBe('RULE');
    expect(r.grossReturnPct).toBeCloseTo(-35);
    expect(r.holdNetReturnPct).toBeCloseTo(-40); // held to 24h at 60
    expect(r.exitBenefitPct).toBeCloseTo(5);
  });
  it('the round-trip cost comes off once, however many exits there are', () => {
    const base = ev(mk([[0, 100], [5, 100], [10, 90], [15, 70], [20, 65], [DAY, 65]]));
    const exit = { stopLossPct: 25, takeProfitPct: null, trailingStopPct: null };
    const a = replayExit(base, { exit, costPct: 0 })!, b = replayExit(base, { exit })!;
    expect(a.netReturnPct - b.netReturnPct).toBeCloseTo(DEFAULT_ROUND_TRIP_COST_PCT);
    expect(b.netReturnPct).toBeCloseTo(b.grossReturnPct - DEFAULT_ROUND_TRIP_COST_PCT);
  });
  it('a trailing stop measures from the high since entry', () => {
    const r = replayExit(ev(mk([[0, 100], [5, 120], [10, 150], [15, 110], [20, 105], [DAY, 105]])), { exit: { stopLossPct: null, takeProfitPct: null, trailingStopPct: 20 }, ...noCost })!;
    expect(r.exits[0]).toMatchObject({ action: 'SELL', codes: ['TRAILING_STOP'], priceUsd: 105 });
    expect(r.grossReturnPct).toBeCloseTo(5);
  });
  it('a take profit reduces half once and does not repeat while the price stays high; the rest is held to the end', () => {
    const r = replayExit(ev(mk([[0, 100], [5, 150], [10, 210], [15, 215], [20, 220], [30, 230], [DAY, 150]])), { exit: { stopLossPct: null, takeProfitPct: 100, trailingStopPct: null }, ...noCost })!;
    expect(r.exits).toHaveLength(1);
    expect(r.exits[0]).toMatchObject({ action: 'REDUCE', shareOfPosition: 0.5, priceUsd: 215, codes: ['TAKE_PROFIT'] });
    expect(r.closedBy).toBe('MAX_HOLD');
    expect(r.grossReturnPct).toBeCloseTo(0.5 * 115 + 0.5 * 50);
  });
  it('with no exit signal the position is held to the end and the rules change nothing', () => {
    const r = replayExit(ev(mk([[0, 100], [DAY / 2, 110], [DAY, 120]])), { exit: { stopLossPct: null, takeProfitPct: null, trailingStopPct: null }, costPct: 0 })!;
    expect(r.exits).toHaveLength(0);
    expect(r.exitBenefitPct).toBeCloseTo(0);
    expect(r.grossReturnPct).toBeCloseTo(20);
  });
  it('says DATA_END when the stored history stops before the hold period does', () => {
    const r = replayExit(ev(mk([[0, 100], [60, 105], [120, 110]])), { exit: { stopLossPct: null, takeProfitPct: null, trailingStopPct: null }, costPct: 0 })!;
    expect(r.closedBy).toBe('DATA_END');
    expect(r.grossReturnPct).toBeCloseTo(10);
  });
  it('runs the live liquidity rule: a liquidity collapse sells', () => {
    const series: Point[] = [...mk([[0, 100]]), ...mk([[5, 100], [10, 100], [15, 99]], T0, 20_000), ...mk([[DAY, 99]], T0, 20_000)]; // 80% down from entry, and under the 10k floor? no: 20k
    const r = replayExit(ev(series), { exit: { stopLossPct: null, takeProfitPct: null, trailingStopPct: null }, costPct: 0 })!;
    expect(r.exits[0]).toMatchObject({ action: 'SELL', codes: ['LIQUIDITY_COLLAPSE'] });
  });
  it('never looks ahead: cutting the series after the fill leaves the exits unchanged, and a changed future cannot move an earlier exit', () => {
    const full = mk([[0, 100], [5, 100], [10, 90], [15, 70], [20, 65], [25, 300], [DAY, 1]]);
    const exit = { stopLossPct: 25, takeProfitPct: null, trailingStopPct: null };
    const a = replayExit(ev(full), { exit, costPct: 0 })!;
    const cut = replayExit(ev(full.slice(0, 5)), { exit, costPct: 0 })!; // ends at the fill reading
    expect(cut.exits).toEqual(a.exits);
    const future = replayExit(ev([...full.slice(0, 5), ...mk([[25, 1], [DAY, 1e6]])]), { exit, costPct: 0 })!;
    expect(future.exits).toEqual(a.exits);
  });
  it('readings after the hold period are ignored', () => {
    const r = replayExit(ev(mk([[0, 100], [DAY, 110], [DAY + 5, 1]])), { exit: { stopLossPct: 25, takeProfitPct: null, trailingStopPct: null }, costPct: 0 })!;
    expect(r.exits).toHaveLength(0);
    expect(r.grossReturnPct).toBeCloseTo(10);
  });
  it('returns null when there is nothing to replay', () => {
    expect(replayExit(ev(mk([[0, 100]])), { exit: REFERENCE_EXIT })).toBeNull();
    expect(replayExit({ ...ev(mk([[0, 100], [5, 100]])), priceUsd: 0 }, { exit: REFERENCE_EXIT })).toBeNull();
  });
  it('withRules replaces only what it is given', () => {
    const r = withRules({ liquidity: { reduceDropPct: 10 }, warningsToReduce: 3 });
    expect(r.liquidity).toMatchObject({ reduceDropPct: 10, sellDropPct: 70, sellFloorUsd: 10_000 });
    expect(r.warningsToReduce).toBe(3);
    expect(r.momentumWarnDropPct1h).toBe(25);
  });
});

/** Many tokens, each following the same crash after a small dip, spread over time. A tight stop is plainly better. */
function crashEvents(n: number, tokens: number): ReplayEvent[] {
  return Array.from({ length: n }, (_, i) => {
    const base = at(i * 3 * DAY / 2 / 1 + i, T0); // far enough apart that windows never overlap
    const series = mk([[0, 100], [5, 100], [10, 80], [15, 78], [20, 40], [25, 38], [DAY, 35]], base);
    return ev(series, `tok${i % tokens}`, base);
  });
}

describe('sweepRules', () => {
  it('finds nothing to say about a handful of events', () => {
    const s = sweepRules(crashEvents(6, 6), exitLevelCandidates(), REFERENCE_EXIT_LABEL);
    expect(s.verdict).toBe('INSUFFICIENT_DATA');
    expect(s.note).toContain('INSUFFICIENT DATA');
    expect(s.note).toContain('combinations were tried');
  });
  it('picks a tighter stop in training and confirms it on held-out events when the evidence is there', () => {
    const s = sweepRules(crashEvents(150, 40), exitLevelCandidates(), REFERENCE_EXIT_LABEL);
    expect(s.combinations).toBe(80);
    expect(s.trainEvents).toBe(105); expect(s.testEvents).toBe(45);
    expect(s.best!.label).toMatch(/stop=15|trail=15/); // both exit at the same reading on this path, so either may come first
    expect(s.testGain!.mean).toBeGreaterThan(5);
    expect(s.verdict).toBe('BETTER');
    expect(s.top).toHaveLength(10);
  });
  it('says no clear difference when the reference is already the best, and rejects an unknown reference', () => {
    const flat = Array.from({ length: 120 }, (_, i) => { const base = at(i * 2 * DAY, T0); return ev(mk([[0, 100], [5, 101], [DAY, 102]], base), `tok${i % 40}`, base); });
    expect(sweepRules(flat, exitLevelCandidates(), REFERENCE_EXIT_LABEL).verdict).toBe('NO_CLEAR_DIFFERENCE');
    expect(() => sweepRules(flat, exitLevelCandidates(), 'nope')).toThrow('reference');
  });
  it('the monitor-rule grid contains the live setting', () => {
    const c = monitorRuleCandidates();
    expect(c).toHaveLength(81);
    expect(c.some((x) => x.label === LIVE_RULES_LABEL)).toBe(true);
    expect(sweepRules(crashEvents(12, 12), c, LIVE_RULES_LABEL).verdict).toBe('INSUFFICIENT_DATA');
  });
});

describe('strategies, calibration and the report', () => {
  const now = at(60 * DAY);
  const strat = (n: number, tokens: number, end: number, name = 'S'): StrategyEvent[] =>
    Array.from({ length: n }, (_, i) => { const base = at(i * 2 * DAY, T0); return { ...ev(mk([[0, 100], [DAY, end]], base), `${name}${i % tokens}`, base), confidence: 0.6 + (i % 4) * 0.1, codes: i % 2 ? ['A_CODE'] : ['B_CODE'] }; });

  it('counts pending and unknown events separately and shows the worst case for the unknowns', () => {
    const rows = [...strat(3, 3, 130), { ...ev(mk([[0, 100], [60, 90]], at(20 * DAY)), 'rug', at(20 * DAY)) }, { ...ev(mk([[0, 100]], at(59.9 * DAY)), 'new', at(59.9 * DAY)) }];
    const r = evaluateStrategy('S', rows, now, { costPct: 0 });
    expect(r).toMatchObject({ events: 5, unknown: 1, pending: 1, hold: { n: 3 } });
    expect(r.unknownRate).toBeCloseTo(0.25);
    expect(r.holdMeanIfUnknownTotalLoss).toBeCloseTo((30 * 3 - 100) / 4);
    expect(r.hold.mean).toBeCloseTo(30);
  });
  it('compares to the baseline only with enough evidence, and the findings say so', () => {
    const thin = [evaluateStrategy('AI', strat(8, 8, 150, 'a'), now), evaluateStrategy('BASELINE', strat(8, 8, 100, 'b'), now)];
    const f = summarizeFindings(thin, [], { exitLevels: null, monitorRules: null });
    expect(f.findings).toHaveLength(0);
    expect(f.noConclusion[0]).toContain('baseline itself has too little data');

    const big = [evaluateStrategy('AI', strat(60, 40, 150, 'a'), now), evaluateStrategy('BASELINE', strat(60, 40, 100, 'b'), now)];
    expect(big[0]!.hold.sufficient).toBe(true);
    expect(big[0]!.hold.mean).toBeGreaterThan(big[1]!.hold.mean!);
  });
  it('groups by confidence and by reason code, each with its own sample size', () => {
    const items = Array.from({ length: 40 }, (_, i) => ({ tokenId: `t${i}`, ret: i % 2 ? 10 : -10, key: 0.6 + (i % 4) * 0.1, codes: i % 2 ? ['X'] : ['Y', 'X'] }));
    const b = calibrateByBucket(items, [0.6, 0.7, 0.8, 0.9]);
    expect(b.map((x) => x.label)).toEqual(['0.6 to 0.7', '0.7 to 0.8', '0.8 to 0.9']);
    expect(b.reduce((a, x) => a + x.described.n, 0)).toBe(items.length); // the last bucket includes its upper edge
    const s = calibrateBySignal(items);
    expect(s[0]).toMatchObject({ label: 'X' });
    expect(s[0]!.described.n).toBe(40);
    expect(s[1]).toMatchObject({ label: 'Y' });
    expect(s[1]!.described.n).toBe(20);
  });
  it('the rendered report prints INSUFFICIENT, the limits, and never a conclusion it cannot support', () => {
    const results = [evaluateStrategy('AI', strat(5, 5, 200, 'a'), now), evaluateStrategy('BASELINE', strat(5, 5, 50, 'b'), now)];
    const comparisons = [{ name: 'AI', vsBaselineHold: compareMeans(results[0]!.holdItems, results[1]!.holdItems), vsBaselineRules: compareMeans(results[0]!.ruleItems, results[1]!.ruleItems) }];
    const sweeps = { exitLevels: sweepRules(crashEvents(6, 6), exitLevelCandidates(), REFERENCE_EXIT_LABEL), monitorRules: null };
    const { findings, noConclusion } = summarizeFindings(results, comparisons, sweeps);
    expect(findings).toEqual([]);
    const md = renderMarkdown({
      generatedAt: now.toISOString(), coverage: { from: 'a', to: 'b', tokens: 10, metricPoints: 100, firstPointAt: null, lastPointAt: null, medianGapMinutes: 5, decisions: 5, buyDecisions: 5 }, costPct: 3,
      strategies: results, comparisons, aiByConfidence: calibrateByBucket([], [0.6, 0.7]), aiBySignal: [], oppByScore: [], sweeps, findings, noConclusion,
    });
    expect(md).toContain('INSUFFICIENT');
    expect(md).toContain('Read this first');
    expect(md).toContain('Not replayable');
    expect(md).toContain('None. No comparison has enough data yet.');
    expect(md).not.toMatch(/better than the baseline/);
  });
});
