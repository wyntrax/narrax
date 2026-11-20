import { describe, expect, it } from 'vitest';
import { FLOW_SUITABILITY_LIMITS, flowSuitability, parseFlowSuitability } from './wallet-flow-suitability';
import type { WalletBandPerformance, WalletPerformance } from './wallet-ranking';

const now = new Date('2030-01-01T12:00:00Z');
const completeHistory = {
  checkedAt: now.toISOString(), coveredFrom: new Date(+now - 30 * 86_400_000).toISOString(), coveredTo: now.toISOString(),
  capped: false, scanned: 1_000, skipped: 0, windowDays: 30,
};
const allBand = (over: Partial<WalletBandPerformance> = {}): WalletBandPerformance => ({
  band: 'ALL', positions: 25, closedPositions: 25, closedTokens: 6, wins: 15, losses: 10, breakeven: 0, openPositions: 0,
  winRate: 0.6, winRateLowerBound: 0.4, realisedPnlSol: '1', openCostSol: '0', medianRoi: 0.1, medianWinSol: '0.2',
  medianLossSol: '-0.1', profitFactor: 2, medianFirstSellSeconds: 3_600, medianCloseSeconds: 3_600, realisedDrawdownSol: '0',
  observedDays: 12, fastCloseRate: 0, medianEntrySol: '1', deployedSol: '25', medianClosedPositionSol: '1',
  entryCapKnownPositions: 25, entryCapTotalPositions: 25, ...over,
});
const performance = (over: Partial<WalletPerformance> = {}, band: Partial<WalletBandPerformance> = {}): WalletPerformance => ({
  version: 1, checkedAt: now.toISOString(), windowDays: 30, observedTrades: 50, invalidTrades: 0, unmatchedSells: 0,
  capped: false, lastTradeAt: now.toISOString(), bands: [allBand(band)], ...over,
});

describe('flowSuitability', () => {
  it('accepts a holding wallet with enough size, history and sample', () => {
    const result = flowSuitability(performance(), completeHistory, now);
    expect(result.reasons).toEqual([]);
    expect(result.suitable).toBe(true);
    expect(result.metrics).toMatchObject({ medianHoldSeconds: 3_600, medianFirstSellSeconds: 3_600, medianClosedPositionSol: '1', closedPositions: 25, closedTokens: 6 });
  });

  it('accepts a deep live capped sample even though the history row is not complete', () => {
    const deep = performance({}, { closedPositions: 100, observedDays: 21 });
    const result = flowSuitability(deep, { ...completeHistory, capped: true }, now);
    expect(result.reasons).not.toContain('FLOW_HISTORY_INCOMPLETE');
    expect(result.reasons).not.toContain('FLOW_SAMPLE_TOO_SMALL');
  });

  it.each([
    [{ history: {} }, 'FLOW_HISTORY_INCOMPLETE'],
    [{ perf: { checkedAt: new Date(+now - 46 * 60_000).toISOString() } }, 'FLOW_PERFORMANCE_STALE'],
    [{ perf: { capped: true } }, 'FLOW_TRADE_LIMIT'],
    [{ perf: { invalidTrades: 1 } }, 'FLOW_COST_BASIS_INCOMPLETE'],
    [{ perf: { unmatchedSells: 1 } }, 'FLOW_COST_BASIS_INCOMPLETE'],
    [{ band: { closedPositions: 19 } }, 'FLOW_SAMPLE_TOO_SMALL'],
    [{ band: { closedTokens: 4 } }, 'FLOW_SAMPLE_TOO_SMALL'],
    [{ band: { observedDays: 6 } }, 'FLOW_SAMPLE_TOO_SMALL'],
    [{ band: { medianFirstSellSeconds: FLOW_SUITABILITY_LIMITS.minMedianFirstSellSeconds - 1 } }, 'FLOW_FIRST_SELL_TOO_EARLY'],
    [{ band: { medianFirstSellSeconds: null } }, 'FLOW_FIRST_SELL_TOO_EARLY'],
    [{ band: { medianCloseSeconds: FLOW_SUITABILITY_LIMITS.minMedianHoldSeconds - 1 } }, 'FLOW_HOLD_TOO_SHORT'],
    [{ band: { medianCloseSeconds: null } }, 'FLOW_HOLD_TOO_SHORT'],
    [{ band: { medianClosedPositionSol: null } }, 'FLOW_POSITION_UNKNOWN'],
    [{ band: { medianClosedPositionSol: '0.499' } }, 'FLOW_POSITION_TOO_SMALL'],
    [{ band: { fastCloseRate: 0.51 } }, 'FLOW_FAST_EXITS'],
    [{ band: { fastCloseRate: null } }, 'FLOW_FAST_EXITS'],
  ] as const)('withholds %o as %s', (patch, reason) => {
    const perf = 'perf' in patch ? performance(patch.perf) : 'band' in patch ? performance({}, patch.band) : performance();
    const history = 'history' in patch ? patch.history : completeHistory;
    expect(flowSuitability(perf, history, now).reasons).toContain(reason);
  });

  it('does not use missing performance as a silent pass', () => {
    expect(parseFlowSuitability(undefined, completeHistory, now)).toEqual({ suitable: false, reasons: ['FLOW_PERFORMANCE_MISSING'], metrics: null });
  });
});
