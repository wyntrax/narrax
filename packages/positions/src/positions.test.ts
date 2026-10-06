import { describe, expect, it } from 'vitest';
import { MONITOR_RULES, combineWithReview, evaluatePosition, parseEntryContext, type EntryContext, type NarrativeStageName, type PositionFacts } from './index';

const NOW = new Date('2026-09-30T12:00:00Z');
const min = (m: number) => new Date(NOW.getTime() - m * 60_000);
const entry = (over: Partial<EntryContext> = {}): EntryContext => ({
  version: 1, capturedAt: min(120).toISOString(), priceUsd: 1, liquidityUsd: 100_000, volume24hUsd: 200_000, holders: 500, top10Pct: 30,
  narrative: { id: 'n1', score: 80, velocity: 100, stage: 'ACCELERATING' }, smartMoney: { score: 70, walletCount: 4, independentEntities: 3 },
  exit: { stopLossPct: 30, takeProfitPct: 100, trailingStopPct: 25 }, ...over,
});
const facts = (over: Partial<PositionFacts> = {}, mkt: Partial<NonNullable<PositionFacts['market']>> = {}): PositionFacts => ({
  now: NOW, entryPriceUsd: 1, entry: entry(),
  market: { at: min(2), priceUsd: 1.1, liquidityUsd: 100_000, volume24hUsd: 200_000, price1hAgoUsd: 1.1, ...mkt },
  highWaterUsd: 1.1, holders: { top10Pct: 30 }, riskFlags: [], narrative: { stage: 'ACCELERATING', score: 80, velocity: 100 }, smartMoneyExits: { entities: 0, leaders: 0 }, ...over,
});
const codes = (e: ReturnType<typeof evaluatePosition>) => e.signals.map((s) => s.code);

describe('evaluatePosition: clean and price rules', () => {
  it('holds with no signals when everything is fine, and always lists developer data as unavailable', () => {
    const e = evaluatePosition(facts());
    expect(e).toMatchObject({ action: 'HOLD', fractionPct: 0, signals: [], blind: false });
    expect(e.unavailable).toEqual(['DEV_ACTIVITY: developer wallet data is not collected']);
    expect(e.pnlPct).toBeCloseTo(10);
  });

  it('sells at the stop loss, including exactly at the limit', () => {
    expect(evaluatePosition(facts({}, { priceUsd: 0.65 }))).toMatchObject({ action: 'SELL', fractionPct: 100 });
    expect(codes(evaluatePosition(facts({}, { priceUsd: 0.7 })))).toContain('STOP_LOSS');
    expect(codes(evaluatePosition(facts({}, { priceUsd: 0.7001, price1hAgoUsd: 0.7001 })))).not.toContain('STOP_LOSS');
  });

  it('reduces by half at the take-profit target', () => {
    const e = evaluatePosition(facts({ highWaterUsd: 2 }, { priceUsd: 2 }));
    expect(e).toMatchObject({ action: 'REDUCE', fractionPct: MONITOR_RULES.reduceFractionPct });
    expect(codes(e)).toEqual(['TAKE_PROFIT']);
  });

  it('sells on a trailing stop measured from the highest price since entry', () => {
    const e = evaluatePosition(facts({ highWaterUsd: 2 }, { priceUsd: 1.45, price1hAgoUsd: 1.45 }));
    expect(e.action).toBe('SELL');
    expect(codes(e)).toEqual(['TRAILING_STOP']);
    expect(evaluatePosition(facts({ highWaterUsd: 2 }, { priceUsd: 1.6, price1hAgoUsd: 1.6 })).action).toBe('HOLD');
  });

  it('measures the trailing stop from entry when no high is known, and never from below it', () => {
    const e = evaluatePosition(facts({ highWaterUsd: null }, { priceUsd: 0.74, price1hAgoUsd: 0.74 }));
    expect(e.highWaterUsd).toBe(1);
    expect(codes(e)).toEqual(expect.arrayContaining(['TRAILING_STOP']));
  });

  it('skips any rule whose limit is null', () => {
    const e = evaluatePosition(facts({ entry: entry({ exit: { stopLossPct: null, takeProfitPct: null, trailingStopPct: null } }) }, { priceUsd: 0.5, price1hAgoUsd: 0.5 }));
    expect(codes(e)).not.toEqual(expect.arrayContaining(['STOP_LOSS', 'TRAILING_STOP', 'TAKE_PROFIT']));
  });
});

describe('evaluatePosition: liquidity, volume, momentum', () => {
  it('reduces on a 40% liquidity drop, sells on 70%, and sells below the absolute floor with one signal', () => {
    expect(codes(evaluatePosition(facts({}, { liquidityUsd: 55_000 })))).toEqual(['LIQUIDITY_DROP']);
    expect(evaluatePosition(facts({}, { liquidityUsd: 55_000 })).action).toBe('REDUCE');
    expect(codes(evaluatePosition(facts({}, { liquidityUsd: 25_000 })))).toEqual(['LIQUIDITY_COLLAPSE']);
    const floor = evaluatePosition(facts({ entry: entry({ liquidityUsd: 12_000 }) }, { liquidityUsd: 9_000 }));
    expect(codes(floor)).toEqual(['LIQUIDITY_FLOOR']);
    expect(floor.action).toBe('SELL');
  });

  it('treats one warning as a warning only, and two together as a reduce', () => {
    const one = evaluatePosition(facts({}, { volume24hUsd: 20_000 }));
    expect(one).toMatchObject({ action: 'HOLD', fractionPct: 0 });
    expect(codes(one)).toEqual(['VOLUME_COLLAPSE']);
    expect(one.summary).toMatch(/HOLD with warnings/);
    // Trailing stop off, so only the two warnings are in play (a 27% fall from the 1.1 high would trip a 25% trailing stop).
    const noTrail = entry({ exit: { stopLossPct: 30, takeProfitPct: 100, trailingStopPct: null } });
    const two = evaluatePosition(facts({ entry: noTrail }, { volume24hUsd: 20_000, priceUsd: 0.8, price1hAgoUsd: 1.1 }));
    expect(codes(two)).toEqual(['VOLUME_COLLAPSE', 'MOMENTUM_LOSS', 'MULTIPLE_WARNINGS']);
    expect(two.action).toBe('REDUCE');
  });

  it('reports momentum as unavailable when there is no price from an hour ago', () => {
    expect(evaluatePosition(facts({}, { price1hAgoUsd: null })).unavailable.join()).toMatch(/MOMENTUM/);
  });
});

describe('evaluatePosition: missing and stale data', () => {
  it('does not run price rules on a stale price: it is blind, warns, and does not invent a pnl', () => {
    const e = evaluatePosition(facts({}, { at: min(20), priceUsd: 0.1 }));
    expect(e).toMatchObject({ action: 'HOLD', blind: true, pnlPct: null });
    expect(codes(e)).toEqual(['DATA_STALE']);
    expect(e.unavailable.join()).toMatch(/PRICE_RULES/);
  });

  it('is blind with no market row at all, and a stale warning alone never counts toward escalation', () => {
    const e = evaluatePosition(facts({ market: null, narrative: null }));
    expect(e).toMatchObject({ blind: true, action: 'HOLD' });
    expect(codes(e)).toEqual(['DATA_STALE']);
  });

  it('still catches a honeypot flag while blind', () => {
    expect(evaluatePosition(facts({ market: null, riskFlags: ['HONEYPOT'] }))).toMatchObject({ action: 'SELL', blind: true });
  });

  it('reports a missing entry baseline instead of guessing', () => {
    const e = evaluatePosition(facts({ entry: null }, { priceUsd: 0.2, liquidityUsd: 1_000_000 }));
    expect(e.action).toBe('HOLD');
    expect(e.unavailable.join('|')).toMatch(/EXIT_RULES.*ENTRY_COMPARISONS/);
  });

  it('lists every check that could not run', () => {
    const e = evaluatePosition(facts({ holders: null, riskFlags: null, narrative: null, smartMoneyExits: null }));
    expect(e.unavailable.map((u) => u.split(':')[0])).toEqual(['DEV_ACTIVITY', 'TOKEN_RISK', 'CONCENTRATION', 'NARRATIVE', 'SMART_MONEY_EXITS']);
  });
});

describe('evaluatePosition: thesis rules', () => {
  const narr = (stage: NarrativeStageName, score = 80, velocity = 100) => facts({ narrative: { stage, score, velocity } });

  it('sells a dead narrative, reduces a decaying one, only warns on a newly saturated one', () => {
    expect(evaluatePosition(narr('DEAD'))).toMatchObject({ action: 'SELL' });
    expect(evaluatePosition(narr('DECAYING'))).toMatchObject({ action: 'REDUCE' });
    const sat = evaluatePosition(narr('SATURATED'));
    expect(sat.action).toBe('HOLD');
    expect(codes(sat)).toEqual(['NARRATIVE_SATURATED']);
    expect(evaluatePosition(facts({ entry: entry({ narrative: { id: 'n1', score: 80, velocity: 100, stage: 'SATURATED' } }), narrative: { stage: 'SATURATED', score: 80, velocity: 100 } })).signals).toEqual([]);
  });

  it('reduces on a 30-point narrative score drop and warns on a 60% slowdown', () => {
    expect(codes(evaluatePosition(narr('ACCELERATING', 50)))).toEqual(['NARRATIVE_SCORE_DROP']);
    expect(codes(evaluatePosition(narr('ACCELERATING', 79, 35)))).toEqual(['NARRATIVE_SLOWING']);
  });

  it('acts on tracked-wallet exits by independent entities, and on any leader exit', () => {
    expect(evaluatePosition(facts({ smartMoneyExits: { entities: 3, leaders: 0 } })).action).toBe('SELL');
    expect(evaluatePosition(facts({ smartMoneyExits: { entities: 2, leaders: 0 } })).action).toBe('REDUCE');
    expect(evaluatePosition(facts({ smartMoneyExits: { entities: 1, leaders: 1 } })).action).toBe('REDUCE');
    expect(evaluatePosition(facts({ smartMoneyExits: { entities: 1, leaders: 0 } })).signals).toEqual([]);
  });

  it('warns when the top-10 share rises 15 points', () => {
    expect(codes(evaluatePosition(facts({ holders: { top10Pct: 46 } })))).toEqual(['CONCENTRATION_RISE']);
    expect(evaluatePosition(facts({ holders: { top10Pct: 44 } })).signals).toEqual([]);
  });

  it('lets the strongest signal set the action and lists all of them', () => {
    const e = evaluatePosition(facts({ narrative: { stage: 'DECAYING', score: 80, velocity: 100 } }, { priceUsd: 0.6, price1hAgoUsd: 0.6 }));
    expect(e.action).toBe('SELL');
    expect(codes(e)).toEqual(expect.arrayContaining(['STOP_LOSS', 'NARRATIVE_DECAYING']));
    expect(e.summary).toMatch(/^SELL: .*STOP_LOSS/);
  });
});

describe('combineWithReview', () => {
  const hold = evaluatePosition(facts());
  const reduce = evaluatePosition(facts({ narrative: { stage: 'DECAYING', score: 80, velocity: 100 } }));
  const sell = evaluatePosition(facts({}, { priceUsd: 0.5, price1hAgoUsd: 0.5 }));
  const rv = (action: 'HOLD' | 'REDUCE' | 'SELL', confidence = 0.9) => ({ action, confidence, reasonCodes: ['WHALE_DUMP'] });

  it('leaves the rules untouched with no review or a HOLD review', () => {
    expect(combineWithReview(hold, null)).toMatchObject({ evaluation: hold, reviewApplied: false });
    expect(combineWithReview(hold, rv('HOLD')).evaluation).toBe(hold);
  });
  it('turns a rules HOLD into a REDUCE when the review is confident, and records why', () => {
    const c = combineWithReview(hold, rv('REDUCE'));
    expect(c.reviewApplied).toBe(true);
    expect(c.evaluation).toMatchObject({ action: 'REDUCE', fractionPct: MONITOR_RULES.reduceFractionPct });
    expect(c.evaluation.signals.map((s) => s.code)).toContain('AI_REVIEW_CAUTION');
  });
  it('never turns anything into a SELL: a SELL review on a HOLD becomes a reduce', () => {
    const c = combineWithReview(hold, rv('SELL'));
    expect(c.evaluation.action).toBe('REDUCE');
    expect(c.reviewNote).toMatch(/applied as a reduce/);
  });
  it('ignores a low-confidence review', () => {
    expect(combineWithReview(hold, rv('REDUCE', 0.6))).toMatchObject({ evaluation: hold, reviewApplied: false });
  });
  it('can never soften or enlarge a rules decision', () => {
    expect(combineWithReview(sell, rv('HOLD')).evaluation.action).toBe('SELL');
    expect(combineWithReview(reduce, rv('SELL')).evaluation.action).toBe('REDUCE');
    expect(combineWithReview(reduce, rv('REDUCE')).reviewApplied).toBe(false);
  });
});

describe('parseEntryContext', () => {
  it('accepts a complete context and rejects anything incomplete or wrong, without guessing', () => {
    expect(parseEntryContext(entry())).toEqual(entry());
    expect(parseEntryContext({ ...entry(), priceUsd: 0 })).toBeNull();
    expect(parseEntryContext({ ...entry(), exit: undefined })).toBeNull();
    expect(parseEntryContext({ narrativeScore: 80, smartMoneyScore: 70, priceUsd: 1 })).toBeNull();
    expect(parseEntryContext({ ...entry(), top10Pct: 120 })).toBeNull();
    expect(parseEntryContext(null)).toBeNull();
  });
});

import { computeSmartMoneyExits, type WalletTradeRow } from './index';

describe('computeSmartMoneyExits', () => {
  const opened = new Date('2026-09-30T10:00:00Z');
  const t = (walletId: string, side: 'BUY' | 'SELL', amount: number | null, at: string, extra: Partial<WalletTradeRow> = {}): WalletTradeRow => ({ walletId, clusterId: null, leaderScore: 0, side, tokenAmount: amount, at: new Date(at), ...extra });

  it('counts a wallet that sold half or more of what it bought since the position opened', () => {
    const r = computeSmartMoneyExits([t('a', 'BUY', 100, '2026-09-30T08:00:00Z'), t('a', 'SELL', 50, '2026-09-30T11:00:00Z'), t('b', 'BUY', 100, '2026-09-30T08:00:00Z'), t('b', 'SELL', 49, '2026-09-30T11:00:00Z')], opened);
    expect(r).toEqual({ entities: 1, leaders: 0 });
  });
  it('ignores sells from before the position opened', () => {
    expect(computeSmartMoneyExits([t('a', 'BUY', 100, '2026-09-29T08:00:00Z'), t('a', 'SELL', 100, '2026-09-30T09:59:00Z')], opened)).toEqual({ entities: 0, leaders: 0 });
  });
  it('counts wallets in one cluster as a single entity, and a leader once', () => {
    const rows = ['a', 'b', 'c'].flatMap((w) => [t(w, 'BUY', 10, '2026-09-30T08:00:00Z', { clusterId: 'cl1', leaderScore: w === 'a' ? 80 : 10 }), t(w, 'SELL', 10, '2026-09-30T11:00:00Z', { clusterId: 'cl1', leaderScore: w === 'a' ? 80 : 10 })]);
    expect(computeSmartMoneyExits(rows, opened)).toEqual({ entities: 1, leaders: 1 });
  });
  it('skips a wallet with a trade of unknown size instead of guessing', () => {
    expect(computeSmartMoneyExits([t('a', 'BUY', 100, '2026-09-30T08:00:00Z'), t('a', 'SELL', null, '2026-09-30T11:00:00Z')], opened)).toEqual({ entities: 0, leaders: 0 });
  });
  it('ignores a wallet that never bought (a sell with no recorded buy is not an exit signal) and handles no trades', () => {
    expect(computeSmartMoneyExits([t('a', 'SELL', 100, '2026-09-30T11:00:00Z')], opened)).toEqual({ entities: 0, leaders: 0 });
    expect(computeSmartMoneyExits([], opened)).toEqual({ entities: 0, leaders: 0 });
  });
});
