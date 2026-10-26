import { z } from 'zod';

/** Descriptive, versioned rules; not a classifier of intent or profitability. */
export const INVESTIGATION_STRATEGY_RULES = { version: 1, minTrades: 3, minDistinctTimes: 3, minSpanMs: 300_000, maxPatterns: 20, maxExamples: 5, maxPublications: 10 } as const;
const At = z.string().datetime();
const Amount = z.string().regex(/^-?\d+(?:\.\d+)?$/).nullable();
export const StrategyTrade = z.object({ id: z.string(), walletId: z.string(), signature: z.string(), side: z.enum(['BUY', 'SELL']), at: At, amountSol: Amount, tokenAmount: Amount });
export const InvestigationStrategies = z.object({
  rules: z.object({ version: z.literal(1), minTrades: z.number(), minDistinctTimes: z.number(), minSpanMs: z.number(), maxPatterns: z.number(), maxExamples: z.number() }),
  scope: z.enum(['RECORDED_WINDOW', 'LATEST_CAPPED_SAMPLE']),
  evaluatedWallets: z.number().int(), observedTrades: z.number().int(), excludedTrades: z.number().int(),
  candidateCount: z.number().int(), truncated: z.boolean(),
  items: z.array(z.object({
    walletId: z.string(), kind: z.enum(['REPEATED_BUYING', 'STAGGERED_SELLING']),
    supportingCount: z.number().int(), opposingCount: z.number().int(), walletTradeCount: z.number().int(), distinctTimes: z.number().int(),
    firstAt: At, lastAt: At, spanMs: z.number(),
    examples: z.array(StrategyTrade), opposingExamples: z.array(StrategyTrade),
    historyStatus: z.enum(['UNKNOWN', 'STALE', 'PARTIAL', 'COVERED']),
  })),
});
const FrozenWallet = z.object({ address: z.string(), clusterId: z.string().nullable(), qualification: z.object({ status: z.enum(['QUALIFIED', 'PROVISIONAL', 'REJECTED']), eligible: z.boolean(), rulesVersion: z.number(), reasons: z.array(z.string()) }) });
const FrozenTrade = z.object({ id: z.string(), wallet: z.string(), signature: z.string(), side: z.enum(['BUY', 'SELL']), amountSol: z.number().finite().nonnegative(), at: At });
/** Preview is explicitly bounded independently of the observation's stored counts. */
export const PublishedInvestigationContext = z.object({
  limit: z.number().int(), truncated: z.boolean(), outcomesReadAt: At,
  items: z.array(z.object({
    id: z.string(), side: z.enum(['BUY', 'SELL']), createdAt: At,
    walletCount: z.number().int(), supportingGroupCount: z.number().int(), netFlowSol: Amount,
    reference: z.object({ priceUsd: z.string(), at: At, metricId: z.string(), source: z.literal('dexscreener'), pairAddress: z.string() }).nullable(),
    frozenEvidence: z.object({ status: z.enum(['AVAILABLE', 'UNAVAILABLE']), walletCount: z.number().int(), tradeCount: z.number().int(), previewTruncated: z.boolean(), wallets: z.array(FrozenWallet), trades: z.array(FrozenTrade) }),
    outcomes: z.array(z.object({ horizonHours: z.number().int(), dueAt: At, status: z.enum(['PENDING', 'UNKNOWN', 'MEASURED']), returnPct: z.number().finite().nullable(), priceUsd: Amount, priceAt: At.nullable(), metricId: z.string().nullable(), measuredAt: At.nullable(), reason: z.string().nullable() })),
  })),
});
export const FrozenInvestigationEvidence = z.object({ version: z.literal(1), wallets: z.array(FrozenWallet).max(10000), trades: z.array(FrozenTrade).max(10000) });
export type InvestigationStrategyAnalysis = z.infer<typeof InvestigationStrategies>;
export type InvestigationPublications = z.infer<typeof PublishedInvestigationContext>;
