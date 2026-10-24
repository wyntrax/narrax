import { describe, it, expect } from 'vitest';
import type { Point } from './series';
import {
  buildRadarScorecard,
  dedupeRadarCalls,
  entryCapBand,
  measureRadarHorizon,
  measureRadarPeak,
  renderRadarScorecard,
  replayRadarExit,
  scoreBand,
  RADAR_EXIT_RULES,
  RADAR_HORIZONS,
  RADAR_PEAKS,
  type RadarCall,
} from './radarScorecard';

const at = new Date('2026-10-17T00:00:00Z');
const hour = 3_600_000;
const min = 60_000;
const point = (offsetMs: number, priceUsd: number): Point => ({
  at: new Date(+at + offsetMs),
  priceUsd,
  liquidityUsd: 50_000,
  volume24hUsd: 100_000,
});
const call = (over: Partial<RadarCall> = {}): RadarCall => ({
  id: 'c1',
  tokenId: 't1',
  mint: 'mint1',
  alertedAt: at,
  profile: 'trencher',
  tier: 'WATCH',
  route: 'NARRATIVE',
  matchKind: 'NAME',
  score: 60,
  entryPriceUsd: 1,
  entryAt: new Date(+at - 5 * min),
  entryMarketCapUsd: 40_000,
  entryUnknownReason: null,
  ...over,
});
const series = [point(-5 * min, 1), point(15 * min, 1.2), point(hour, 1.5), point(4 * hour, 0.8), point(24 * hour, 0.5)];
const now = new Date(+at + 25 * hour);

describe('radar scorecard horizons and peaks', () => {
  it('measures 15m, 1h, 4h and 24h from the frozen entry without carrying a missing price forward', () => {
    const horizons = RADAR_HORIZONS.map((h) => measureRadarHorizon(call(), series, h, now));
    const returns = horizons.map((h) => h.returnPct!);
    expect(returns[0]).toBeCloseTo(20);
    expect(returns[1]).toBeCloseTo(50);
    expect(returns[2]).toBeCloseTo(-20);
    expect(returns[3]).toBeCloseTo(-50);
    expect(horizons.every((h) => h.status === 'OBSERVED')).toBe(true);
  });

  it('distinguishes pending, missing and missing entry', () => {
    expect(measureRadarHorizon(call(), [point(0, 1)], RADAR_HORIZONS[1], new Date(+at + 10 * min))).toMatchObject({ status: 'PENDING', unknownReason: 'NOT_YET' });
    expect(measureRadarHorizon(call(), [point(0, 1), point(4 * hour, 2)], RADAR_HORIZONS[1], new Date(+at + 2 * hour))).toMatchObject({
      status: 'UNKNOWN',
      unknownReason: 'NO_HORIZON_PRICE',
      returnPct: null,
    });
    expect(measureRadarHorizon(call({ entryPriceUsd: null }), series, RADAR_HORIZONS[1], now)).toMatchObject({
      status: 'UNKNOWN',
      unknownReason: 'NO_ENTRY_PRICE',
    });
  });

  it('reports the peak, time to it, the close give-back and the post-peak low', () => {
    const p = measureRadarPeak(call(), series, RADAR_PEAKS[1]!, now);
    expect(p).toMatchObject({ status: 'OBSERVED', peakGainPct: 50, timeToPeakSeconds: 3600 });
    expect(p.endReturnPct).toBeCloseTo(-20);
    expect(p.giveBackPct).toBeCloseTo(46.6667);
    expect(p.postPeakLowPct).toBeCloseTo(-46.6667);
  });

  it('does not look into the future beyond the selected window', () => {
    const withFuture = [...series, point(5 * hour, 10)];
    const p = measureRadarPeak(call(), withFuture, RADAR_PEAKS[1]!, now);
    expect(p.peakGainPct).toBe(50);
  });
});

describe('radar exit replay', () => {
  const rule = (id: string) => RADAR_EXIT_RULES.find((r) => r.id === id)!;

  it('holds to the 4h close and subtracts the round-trip cost', () => {
    const hold = replayRadarExit(call(), series, rule('hold-4h'), now, 3);
    expect(hold).toMatchObject({ status: 'OBSERVED', reason: 'TIME', exitBenefitPct: 0 });
    expect(hold.netReturnPct).toBeCloseTo(-23);
    expect(hold.holdNetReturnPct).toBeCloseTo(-23);
    expect(replayRadarExit(call(), series, rule('hold-4h'), now, 0).netReturnPct).toBeCloseTo(-20);
  });

  it('fills a take-profit at the target, not at a better close above it', () => {
    const tp = replayRadarExit(call(), series, rule('tp25'), now, 3);
    expect(tp).toMatchObject({ status: 'OBSERVED', reason: 'TAKE_PROFIT', exitPriceUsd: 1.25, netReturnPct: 22 });
    expect(tp.exitAt).toEqual(new Date(+at + hour));
  });

  it('keeps gap risk on a stop instead of pretending the stop price filled', () => {
    const gap = [point(0, 1), point(2 * hour, 0.5), point(4 * hour, 0.4)];
    expect(replayRadarExit(call(), gap, rule('stop25'), now, 3)).toMatchObject({ status: 'OBSERVED', reason: 'STOP', netReturnPct: -53 });
  });

  it('arms a trailing stop only after the activation level and exits on the close below it', () => {
    const trail = [point(15 * min, 1.3), point(hour, 1.6), point(2 * hour, 1.1), point(4 * hour, 1)];
    const r = replayRadarExit(call(), trail, rule('trail25'), now, 3);
    expect(r).toMatchObject({ status: 'OBSERVED', reason: 'TRAILING' });
    expect(r.netReturnPct).toBeCloseTo(7);
  });

  it('marks an unelapsed rule pending and a missing entry unknown', () => {
    expect(replayRadarExit(call(), series, rule('hold-24h'), new Date(+at + hour), 3)).toMatchObject({ status: 'PENDING', reason: 'PENDING' });
    expect(replayRadarExit(call({ entryPriceUsd: null }), series, rule('hold-4h'), now, 3)).toMatchObject({ status: 'UNKNOWN', reason: 'NO_DATA' });
  });
});

describe('radar cohort aggregation', () => {
  it('keeps one call per token in a 24h window', () => {
    const calls = [call({ id: 'a' }), call({ id: 'b', alertedAt: new Date(+at + hour) }), call({ id: 'c', alertedAt: new Date(+at + 25 * hour) }), call({ id: 'd', tokenId: 't2', alertedAt: new Date(+at + 2 * hour) })];
    expect(dedupeRadarCalls(calls).map((c) => c.id)).toEqual(['a', 'd', 'c']);
  });

  it('counts a missing entry as unknown rather than zero and refuses a verdict below the gates', () => {
    const prices = new Map([['t1', series]]);
    const s = buildRadarScorecard([call(), call({ id: 'c2', tokenId: 't2', entryPriceUsd: null })], prices, {
      from: new Date(+at - hour),
      to: new Date(+at + 25 * hour),
      now,
    });
    expect(s.calls).toBe(2);
    expect(s.entryUnknown).toBe(1);
    const h1 = s.overall.horizons.find((h) => h.hours === 1)!;
    expect(h1).toMatchObject({ known: 1, unknown: 1, pending: 0 });
    expect(h1.returns.sufficient).toBe(false);
    expect(s.byProfile.map((b) => b.label)).toContain('trencher');
  });

  it('separates score bands and entry market-cap bands', () => {
    expect(scoreBand(54.9)).toBe('under 55');
    expect(scoreBand(55)).toBe('55 to 59');
    expect(scoreBand(60)).toBe('60 to 69');
    expect(scoreBand(80)).toBe('80 and above');
    expect(scoreBand(null)).toBe('unknown');
    expect(entryCapBand(19_999)).toBe('under $20k');
    expect(entryCapBand(20_000)).toBe('$20k to $50k');
    expect(entryCapBand(50_000)).toBe('$50k to $100k');
    expect(entryCapBand(100_000)).toBe('$100k and above');
    expect(entryCapBand(null)).toBe('unknown');
  });

  it('reports a benefit only when the rule changed the exit', () => {
    const s = buildRadarScorecard([call()], new Map([['t1', series]]), { from: new Date(+at - hour), to: new Date(+at + 25 * hour), now });
    expect(s.overall.exits.find((e) => e.id === 'tp25')!.medianBenefitWhenDifferent).not.toBeNull();
    expect(s.overall.exits.find((e) => e.id === 'hold-4h')!.medianBenefitWhenDifferent).toBeNull();
  });

  it('renders an honest report with the sample caveat', () => {
    const s = buildRadarScorecard([call()], new Map([['t1', series]]), { from: new Date(+at - hour), to: new Date(+at + 25 * hour), now });
    const md = renderRadarScorecard(s);
    expect(md).toContain('# Early Radar scorecard');
    expect(md).toContain('INSUFFICIENT');
    expect(md).toContain('not financial advice');
    expect(md).toContain('Median');
  });
});
