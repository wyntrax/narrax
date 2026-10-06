import { z } from 'zod';
import { TradingMode } from '@narra/shared';

export const RiskLimitsSchema = z.object({
  maxPerTradeSol: z.number().positive(),
  maxDailyAllocationSol: z.number().positive(),
  maxTokenExposurePct: z.number().min(0).max(100),
  maxOpenPositions: z.number().int().positive(),
  maxDailyLossPct: z.number().min(0).max(100),
  maxDrawdownPct: z.number().min(0).max(100),
  minConfidence: z.number().min(0).max(1),
  minOpportunityScore: z.number().min(0).max(100),
  minConsensusScore: z.number().min(0).max(100),
  minLiquidityUsd: z.number().min(0),
  maxSlippageBps: z.number().int().min(0),
  maxPriceImpactPct: z.number().min(0),
  minSolReserve: z.number().min(0),
  cooldownSeconds: z.number().int().min(0),
  duplicateWindowSeconds: z.number().int().min(0),
});
export type RiskLimits = z.infer<typeof RiskLimitsSchema>;

export const RiskContextSchema = z.object({
  now: z.coerce.date(),
  mode: TradingMode,
  aiAccessEnabled: z.boolean(),
  agentPaused: z.boolean(),
  /** An admin's global stop on new entries. Exits still go through, because they reduce risk. */
  systemPaused: z.boolean().optional(),
  idempotencyKey: z.string().min(8).max(128),
  token: z.object({
    mint: z.string().min(32).max(44),
    blacklisted: z.boolean(),
    liquidityUsd: z.number().min(0),
  }),
  signals: z.object({
    opportunityScore: z.number().min(0).max(100),
    consensusScore: z.number().min(0).max(100),
  }),
  /** Must come from a fresh quote taken right before the check, never from the model. */
  quote: z.object({
    priceImpactPct: z.number().min(0),
    expectedSlippageBps: z.number().min(0),
  }),
  portfolio: z.object({
    totalValueSol: z.number().min(0),
    walletBalanceSol: z.number().min(0),
    openPositions: z.number().int().min(0),
    hasPositionInToken: z.boolean(),
    tokenExposureSol: z.number().min(0),
    allocatedTodaySol: z.number().min(0),
    realizedPnlTodaySol: z.number(),
    drawdownPct: z.number().min(0),
  }),
  history: z.object({
    seenIdempotencyKeys: z.array(z.string()).max(1000),
    lastTradeAtForToken: z.coerce.date().nullable(),
    lastSameOrderAt: z.coerce.date().nullable(),
  }),
});
export type RiskContext = z.infer<typeof RiskContextSchema>;

export type Route = 'REJECT' | 'NO_TRADE' | 'LOG_ONLY' | 'SIMULATE' | 'AWAIT_CONFIRMATION' | 'EXECUTE';

export interface Violation {
  code: string;
  message: string;
}

export interface Adjustment {
  code: string;
  message: string;
}

export interface RiskResult {
  approved: boolean;
  route: Route;
  /** SOL to spend on a BUY, already clamped by limits. 0 for exits and non-trades. */
  sizeSol: number;
  /** Fraction of the open position to sell for REDUCE (0 to 1). 1 for SELL. 0 otherwise. */
  exitFraction: number;
  /** The limits actually enforced, after merging user limits with system limits. */
  maxSlippageBps: number;
  maxPriceImpactPct: number;
  violations: Violation[];
  adjustments: Adjustment[];
}
