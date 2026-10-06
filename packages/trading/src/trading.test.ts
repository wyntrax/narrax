import { describe, expect, it } from 'vitest';
import { AgentDecisionSchema } from '@narra/shared';
import {
  CONFIRMATION_TTL_MS, EXIT_RETRY_COOLDOWN_MS, MAX_DECISION_AGE_MS, MAX_EVALUATION_AGE_MS, MAX_EXIT_ATTEMPTS, MAX_REDUCES_PER_POSITION, PAPER_FEE_SOL,
  PaperFillError, buildExitDecision, canClaim, canRetryExit, checkEligibility, confirmationExpiry, effectiveStatus, entryKey, exitKey, isDecisionFresh,
  paperBalance, paperBuyFill, paperPortfolioValue, paperSellFill, sellUnits, shouldActOnEvaluation, signalCodesOf, tradableBalance, type PermissionFacts,
} from './index';

const NOW = new Date('2026-10-03T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const perm = (o: Partial<PermissionFacts> = {}): PermissionFacts => ({ aiTradingEnabled: true, agentPaused: false, revokedAt: null, delegatedUntil: null, ...o });

describe('eligibility', () => {
  it('a paused agent stops every mode, SHADOW included', () => {
    for (const mode of ['SHADOW', 'PAPER', 'SEMI_AUTO', 'AUTO'] as const) {
      expect(checkEligibility(mode, perm({ agentPaused: true }), NOW)).toEqual({ eligible: false, reason: 'AGENT_PAUSED' });
    }
  });
  it('revoked AI access stops every mode', () => {
    for (const mode of ['SHADOW', 'PAPER', 'SEMI_AUTO', 'AUTO'] as const) {
      expect(checkEligibility(mode, perm({ revokedAt: ago(1000), aiTradingEnabled: false }), NOW)).toEqual({ eligible: false, reason: 'AI_ACCESS_REVOKED' });
    }
  });
  it('SHADOW needs no AI access, and a user with no permission row can only be SHADOW', () => {
    expect(checkEligibility('SHADOW', null, NOW).eligible).toBe(true);
    expect(checkEligibility('SHADOW', perm({ aiTradingEnabled: false }), NOW).eligible).toBe(true);
    for (const mode of ['PAPER', 'SEMI_AUTO', 'AUTO'] as const) expect(checkEligibility(mode, null, NOW)).toEqual({ eligible: false, reason: 'AI_ACCESS_OFF' });
    expect(checkEligibility('PAPER', perm({ aiTradingEnabled: false }), NOW)).toEqual({ eligible: false, reason: 'AI_ACCESS_OFF' });
  });
  it('an expired delegation stops SEMI_AUTO and AUTO but not PAPER; no expiry means no expiry', () => {
    const expired = perm({ delegatedUntil: ago(1) });
    expect(checkEligibility('SEMI_AUTO', expired, NOW)).toEqual({ eligible: false, reason: 'DELEGATION_EXPIRED' });
    expect(checkEligibility('AUTO', expired, NOW)).toEqual({ eligible: false, reason: 'DELEGATION_EXPIRED' });
    expect(checkEligibility('PAPER', expired, NOW).eligible).toBe(true);
    expect(checkEligibility('AUTO', perm({ delegatedUntil: null }), NOW).eligible).toBe(true);
    expect(checkEligibility('AUTO', perm({ delegatedUntil: new Date(NOW.getTime() + 1000) }), NOW).eligible).toBe(true);
  });
});

describe('decision freshness', () => {
  it('accepts up to the limit and rejects older or future decisions', () => {
    expect(isDecisionFresh(ago(MAX_DECISION_AGE_MS), NOW)).toBe(true);
    expect(isDecisionFresh(ago(MAX_DECISION_AGE_MS + 1), NOW)).toBe(false);
    expect(isDecisionFresh(new Date(NOW.getTime() + 1), NOW)).toBe(false);
    expect(isDecisionFresh(new Date('nope'), NOW)).toBe(false);
  });
  it('tradable balance is the balance less the reserve', () => {
    expect(tradableBalance(1, 0.075)).toBeCloseTo(0.925);
    expect(tradableBalance(0.05, 0.075)).toBeLessThan(0);
  });
  it('keys come from the ids, so the same decision and user give the same key', () => {
    expect(entryKey('d1', 'u1')).toBe(entryKey('d1', 'u1'));
    expect(entryKey('d1', 'u1')).not.toBe(entryKey('d1', 'u2'));
    expect(exitKey('e1', 1)).not.toBe(exitKey('e1', 2));
  });
});

describe('paper buy', () => {
  const quote = { outAmount: '5000000', priceImpactPct: 1.5 };
  it('worsens the market price by the price impact and charges the fee constant', () => {
    const f = paperBuyFill({ sizeSol: 0.5, marketPriceUsd: 0.001, quote });
    expect(f.baseUnits).toBe('5000000');
    expect(f.expectedPriceUsd).toBe(0.001);
    expect(f.fillPriceUsd).toBeCloseTo(0.001015, 9);
    expect(f.slippageBps).toBeCloseTo(150);
    expect(f.feeSol).toBe(PAPER_FEE_SOL);
    expect(f.cashDeltaSol).toBeCloseTo(-(0.5 + PAPER_FEE_SOL), 9);
    expect(f.realizedPnlSol).toBeCloseTo(-PAPER_FEE_SOL, 9);
  });
  it('fails closed on anything it cannot compute', () => {
    const base = { sizeSol: 0.5, marketPriceUsd: 0.001, quote };
    expect(() => paperBuyFill({ ...base, sizeSol: 0 })).toThrow(PaperFillError);
    expect(() => paperBuyFill({ ...base, marketPriceUsd: NaN })).toThrow(PaperFillError);
    expect(() => paperBuyFill({ ...base, quote: { ...quote, priceImpactPct: -1 } })).toThrow(PaperFillError);
    expect(() => paperBuyFill({ ...base, quote: { ...quote, outAmount: '1.5' } })).toThrow(PaperFillError);
    expect(() => paperBuyFill({ ...base, quote: { ...quote, outAmount: '0' } })).toThrow(PaperFillError);
  });
});

describe('paper sell', () => {
  const position = { baseUnits: '1000000', costSol: 0.5 };
  it('a partial sell books the matching share of the cost basis', () => {
    const f = paperSellFill({ position, exitFraction: 0.5, marketPriceUsd: 0.002, quote: { inAmount: '500000', outAmount: '400000000', priceImpactPct: 2 } });
    expect(f.unitsSold).toBe('500000');
    expect(f.remainingUnits).toBe('500000');
    expect(f.costSoldSol).toBeCloseTo(0.25, 9);
    expect(f.remainingCostSol).toBeCloseTo(0.25, 9);
    expect(f.proceedsSol).toBeCloseTo(0.4, 9);
    expect(f.realizedPnlSol).toBeCloseTo(0.4 - 0.25 - PAPER_FEE_SOL, 9);
    expect(f.fillPriceUsd).toBeCloseTo(0.00196, 9);
    expect(f.closes).toBe(false);
  });
  it('a full sell closes the position and uses the whole remaining cost, with no rounding drift', () => {
    const f = paperSellFill({ position: { baseUnits: '3', costSol: 0.1 }, exitFraction: 1, marketPriceUsd: 1, quote: { inAmount: '3', outAmount: '50000000', priceImpactPct: 0 } });
    expect(f.closes).toBe(true);
    expect(f.costSoldSol).toBe(0.1);
    expect(f.remainingCostSol).toBe(0);
    expect(f.remainingUnits).toBe('0');
  });
  it('round trip: realized PnL over buy and sell equals the change in cash', () => {
    const buy = paperBuyFill({ sizeSol: 0.5, marketPriceUsd: 0.001, quote: { outAmount: '1000000', priceImpactPct: 1 } });
    const sell = paperSellFill({ position: { baseUnits: buy.baseUnits, costSol: buy.sizeSol }, exitFraction: 1, marketPriceUsd: 0.0007, quote: { inAmount: '1000000', outAmount: '300000000', priceImpactPct: 1 } });
    expect(buy.realizedPnlSol + sell.realizedPnlSol).toBeCloseTo(buy.cashDeltaSol + sell.cashDeltaSol, 9);
    expect(buy.realizedPnlSol + sell.realizedPnlSol).toBeCloseTo(0.3 - 0.5 - 2 * PAPER_FEE_SOL, 9);
  });
  it('rounds the units down like the quote request does, and refuses a quote for other units', () => {
    expect(sellUnits('3', 0.5)).toBe(1n);
    expect(() => paperSellFill({ position, exitFraction: 0.5, marketPriceUsd: 1, quote: { inAmount: '499999', outAmount: '1', priceImpactPct: 0 } })).toThrow('not for the units');
    expect(() => paperSellFill({ position, exitFraction: 0, marketPriceUsd: 1, quote: { inAmount: '0', outAmount: '1', priceImpactPct: 0 } })).toThrow(PaperFillError);
    expect(() => paperSellFill({ position: { baseUnits: '1', costSol: 1 }, exitFraction: 0.1, marketPriceUsd: 1, quote: { inAmount: '0', outAmount: '1', priceImpactPct: 0 } })).toThrow('rounds to zero');
  });
});

describe('paper ledger math', () => {
  it('balance is start minus buys plus sells, fees on both sides', () => {
    expect(paperBalance({ startSol: 10, buys: { amountSol: 1, feeSol: 0.004 }, sells: { amountSol: 0.6, feeSol: 0.002 } })).toBeCloseTo(10 - 1.004 + 0.598, 9);
  });
  it('portfolio value marks positions by price over entry price and never treats a missing price as zero', () => {
    expect(paperPortfolioValue(9, [{ costSol: 0.5, entryPriceUsd: 1, priceUsd: 2 }, { costSol: 0.5, entryPriceUsd: 1, priceUsd: 0.5 }])).toBeCloseTo(9 + 1 + 0.25, 9);
    expect(() => paperPortfolioValue(9, [{ costSol: 0.5, entryPriceUsd: 1, priceUsd: null }])).toThrow(PaperFillError);
    expect(paperPortfolioValue(9, [])).toBe(9);
  });
});

describe('exit rules', () => {
  const sig = (...codes: string[]) => codes.map((code) => ({ code, level: 'REDUCE', detail: 'x' }));
  const ev = (action: string, codes: string[], age = 1000, fractionPct = 50) => ({ action, fractionPct, signals: sig(...codes), createdAt: ago(age) });
  const fresh = { reducedForCodes: [] as string[], reduceCount: 0 };

  it('reads only clean signal codes', () => {
    expect(signalCodesOf([{ code: 'TAKE_PROFIT' }, { code: 'bad code' }, { code: 5 }, null, { code: 'TAKE_PROFIT' }])).toEqual(['TAKE_PROFIT']);
    expect(signalCodesOf('nope')).toEqual([]);
  });
  it('a take-profit REDUCE acts once and then not again for the same condition', () => {
    const first = shouldActOnEvaluation(ev('REDUCE', ['TAKE_PROFIT']), fresh, NOW);
    expect(first).toEqual({ act: true, codes: ['TAKE_PROFIT'] });
    const after = { reducedForCodes: ['TAKE_PROFIT'], reduceCount: 1 };
    expect(shouldActOnEvaluation(ev('REDUCE', ['TAKE_PROFIT']), after, NOW)).toEqual({ act: false, reason: 'ALREADY_REDUCED' });
  });
  it('a REDUCE with a new code acts again, up to the cap', () => {
    const after = { reducedForCodes: ['TAKE_PROFIT'], reduceCount: 1 };
    expect(shouldActOnEvaluation(ev('REDUCE', ['TAKE_PROFIT', 'LIQUIDITY_DROP']), after, NOW).act).toBe(true);
    const capped = { reducedForCodes: ['TAKE_PROFIT'], reduceCount: MAX_REDUCES_PER_POSITION };
    expect(shouldActOnEvaluation(ev('REDUCE', ['LIQUIDITY_DROP']), capped, NOW)).toEqual({ act: false, reason: 'REDUCE_CAP' });
  });
  it('a SELL always acts, even after reduces for the same codes', () => {
    const state = { reducedForCodes: ['STOP_LOSS'], reduceCount: MAX_REDUCES_PER_POSITION };
    expect(shouldActOnEvaluation(ev('SELL', ['STOP_LOSS']), state, NOW)).toEqual({ act: true, codes: ['STOP_LOSS'] });
  });
  it('ignores HOLD, stale and future evaluations', () => {
    expect(shouldActOnEvaluation(ev('HOLD', []), fresh, NOW)).toEqual({ act: false, reason: 'NOT_AN_EXIT' });
    expect(shouldActOnEvaluation(ev('SELL', ['X1'], MAX_EVALUATION_AGE_MS + 1), fresh, NOW)).toEqual({ act: false, reason: 'EVALUATION_STALE' });
    expect(shouldActOnEvaluation(ev('SELL', ['X1'], -5000), fresh, NOW)).toEqual({ act: false, reason: 'EVALUATION_STALE' });
  });
  it('a REDUCE with no readable codes still acts once, under a placeholder code', () => {
    const r = shouldActOnEvaluation({ action: 'REDUCE', fractionPct: 50, signals: [], createdAt: ago(1) }, fresh, NOW);
    expect(r).toEqual({ act: true, codes: ['UNSPECIFIED'] });
    expect(shouldActOnEvaluation({ action: 'REDUCE', fractionPct: 50, signals: [], createdAt: ago(1) }, { reducedForCodes: ['UNSPECIFIED'], reduceCount: 1 }, NOW).act).toBe(false);
  });
  it('builds a schema-valid exit decision from the evaluation, with no model involved', () => {
    const ceilings = { maxSlippageBps: 300, maxPriceImpactPct: 3 };
    const reduce = buildExitDecision({ action: 'REDUCE', fractionPct: 50 }, ['TAKE_PROFIT'], ceilings);
    expect(AgentDecisionSchema.parse(reduce)).toMatchObject({ action: 'REDUCE', suggestedPositionSizePct: 50, confidence: 1 });
    expect(buildExitDecision({ action: 'SELL', fractionPct: 100 }, [], ceilings).suggestedPositionSizePct).toBe(100);
    expect(buildExitDecision({ action: 'REDUCE', fractionPct: 0 }, [], ceilings).suggestedPositionSizePct).toBe(1);
    expect(buildExitDecision({ action: 'REDUCE', fractionPct: 100 }, [], ceilings).suggestedPositionSizePct).toBe(99);
    expect(buildExitDecision({ action: 'REDUCE', fractionPct: 50 }, ['bad code'], ceilings).reasonCodes).toEqual([]);
  });
  it('retries only when nothing was sold, after the cooldown, within the attempt limit', () => {
    const row = (outcome: string, attempts = 1, age = EXIT_RETRY_COOLDOWN_MS) => ({ outcome, attempts, lastAttemptAt: ago(age) });
    for (const o of ['rejected', 'quote_failed', 'quote_stale', 'expired', 'error']) expect(canRetryExit(row(o), NOW)).toBe(true);
    for (const o of ['filled', 'logged', 'queued', 'awaiting_confirmation']) expect(canRetryExit(row(o), NOW)).toBe(false);
    expect(canRetryExit(row('rejected', 1, EXIT_RETRY_COOLDOWN_MS - 1), NOW)).toBe(false);
    expect(canRetryExit(row('rejected', MAX_EXIT_ATTEMPTS), NOW)).toBe(false);
  });
});

describe('confirmation expiry', () => {
  const exp = confirmationExpiry(NOW);
  it('expires after the TTL', () => expect(exp.getTime() - NOW.getTime()).toBe(CONFIRMATION_TTL_MS));
  it('can be claimed only while pending and unexpired', () => {
    expect(canClaim({ status: 'PENDING', expiresAt: exp }, NOW)).toBe(true);
    expect(canClaim({ status: 'PENDING', expiresAt: exp }, exp)).toBe(false); // exactly at expiry is expired
    expect(canClaim({ status: 'PENDING', expiresAt: exp }, new Date(exp.getTime() + 1))).toBe(false);
    for (const status of ['CLAIMED', 'REJECTED', 'EXPIRED'] as const) expect(canClaim({ status, expiresAt: exp }, NOW)).toBe(false);
    expect(effectiveStatus({ status: 'PENDING', expiresAt: ago(1) }, NOW)).toBe('EXPIRED');
    expect(effectiveStatus({ status: 'CLAIMED', expiresAt: ago(1) }, NOW)).toBe('CLAIMED');
  });
});
