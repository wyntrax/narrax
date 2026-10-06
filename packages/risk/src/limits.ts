import type { RiskLimits } from './types';

/** System-wide limits. User profiles can only be stricter than these. */
export const GLOBAL_LIMITS: RiskLimits = {
  maxPerTradeSol: 1,
  maxDailyAllocationSol: 5,
  maxTokenExposurePct: 30,
  maxOpenPositions: 10,
  maxDailyLossPct: 15,
  maxDrawdownPct: 25,
  minConfidence: 0.6,
  minOpportunityScore: 60,
  minConsensusScore: 50,
  minLiquidityUsd: 50_000,
  maxSlippageBps: 300,
  maxPriceImpactPct: 3,
  minSolReserve: 0.05,
  cooldownSeconds: 300,
  duplicateWindowSeconds: 120,
};

const common = { maxDrawdownPct: 25, minConsensusScore: 50, cooldownSeconds: 300, duplicateWindowSeconds: 120 };

export const PROFILES: Record<'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE', RiskLimits> = {
  CONSERVATIVE: {
    ...common, maxPerTradeSol: 0.1, maxDailyAllocationSol: 0.5, maxTokenExposurePct: 10, maxOpenPositions: 3,
    maxDailyLossPct: 5, minConfidence: 0.85, minOpportunityScore: 80, minLiquidityUsd: 200_000,
    maxSlippageBps: 100, maxPriceImpactPct: 1, minSolReserve: 0.1,
  },
  BALANCED: {
    ...common, maxPerTradeSol: 0.25, maxDailyAllocationSol: 1, maxTokenExposurePct: 15, maxOpenPositions: 5,
    maxDailyLossPct: 8, minConfidence: 0.75, minOpportunityScore: 70, minLiquidityUsd: 100_000,
    maxSlippageBps: 150, maxPriceImpactPct: 2, minSolReserve: 0.075,
  },
  AGGRESSIVE: {
    ...common, maxPerTradeSol: 0.5, maxDailyAllocationSol: 2, maxTokenExposurePct: 25, maxOpenPositions: 8,
    maxDailyLossPct: 12, minConfidence: 0.65, minOpportunityScore: 60, minLiquidityUsd: 60_000,
    maxSlippageBps: 250, maxPriceImpactPct: 3, minSolReserve: 0.05,
  },
};

/** For every limit the stricter value wins: caps take the lower number, floors take the higher. */
export function mergeLimits(user: Partial<RiskLimits>, global: RiskLimits = GLOBAL_LIMITS): RiskLimits {
  const u = { ...global, ...user };
  return {
    maxPerTradeSol: Math.min(u.maxPerTradeSol, global.maxPerTradeSol),
    maxDailyAllocationSol: Math.min(u.maxDailyAllocationSol, global.maxDailyAllocationSol),
    maxTokenExposurePct: Math.min(u.maxTokenExposurePct, global.maxTokenExposurePct),
    maxOpenPositions: Math.min(u.maxOpenPositions, global.maxOpenPositions),
    maxDailyLossPct: Math.min(u.maxDailyLossPct, global.maxDailyLossPct),
    maxDrawdownPct: Math.min(u.maxDrawdownPct, global.maxDrawdownPct),
    minConfidence: Math.max(u.minConfidence, global.minConfidence),
    minOpportunityScore: Math.max(u.minOpportunityScore, global.minOpportunityScore),
    minConsensusScore: Math.max(u.minConsensusScore, global.minConsensusScore),
    minLiquidityUsd: Math.max(u.minLiquidityUsd, global.minLiquidityUsd),
    maxSlippageBps: Math.min(u.maxSlippageBps, global.maxSlippageBps),
    maxPriceImpactPct: Math.min(u.maxPriceImpactPct, global.maxPriceImpactPct),
    minSolReserve: Math.max(u.minSolReserve, global.minSolReserve),
    cooldownSeconds: Math.max(u.cooldownSeconds, global.cooldownSeconds),
    duplicateWindowSeconds: Math.max(u.duplicateWindowSeconds, global.duplicateWindowSeconds),
  };
}
