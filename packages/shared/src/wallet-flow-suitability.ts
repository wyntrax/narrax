import { z } from 'zod';
import {
  WalletPerformance, WalletFlowSuitabilityMetrics, WalletFlowSuitabilityReason,
  isFreshTimestamp, walletHistoryCoverage,
} from './wallet-ranking';

/**
 * Behavioural filter for wallets that can plausibly produce a token-flow observation.
 * It is not a profitability, approval or recommendation rule. The flow publisher still
 * applies its own independent-entity, market, holder and risk gates.
 */
export const FLOW_SUITABILITY_LIMITS = {
  version: 1,
  /** The publication window is 60 minutes; half of it is a conservative behavioural floor. */
  minMedianHoldSeconds: 30 * 60,
  /** A first exit at the same floor avoids counting partial early dumps as holding wallets. */
  minMedianFirstSellSeconds: 30 * 60,
  /** Matches the publisher's per-entity net floor. */
  minMedianPositionSol: 0.5,
  minClosedPositions: 20,
  minClosedTokens: 5,
  minObservedDays: 7,
  maxFastCloseRate: 0.5,
} as const;

export const FlowSuitability = z.object({
  suitable: z.boolean(),
  reasons: z.array(WalletFlowSuitabilityReason),
  metrics: WalletFlowSuitabilityMetrics.nullable(),
});
export type FlowSuitability = z.infer<typeof FlowSuitability>;

/** Returns every behavioural blocker, in a stable order. Suitability means no blockers. */
export function flowSuitability(performance: WalletPerformance, history: unknown, now: Date): FlowSuitability {
  const L = FLOW_SUITABILITY_LIMITS;
  const scope = performance.bands.find(b => b.band === 'ALL');
  const metrics: WalletFlowSuitabilityMetrics = {
    medianHoldSeconds: scope?.medianCloseSeconds ?? null,
    medianFirstSellSeconds: scope?.medianFirstSellSeconds ?? null,
    medianClosedPositionSol: scope?.medianClosedPositionSol ?? null,
    closedPositions: scope?.closedPositions ?? 0,
    closedTokens: scope?.closedTokens ?? 0,
    observedDays: scope?.observedDays ?? 0,
    fastCloseRate: scope?.fastCloseRate ?? null,
  };
  const reasons: WalletFlowSuitabilityReason[] = [];
  const { historyComplete, deepLiveSample } = walletHistoryCoverage(performance, history, now);
  if (!historyComplete && !deepLiveSample) reasons.push('FLOW_HISTORY_INCOMPLETE');
  if (!isFreshTimestamp(performance.checkedAt, now, 45 * 60_000)) reasons.push('FLOW_PERFORMANCE_STALE');
  if (performance.capped) reasons.push('FLOW_TRADE_LIMIT');
  const unmatchedLimit = metrics.closedPositions >= 100 ? Math.floor(metrics.closedPositions * 0.015) : 0;
  if (performance.invalidTrades > 0 || performance.unmatchedSells > unmatchedLimit) reasons.push('FLOW_COST_BASIS_INCOMPLETE');
  if (!scope || metrics.closedPositions < L.minClosedPositions || metrics.closedTokens < L.minClosedTokens || metrics.observedDays < L.minObservedDays) reasons.push('FLOW_SAMPLE_TOO_SMALL');
  if (metrics.medianFirstSellSeconds == null || metrics.medianFirstSellSeconds < L.minMedianFirstSellSeconds) reasons.push('FLOW_FIRST_SELL_TOO_EARLY');
  if (metrics.medianHoldSeconds == null || metrics.medianHoldSeconds < L.minMedianHoldSeconds) reasons.push('FLOW_HOLD_TOO_SHORT');
  if (metrics.medianClosedPositionSol == null) reasons.push('FLOW_POSITION_UNKNOWN');
  else if (Number(metrics.medianClosedPositionSol) < L.minMedianPositionSol) reasons.push('FLOW_POSITION_TOO_SMALL');
  if (metrics.fastCloseRate == null || metrics.fastCloseRate > L.maxFastCloseRate) reasons.push('FLOW_FAST_EXITS');
  return { suitable: reasons.length === 0, reasons, metrics };
}

/** Safe boundary for stored JSON: a missing or malformed performance snapshot is not suitable. */
export function parseFlowSuitability(performanceValue: unknown, historyValue: unknown, now: Date): FlowSuitability {
  const parsed = WalletPerformance.safeParse(performanceValue);
  if (!parsed.success) return { suitable: false, reasons: ['FLOW_PERFORMANCE_MISSING'], metrics: null };
  return flowSuitability(parsed.data, historyValue, now);
}
