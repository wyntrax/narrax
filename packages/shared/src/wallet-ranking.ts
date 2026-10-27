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
});
export type WalletBandPerformance = z.infer<typeof WalletBandPerformance>;
export const WalletPerformance = z.object({
  version: z.literal(1), checkedAt: z.string().datetime(), windowDays: z.literal(30), observedTrades: count,
  invalidTrades: count, unmatchedSells: count, capped: z.boolean(), lastTradeAt: z.string().datetime().nullable(),
  bands: z.array(WalletBandPerformance),
});
export type WalletPerformance = z.infer<typeof WalletPerformance>;
export const WalletRankingPage = z.object({
  asOf: z.string().datetime(), band: WalletEntryBand, windowDays: z.literal(30), total: count, capped: z.boolean(),
  minMedianPositionSol: n.nonnegative().optional(),
  counts: z.object({ reviewReady: count, observing: count }).optional(),
  pipeline: z.object({ checkedAt: z.string().datetime(), historyEnabled: z.boolean(), providerConfigured: z.boolean(),
    intakeAdded: count, scanned: count, failures: count }).nullable(),
  items: z.array(z.object({ address: z.string(), label: z.string().nullable(), review: z.string(),
    status: z.enum(['REVIEW_READY', 'OBSERVING']), reasons: z.array(z.string()), checkedAt: z.string().datetime(),
    historyComplete: z.boolean(), linked: z.boolean(), developer: z.boolean(), performance: WalletBandPerformance,
  })),
});
