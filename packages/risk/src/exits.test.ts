import { describe, expect, it } from 'vitest';
import type { AgentDecision } from '@narra/shared';
import { GLOBAL_LIMITS, PROFILES, evaluateRisk, mergeLimits, type RiskContext } from './index';

const NOW = new Date('2026-10-03T12:00:00Z');
const decision = (over: Partial<AgentDecision> = {}): AgentDecision => ({
  action: 'BUY', confidence: 0.9, reasonCodes: [], positiveSignals: [], negativeSignals: [], risks: [], suggestedPositionSizePct: 2,
  entry: { maxSlippageBps: 100, maxPriceImpactPct: 1.5 }, exit: { stopLossPct: null, takeProfitPct: null, trailingStopPct: null },
  invalidationConditions: [], summary: '', ...over,
});
const ctx = (portfolio: Partial<RiskContext['portfolio']> = {}, over: Partial<RiskContext> = {}): RiskContext => ({
  now: NOW, mode: 'PAPER', aiAccessEnabled: true, agentPaused: false, idempotencyKey: 'order-0001-abcd',
  token: { mint: 'So11111111111111111111111111111111111111112', blacklisted: false, liquidityUsd: 600_000 }, signals: { opportunityScore: 90, consensusScore: 80 },
  quote: { priceImpactPct: 0.5, expectedSlippageBps: 50 },
  portfolio: { totalValueSol: 20, walletBalanceSol: 10, openPositions: 1, hasPositionInToken: false, tokenExposureSol: 0, allocatedTodaySol: 0, realizedPnlTodaySol: 0, drawdownPct: 0, ...portfolio },
  history: { seenIdempotencyKeys: [], lastTradeAtForToken: null, lastSameOrderAt: null }, ...over,
});
const codes = (r: ReturnType<typeof evaluateRisk>) => r.violations.map((v) => v.code);

describe('loss limits block buys but never exits', () => {
  const lossy = { realizedPnlTodaySol: -2, hasPositionInToken: true }; // 10% of 20 SOL, BALANCED allows 8%
  const drawn = { drawdownPct: 40, hasPositionInToken: true };

  it('a daily-loss breach blocks a BUY and lets a SELL and a REDUCE through', () => {
    expect(codes(evaluateRisk(decision(), ctx({ ...lossy, hasPositionInToken: false }), PROFILES.BALANCED))).toContain('DAILY_LOSS_LIMIT');
    const sell = evaluateRisk(decision({ action: 'SELL' }), ctx(lossy), PROFILES.BALANCED);
    expect(sell).toMatchObject({ approved: true, route: 'SIMULATE', exitFraction: 1 });
    const reduce = evaluateRisk(decision({ action: 'REDUCE', suggestedPositionSizePct: 50 }), ctx(lossy), PROFILES.BALANCED);
    expect(reduce).toMatchObject({ approved: true, route: 'SIMULATE', exitFraction: 0.5 });
  });
  it('a drawdown breach blocks a BUY and lets exits through', () => {
    expect(codes(evaluateRisk(decision(), ctx({ ...drawn, hasPositionInToken: false }), PROFILES.BALANCED))).toContain('DRAWDOWN_LIMIT');
    expect(evaluateRisk(decision({ action: 'SELL' }), ctx(drawn), PROFILES.BALANCED).approved).toBe(true);
    expect(evaluateRisk(decision({ action: 'REDUCE', suggestedPositionSizePct: 50 }), ctx(drawn), PROFILES.BALANCED).approved).toBe(true);
  });
  it('both breached at once still lets an exit through', () => {
    expect(evaluateRisk(decision({ action: 'SELL' }), ctx({ ...lossy, ...drawn }), PROFILES.BALANCED).approved).toBe(true);
  });
  it('exits are still stopped by the things that make an exit unsafe or unwanted', () => {
    const sell = decision({ action: 'SELL' });
    expect(codes(evaluateRisk(sell, ctx(lossy, { agentPaused: true }), PROFILES.BALANCED))).toContain('AGENT_PAUSED');
    expect(codes(evaluateRisk(sell, ctx(lossy, { quote: { priceImpactPct: 9, expectedSlippageBps: 50 } }), PROFILES.BALANCED))).toContain('PRICE_IMPACT_TOO_HIGH');
    expect(codes(evaluateRisk(sell, ctx({ hasPositionInToken: false }), PROFILES.BALANCED))).toContain('NO_POSITION');
    expect(codes(evaluateRisk(sell, ctx(lossy, { mode: 'SEMI_AUTO', aiAccessEnabled: false }), PROFILES.BALANCED))).toContain('AI_ACCESS_DISABLED');
  });
});

describe('user limits can only be stricter', () => {
  it('a stricter per-trade cap lowers the size', () => {
    const r = evaluateRisk(decision({ suggestedPositionSizePct: 50 }), ctx(), { ...PROFILES.BALANCED, maxPerTradeSol: 0.1 });
    expect(r.sizeSol).toBeCloseTo(0.1);
  });
  it('a looser limit is clamped to the system limit', () => {
    const r = evaluateRisk(decision({ suggestedPositionSizePct: 90 }), ctx({ totalValueSol: 100, walletBalanceSol: 100, tokenExposureSol: 0 }), { maxPerTradeSol: 50, maxTokenExposurePct: 100, maxDailyAllocationSol: 100 });
    expect(r.sizeSol).toBeLessThanOrEqual(GLOBAL_LIMITS.maxPerTradeSol);
    const merged = mergeLimits({ maxSlippageBps: 5000, minConfidence: 0.1, minSolReserve: 0, maxDailyLossPct: 99 });
    expect(merged).toMatchObject({ maxSlippageBps: GLOBAL_LIMITS.maxSlippageBps, minConfidence: GLOBAL_LIMITS.minConfidence, minSolReserve: GLOBAL_LIMITS.minSolReserve, maxDailyLossPct: GLOBAL_LIMITS.maxDailyLossPct });
  });
  it('a stricter confidence floor rejects a decision the system limit would accept', () => {
    const d = decision({ confidence: 0.7 });
    expect(evaluateRisk(d, ctx(), { minConfidence: 0.65 }).approved).toBe(true);
    expect(codes(evaluateRisk(d, ctx(), { minConfidence: 0.9 }))).toContain('CONFIDENCE_TOO_LOW');
  });
  it('a looser confidence floor than the system limit does not let a weak decision through', () => {
    expect(codes(evaluateRisk(decision({ confidence: 0.5 }), ctx(), { minConfidence: 0.1 }))).toContain('CONFIDENCE_TOO_LOW');
  });
});

describe('AI access and paper mode', () => {
  it('a paper BUY needs AI access, so a job queued before revocation cannot open a paper position', () => {
    expect(codes(evaluateRisk(decision(), ctx({}, { mode: 'PAPER', aiAccessEnabled: false }), PROFILES.BALANCED))).toContain('AI_ACCESS_DISABLED');
  });
  it('a paper exit does not, and SHADOW never does', () => {
    expect(evaluateRisk(decision({ action: 'SELL' }), ctx({ hasPositionInToken: true }, { mode: 'PAPER', aiAccessEnabled: false }), PROFILES.BALANCED).approved).toBe(true);
    expect(evaluateRisk(decision(), ctx({}, { mode: 'SHADOW', aiAccessEnabled: false }), PROFILES.BALANCED).approved).toBe(true);
  });
});
