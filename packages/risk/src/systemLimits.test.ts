import { describe, expect, it } from 'vitest';
import type { AgentDecision } from '@narra/shared';
import { GLOBAL_LIMITS, PROFILES, SYSTEM_LIMIT_FIELDS, SYSTEM_LIMIT_RULES, checkLimit, evaluateRisk, resolveSystemLimits, validateSystemLimitsInput, type RiskContext } from './index';

describe('system limits an admin may set', () => {
  it('has a rule for every limit, so none can be forgotten', () => {
    expect(SYSTEM_LIMIT_FIELDS.sort()).toEqual(Object.keys(GLOBAL_LIMITS).sort());
  });
  it('the code values are inside their own range, so leaving a limit alone is always allowed', () => {
    for (const f of SYSTEM_LIMIT_FIELDS) expect(checkLimit(f, GLOBAL_LIMITS[f]), f).toBeNull();
  });
  it('allows stricter and refuses looser than the code, for caps and for floors', () => {
    expect(checkLimit('maxPerTradeSol', 0.5)).toBeNull();
    expect(checkLimit('maxPerTradeSol', 1.0001)).toBe('LOOSER_THAN_CODE_CEILING');
    expect(checkLimit('maxOpenPositions', 11)).toBe('LOOSER_THAN_CODE_CEILING');
    expect(checkLimit('minConfidence', 0.8)).toBeNull();
    expect(checkLimit('minConfidence', 0.59)).toBe('LOOSER_THAN_CODE_CEILING');
    expect(checkLimit('minLiquidityUsd', 10_000)).toBe('LOOSER_THAN_CODE_CEILING');
    expect(checkLimit('cooldownSeconds', 60)).toBe('LOOSER_THAN_CODE_CEILING');
  });
  it('refuses values so strict they would switch trading off by accident', () => {
    expect(checkLimit('maxPerTradeSol', 0)).toBe('STRICTER_THAN_ALLOWED');
    expect(checkLimit('maxPerTradeSol', -1)).toBe('STRICTER_THAN_ALLOWED');
    expect(checkLimit('minConfidence', 1)).toBe('STRICTER_THAN_ALLOWED');
    expect(checkLimit('minOpportunityScore', 100)).toBe('STRICTER_THAN_ALLOWED');
    expect(checkLimit('maxOpenPositions', 0)).toBe('STRICTER_THAN_ALLOWED');
  });
  it('refuses non-numbers, non-integers and unknown fields, including prototype names', () => {
    for (const v of ['1', null, undefined, NaN, Infinity, {}, [], true]) expect(checkLimit('maxPerTradeSol', v), String(v)).toBe('NOT_A_NUMBER');
    expect(checkLimit('maxOpenPositions', 3.5)).toBe('NOT_INTEGER');
    for (const f of ['apiKey', '__proto__', 'constructor', 'toString', '']) expect(checkLimit(f, 1), f).toBe('UNKNOWN_FIELD');
  });
  it('validates a whole submission and reports every problem', () => {
    expect(validateSystemLimitsInput({ maxPerTradeSol: 0.5, minConfidence: 0.8 })).toEqual({ ok: true, value: { maxPerTradeSol: 0.5, minConfidence: 0.8 } });
    expect(validateSystemLimitsInput({})).toEqual({ ok: true, value: {} });
    const bad = validateSystemLimitsInput({ maxPerTradeSol: 5, nope: 1, minConfidence: 0.1 });
    expect(bad).toEqual({ ok: false, errors: [{ field: 'maxPerTradeSol', code: 'LOOSER_THAN_CODE_CEILING' }, { field: 'nope', code: 'UNKNOWN_FIELD' }, { field: 'minConfidence', code: 'LOOSER_THAN_CODE_CEILING' }] });
    for (const v of [null, [], 'x', 5]) expect(validateSystemLimitsInput(v).ok).toBe(false);
  });
});

describe('resolving what is stored', () => {
  it('no setting means the code defaults', () => {
    for (const stored of [undefined, null]) expect(resolveSystemLimits(stored)).toEqual({ limits: GLOBAL_LIMITS, overrides: {}, invalid: [] });
  });
  it('applies valid overrides on top of the code defaults', () => {
    const r = resolveSystemLimits({ maxPerTradeSol: 0.2, minConfidence: 0.8 });
    expect(r.limits).toMatchObject({ ...GLOBAL_LIMITS, maxPerTradeSol: 0.2, minConfidence: 0.8 });
    expect(r.overrides).toEqual({ maxPerTradeSol: 0.2, minConfidence: 0.8 });
  });
  it('a damaged or tampered setting can never loosen the system: bad fields fall back to the code and are listed', () => {
    const r = resolveSystemLimits({ maxPerTradeSol: 99, minConfidence: 0.01, maxDailyLossPct: '50', apiKey: 'x', maxOpenPositions: 4 });
    expect(r.limits).toMatchObject({ ...GLOBAL_LIMITS, maxOpenPositions: 4 });
    expect(r.invalid.sort()).toEqual(['apiKey', 'maxDailyLossPct', 'maxPerTradeSol', 'minConfidence']);
    for (const f of SYSTEM_LIMIT_FIELDS) {
      const rule = SYSTEM_LIMIT_RULES[f];
      if (rule.kind === 'cap') expect(r.limits[f], f).toBeLessThanOrEqual(GLOBAL_LIMITS[f]); else expect(r.limits[f], f).toBeGreaterThanOrEqual(GLOBAL_LIMITS[f]);
    }
    for (const junk of ['text', 5, true, [1, 2]]) expect(resolveSystemLimits(junk)).toEqual({ limits: GLOBAL_LIMITS, overrides: {}, invalid: ['(whole setting)'] });
  });
});

const NOW = new Date('2026-10-05T12:00:00Z');
const decision = (over: Partial<AgentDecision> = {}): AgentDecision => ({
  action: 'BUY', confidence: 0.9, reasonCodes: [], positiveSignals: [], negativeSignals: [], risks: [], suggestedPositionSizePct: 50,
  entry: { maxSlippageBps: 100, maxPriceImpactPct: 1.5 }, exit: { stopLossPct: null, takeProfitPct: null, trailingStopPct: null }, invalidationConditions: [], summary: '', ...over,
});
const ctx = (over: Partial<RiskContext> = {}, portfolio: Partial<RiskContext['portfolio']> = {}): RiskContext => ({
  now: NOW, mode: 'PAPER', aiAccessEnabled: true, agentPaused: false, idempotencyKey: 'order-0001-abcd',
  token: { mint: 'So11111111111111111111111111111111111111112', blacklisted: false, liquidityUsd: 600_000 }, signals: { opportunityScore: 90, consensusScore: 80 }, quote: { priceImpactPct: 0.5, expectedSlippageBps: 50 },
  portfolio: { totalValueSol: 20, walletBalanceSol: 10, openPositions: 1, hasPositionInToken: false, tokenExposureSol: 0, allocatedTodaySol: 0, realizedPnlTodaySol: 0, drawdownPct: 0, ...portfolio },
  history: { seenIdempotencyKeys: [], lastTradeAtForToken: null, lastSameOrderAt: null }, ...over,
});
const codes = (r: ReturnType<typeof evaluateRisk>) => r.violations.map((v) => v.code);

describe('the Governor with admin-set system limits and the global pause', () => {
  it('an admin-lowered system cap applies to every user, including one whose own limit is looser', () => {
    const sys = resolveSystemLimits({ maxPerTradeSol: 0.05 }).limits;
    const r = evaluateRisk(decision(), ctx(), { ...PROFILES.AGGRESSIVE }, sys);
    expect(r.sizeSol).toBeLessThanOrEqual(0.05 + 1e-9);
    expect(evaluateRisk(decision(), ctx(), { ...PROFILES.AGGRESSIVE }).sizeSol).toBeGreaterThan(0.05); // without it
  });
  it('an admin-raised floor rejects a decision the code defaults would accept', () => {
    const sys = resolveSystemLimits({ minConfidence: 0.95 }).limits;
    expect(evaluateRisk(decision({ confidence: 0.9 }), ctx(), {}).approved).toBe(true);
    expect(codes(evaluateRisk(decision({ confidence: 0.9 }), ctx(), {}, sys))).toContain('CONFIDENCE_TOO_LOW');
  });
  it('a tampered stored value cannot loosen the Governor', () => {
    const sys = resolveSystemLimits({ maxPerTradeSol: 500, minConfidence: 0.01 }).limits;
    expect(sys.maxPerTradeSol).toBe(GLOBAL_LIMITS.maxPerTradeSol);
    expect(codes(evaluateRisk(decision({ confidence: 0.5 }), ctx(), {}, sys))).toContain('CONFIDENCE_TOO_LOW');
  });
  it('the global pause stops new entries in every mode, and lets exits through', () => {
    for (const mode of ['SHADOW', 'PAPER', 'SEMI_AUTO', 'AUTO'] as const) {
      expect(codes(evaluateRisk(decision(), ctx({ mode, systemPaused: true }), {})), mode).toContain('SYSTEM_PAUSED');
    }
    for (const action of ['SELL', 'REDUCE'] as const) {
      const r = evaluateRisk(decision({ action, suggestedPositionSizePct: 50 }), ctx({ systemPaused: true }, { hasPositionInToken: true }), {});
      expect(r.approved, action).toBe(true);
    }
    expect(evaluateRisk(decision(), ctx({ systemPaused: false }), {}).approved).toBe(true);
    expect(evaluateRisk(decision(), ctx(), {}).approved).toBe(true); // the field is optional
  });
});
