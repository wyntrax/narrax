import { z } from 'zod';

export const WalletEntryBand = z.enum(['SMALL_CAP', 'UNDER_100K', '100K_500K', '500K_1M', 'OVER_1M', 'UNKNOWN', 'ALL']);
export type WalletEntryBand = z.infer<typeof WalletEntryBand>;
const n = z.number().finite(), count = n.int().nonnegative();
const decimal = z.string().regex(/^-?\d+(\.\d+)?$/);
export const WalletBandPerformance = z.object({
  band: WalletEntryBand, positions: count, closedPositions: count, closedTokens: count, wins: count, losses: count, breakeven: count,
  openPositions: count, winRate: n.nullable(), winRateLowerBound: n.nullable(), realisedPnlSol: decimal.nullable(),
  openCostSol: decimal, medianRoi: n.nullable(), medianWinSol: decimal.nullable(), medianLossSol: decimal.nullable(),
  profitFactor: n.nullable(), medianFirstSellSeconds: n.nullable(), medianCloseSeconds: n.nullable(),
  realisedDrawdownSol: decimal, observedDays: n, fastCloseRate: n.nullable(),
  // Optional for stored version-1 snapshots; absence is unknown, never zero.
  medianEntrySol: decimal.nullable().optional(), deployedSol: decimal.optional(),
  medianClosedPositionSol: decimal.nullable().optional(),
  entryCapKnownPositions: count.optional(), entryCapTotalPositions: count.optional(),
  // Optional mark-to-market open-position estimates (dead-bag survivorship check).
  openValueSol: decimal.nullable().optional(),
  unrealisedPnlSol: decimal.nullable().optional(),
  deadBagPositions: count.optional(),
  deadBagCostSol: decimal.optional(),
});
export type WalletBandPerformance = z.infer<typeof WalletBandPerformance>;
export const WalletPerformance = z.object({
  version: z.literal(1), checkedAt: z.string().datetime(), windowDays: z.literal(30), observedTrades: count,
  invalidTrades: count, unmatchedSells: count, capped: z.boolean(), lastTradeAt: z.string().datetime().nullable(),
  bands: z.array(WalletBandPerformance),
});
export type WalletPerformance = z.infer<typeof WalletPerformance>;

/** Flow suitability is behavioural evidence, not a profitability or approval verdict. */
export const WalletFlowSuitabilityReason = z.enum([
  'FLOW_PERFORMANCE_MISSING',
  'FLOW_HISTORY_INCOMPLETE',
  'FLOW_PERFORMANCE_STALE',
  'FLOW_TRADE_LIMIT',
  'FLOW_COST_BASIS_INCOMPLETE',
  'FLOW_SAMPLE_TOO_SMALL',
  'FLOW_FIRST_SELL_TOO_EARLY',
  'FLOW_HOLD_TOO_SHORT',
  'FLOW_POSITION_UNKNOWN',
  'FLOW_POSITION_TOO_SMALL',
  'FLOW_FAST_EXITS',
]);
export type WalletFlowSuitabilityReason = z.infer<typeof WalletFlowSuitabilityReason>;
export const WalletFlowSuitabilityMetrics = z.object({
  medianHoldSeconds: n.nullable(),
  medianFirstSellSeconds: n.nullable(),
  medianClosedPositionSol: decimal.nullable(),
  closedPositions: count,
  closedTokens: count,
  observedDays: n.nonnegative(),
  fastCloseRate: n.nullable(),
});
export type WalletFlowSuitabilityMetrics = z.infer<typeof WalletFlowSuitabilityMetrics>;

/** Shared timestamp freshness check used by ranking and flow suitability. */
export const isFreshTimestamp = (v: unknown, now: Date, maxAgeMs: number) =>
  typeof v === 'string' && Number.isFinite(Date.parse(v)) && Date.parse(v) <= +now && +now - Date.parse(v) <= maxAgeMs;

const historyObject = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};

/** Deep live-sample thresholds mirror RESEARCH_QUALIFICATION (shared cannot depend on smart-money). */
const DEEP_LIVE_MIN_CLOSES = 100;
const DEEP_LIVE_MIN_DAYS = 21;

/** One definition of "usable history" for review readiness and flow suitability. */
export function walletHistoryCoverage(performance: WalletPerformance, history: unknown, now: Date, fallbackBand?: WalletBandPerformance) {
  const h = historyObject(history);
  const scope = performance.bands?.find(b => b.band === 'ALL') ?? fallbackBand;
  const scanned = typeof h.scanned === 'number' && Number.isFinite(h.scanned) ? h.scanned : 0;
  const skipped = typeof h.skipped === 'number' && Number.isFinite(h.skipped) ? h.skipped : Infinity;
  const skipLimit = scanned >= 100 ? Math.floor(scanned * 0.01) : 0;
  const skippedAcceptable = skipped >= 0 && skipped <= skipLimit;
  const historyComplete = h.capped === false && skippedAcceptable && h.windowDays === 30 &&
    isFreshTimestamp(h.checkedAt, now, 86_400_000) && isFreshTimestamp(h.coveredTo, now, 86_400_000) &&
    typeof h.coveredFrom === 'string' && typeof h.coveredTo === 'string' &&
    Date.parse(h.coveredTo) - Date.parse(h.coveredFrom) >= 30 * 86_400_000;
  const deepLiveSample = h.capped === true && skippedAcceptable && h.windowDays === 30 &&
    isFreshTimestamp(h.checkedAt, now, 86_400_000) && isFreshTimestamp(performance.lastTradeAt, now, 86_400_000) &&
    (scope?.closedPositions ?? 0) >= DEEP_LIVE_MIN_CLOSES && (scope?.observedDays ?? 0) >= DEEP_LIVE_MIN_DAYS;
  return { historyComplete, deepLiveSample };
}

/** Snapshot of remaining observed swap inventory. This is not an on-chain balance. */
export const WalletOpenPosition = z.object({
  tokenId: z.string(), entryTradeId: z.string(), band: WalletEntryBand,
  quantity: decimal, remainingCostSol: decimal, investedSol: decimal, entrySol: decimal,
  openedAt: z.string().datetime(), lastTradeAt: z.string().datetime(), partiallySold: z.boolean(),
});
export type WalletOpenPosition = z.infer<typeof WalletOpenPosition>;
export const WalletOpenPositions = z.object({
  version: z.literal(1), checkedAt: z.string().datetime(), windowDays: z.literal(30),
  observedTrades: count, capped: z.boolean(), invalidTrades: count, unmatchedSells: count,
  positions: z.array(WalletOpenPosition),
  totalPositions: count.optional(),
});
export type WalletOpenPositions = z.infer<typeof WalletOpenPositions>;
export const WalletAutomationReason = z.enum([
  'HIGH_FREQUENCY',
  'SNIPER_EXITS',
  'DUST_SPRAY',
  'FIXED_TIMER_EXITS',
  'OPEN_BAG_OVERHANG',
]);
export type WalletAutomationReason = z.infer<typeof WalletAutomationReason>;
export const WalletAutomationSummary = z.object({
  automated: z.boolean(),
  reasons: z.array(WalletAutomationReason),
  tradesPerDay: n.nonnegative(),
  medianBuySol: n.nullable(),
  openPositionCount: count,
});
export type WalletAutomationSummary = z.infer<typeof WalletAutomationSummary>;

export const WalletRankingPage = z.object({
  asOf: z.string().datetime(), band: WalletEntryBand, windowDays: z.literal(30), total: count, capped: z.boolean(),
  minMedianPositionSol: n.nonnegative().optional(),
  counts: z.object({ reviewReady: count, observing: count, flowSuitable: count.optional(), automated: count.optional() }).optional(),
  pipeline: z.object({ checkedAt: z.string().datetime(), historyEnabled: z.boolean(), providerConfigured: z.boolean(),
    intakeAdded: count, scanned: count, failures: count }).nullable(),
  items: z.array(z.object({ address: z.string(), label: z.string().nullable(), review: z.string(),
    status: z.enum(['REVIEW_READY', 'OBSERVING']), reasons: z.array(z.string()), checkedAt: z.string().datetime(),
    historyComplete: z.boolean(), linked: z.boolean(), developer: z.boolean(), performance: WalletBandPerformance,
    flowSuitable: z.boolean().optional(), flowReasons: z.array(WalletFlowSuitabilityReason).optional(),
    flowMetrics: WalletFlowSuitabilityMetrics.nullable().optional(),
    automation: WalletAutomationSummary.nullable().optional(),
  })),
});
