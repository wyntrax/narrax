import { describe, expect, it } from 'vitest';
import type { AgentDecision } from '@narra/shared';
import { evaluateRisk } from './governor';
import { PROFILES } from './limits';
import type { RiskContext } from './types';

const decision = (over: Partial<AgentDecision> = {}): AgentDecision => ({
  action: 'BUY', confidence: 0.88, reasonCodes: ['SMART_MONEY_CONSENSUS'], positiveSignals: [], negativeSignals: [], risks: [],
  suggestedPositionSizePct: 2,
  entry: { maxSlippageBps: 100, maxPriceImpactPct: 1.5 },
  exit: { stopLossPct: 25, takeProfitPct: 50, trailingStopPct: 15 },
  invalidationConditions: [], summary: 'test', ...over,
});

const ctx = (over: Partial<RiskContext> = {}): RiskContext => ({
  now: new Date('2026-09-30T10:00:00Z'), mode: 'AUTO', aiAccessEnabled: true, agentPaused: false, idempotencyKey: 'key-0001-abcd',
  token: { mint: '7xKqExampleMintAddress1111111111111111111', blacklisted: false, liquidityUsd: 681_000 },
  signals: { opportunityScore: 91, consensusScore: 84 },
  quote: { priceImpactPct: 0.4, expectedSlippageBps: 40 },
  portfolio: { totalValueSol: 20, walletBalanceSol: 10, openPositions: 1, hasPositionInToken: false, tokenExposureSol: 0, allocatedTodaySol: 0, realizedPnlTodaySol: 0, drawdownPct: 0 },
  history: { seenIdempotencyKeys: [], lastTradeAtForToken: null, lastSameOrderAt: null },
  ...over,
});

const codes = (r: ReturnType<typeof evaluateRisk>) => r.violations.map((v) => v.code);
const P = PROFILES.BALANCED;

describe('Risk Governor', () => {
  it('approves a good BUY and routes it by mode', () => {
    const r = evaluateRisk(decision(), ctx(), P);
    expect(r.approved).toBe(true);
    expect(r.route).toBe('EXECUTE');
    expect(r.sizeSol).toBeCloseTo(0.25); // 2% of 20 SOL is 0.4, clamped to the 0.25 per-trade cap
    expect(r.adjustments[0]?.code).toBe('SIZE_CLAMPED');
    expect(evaluateRisk(decision(), ctx({ mode: 'SHADOW' }), P).route).toBe('LOG_ONLY');
    expect(evaluateRisk(decision(), ctx({ mode: 'PAPER' }), P).route).toBe('SIMULATE');
    expect(evaluateRisk(decision(), ctx({ mode: 'SEMI_AUTO' }), P).route).toBe('AWAIT_CONFIRMATION');
  });

  it('does not treat WATCH, HOLD or IGNORE as trades', () => {
    for (const action of ['WATCH', 'HOLD', 'IGNORE'] as const) {
      const r = evaluateRisk(decision({ action }), ctx({ agentPaused: true }), P);
      expect(r.route).toBe('NO_TRADE');
      expect(r.approved).toBe(true);
    }
  });

  it('rejects low confidence, weak signals and thin liquidity', () => {
    const r = evaluateRisk(
      decision({ confidence: 0.5 }),
      ctx({ signals: { opportunityScore: 40, consensusScore: 20 }, token: { mint: '7xKqExampleMintAddress1111111111111111111', blacklisted: false, liquidityUsd: 1000 } }),
      P,
    );
    expect(r.route).toBe('REJECT');
    expect(codes(r)).toEqual(expect.arrayContaining(['CONFIDENCE_TOO_LOW', 'OPPORTUNITY_TOO_LOW', 'CONSENSUS_TOO_LOW', 'LIQUIDITY_TOO_LOW']));
    expect(r.sizeSol).toBe(0);
  });

  it('never lets user limits exceed system limits', () => {
    const greedy = { ...P, maxPerTradeSol: 50, minConfidence: 0.1 };
    const r = evaluateRisk(decision({ confidence: 0.5, suggestedPositionSizePct: 50 }), ctx(), greedy);
    expect(codes(r)).toContain('CONFIDENCE_TOO_LOW'); // system floor is 0.6
    const ok = evaluateRisk(decision({ suggestedPositionSizePct: 50 }), ctx(), greedy);
    expect(ok.sizeSol).toBeLessThanOrEqual(1); // system cap is 1 SOL
  });

  it('lets the model tighten execution parameters but not loosen them', () => {
    const loose = evaluateRisk(decision({ entry: { maxSlippageBps: 5000, maxPriceImpactPct: 50 } }), ctx({ quote: { priceImpactPct: 2.5, expectedSlippageBps: 200 } }), P);
    expect(codes(loose)).toEqual(expect.arrayContaining(['SLIPPAGE_TOO_HIGH', 'PRICE_IMPACT_TOO_HIGH']));
    const tight = evaluateRisk(decision({ entry: { maxSlippageBps: 20, maxPriceImpactPct: 0.1 } }), ctx(), P);
    expect(codes(tight)).toEqual(expect.arrayContaining(['SLIPPAGE_TOO_HIGH', 'PRICE_IMPACT_TOO_HIGH']));
  });

  it('blocks blacklisted tokens, duplicates, cooldowns and a paused agent', () => {
    const base = ctx().token;
    expect(codes(evaluateRisk(decision(), ctx({ token: { ...base, blacklisted: true } }), P))).toContain('TOKEN_BLACKLISTED');
    expect(codes(evaluateRisk(decision(), ctx({ history: { seenIdempotencyKeys: ['key-0001-abcd'], lastTradeAtForToken: null, lastSameOrderAt: null } }), P))).toContain('DUPLICATE_ORDER');
    expect(codes(evaluateRisk(decision(), ctx({ history: { seenIdempotencyKeys: [], lastTradeAtForToken: new Date('2026-09-30T09:58:00Z'), lastSameOrderAt: null } }), P))).toContain('COOLDOWN_ACTIVE');
    expect(codes(evaluateRisk(decision(), ctx({ agentPaused: true }), P))).toContain('AGENT_PAUSED');
  });

  it('requires AI access for semi-auto and auto modes', () => {
    expect(codes(evaluateRisk(decision(), ctx({ aiAccessEnabled: false }), P))).toContain('AI_ACCESS_DISABLED');
    expect(evaluateRisk(decision(), ctx({ aiAccessEnabled: false, mode: 'SHADOW' }), P).approved).toBe(true);
  });

  it('enforces the SOL reserve, daily allocation, exposure and position count', () => {
    const p = ctx().portfolio;
    expect(codes(evaluateRisk(decision(), ctx({ portfolio: { ...p, walletBalanceSol: 0.05 } }), P))).toContain('INSUFFICIENT_BALANCE');
    expect(codes(evaluateRisk(decision(), ctx({ portfolio: { ...p, allocatedTodaySol: 1 } }), P))).toContain('DAILY_ALLOCATION_EXCEEDED');
    expect(codes(evaluateRisk(decision(), ctx({ portfolio: { ...p, tokenExposureSol: 3, hasPositionInToken: true } }), P))).toContain('TOKEN_EXPOSURE_EXCEEDED');
    expect(codes(evaluateRisk(decision(), ctx({ portfolio: { ...p, openPositions: 5 } }), P))).toContain('MAX_OPEN_POSITIONS');
  });

  it('stops new entries after the daily loss limit or drawdown limit', () => {
    const p = ctx().portfolio;
    expect(codes(evaluateRisk(decision(), ctx({ portfolio: { ...p, realizedPnlTodaySol: -2 } }), P))).toContain('DAILY_LOSS_LIMIT');
    expect(codes(evaluateRisk(decision(), ctx({ portfolio: { ...p, drawdownPct: 30 } }), P))).toContain('DRAWDOWN_LIMIT');
  });

  it('still allows exits when entry limits are breached, but checks execution quality', () => {
    const p = ctx().portfolio;
    const breached = ctx({ portfolio: { ...p, hasPositionInToken: true, drawdownPct: 40, walletBalanceSol: 0.01 }, signals: { opportunityScore: 5, consensusScore: 5 } });
    const sell = evaluateRisk(decision({ action: 'SELL', confidence: 0.2 }), breached, P);
    expect(sell.approved).toBe(true);
    expect(sell.exitFraction).toBe(1);
    const reduce = evaluateRisk(decision({ action: 'REDUCE', suggestedPositionSizePct: 50 }), breached, P);
    expect(reduce.exitFraction).toBe(0.5);
    const bad = evaluateRisk(decision({ action: 'SELL' }), { ...breached, quote: { priceImpactPct: 9, expectedSlippageBps: 900 } }, P);
    expect(codes(bad)).toEqual(expect.arrayContaining(['SLIPPAGE_TOO_HIGH', 'PRICE_IMPACT_TOO_HIGH']));
    expect(codes(evaluateRisk(decision({ action: 'SELL' }), ctx(), P))).toContain('NO_POSITION');
  });
});
