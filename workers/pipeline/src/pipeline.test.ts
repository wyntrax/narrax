import { describe, expect, it, vi } from 'vitest';
import type { ExecutionJob, SwapEvent } from '@narra/queue';
import { PROFILES, type RiskContext } from '@narra/risk';
import { WSOL_MINT, type Quote } from '@narra/solana';
import { processExecution, processWalletEvent, type ExecutionDeps } from './index';

const MINT = '7xKqExampleMintAddress1111111111111111111';
const NOW = new Date('2026-09-30T10:00:00Z');

const job = (over: Partial<ExecutionJob['decision']> = {}): ExecutionJob => ({
  userId: 'u1', decisionId: 'd1', idempotencyKey: 'order-0001-abcd', mint: MINT,
  decision: {
    action: 'BUY', confidence: 0.9, reasonCodes: ['SMART_MONEY'], positiveSignals: [], negativeSignals: [], risks: [],
    suggestedPositionSizePct: 1, entry: { maxSlippageBps: 100, maxPriceImpactPct: 1.5 },
    exit: { stopLossPct: 25, takeProfitPct: 50, trailingStopPct: null }, invalidationConditions: [], summary: 's', ...over,
  },
});

const context = (over: Partial<Omit<RiskContext, 'quote'>> = {}): Omit<RiskContext, 'quote'> => ({
  now: NOW, mode: 'AUTO', aiAccessEnabled: true, agentPaused: false, idempotencyKey: 'order-0001-abcd',
  token: { mint: MINT, blacklisted: false, liquidityUsd: 600_000 }, signals: { opportunityScore: 90, consensusScore: 80 },
  portfolio: { totalValueSol: 20, walletBalanceSol: 10, openPositions: 0, hasPositionInToken: false, tokenExposureSol: 0, allocatedTodaySol: 0, realizedPnlTodaySol: 0, drawdownPct: 0 },
  history: { seenIdempotencyKeys: [], lastTradeAtForToken: null, lastSameOrderAt: null }, ...over,
});

const quote = (over: Partial<Quote> = {}): Quote => ({ inputMint: WSOL_MINT, outputMint: MINT, inAmount: '1', outAmount: '1', priceImpactPct: 0.4, slippageBps: 100, fetchedAt: NOW, raw: {}, ...over });

function deps(over: Partial<ExecutionDeps> = {}, ctx = context()) {
  const getQuote = vi.fn(async () => quote());
  const recordRisk = vi.fn(async () => {});
  const d: ExecutionDeps = {
    jupiter: { getQuote }, recordRisk, now: () => NOW,
    loadPreTradeState: async () => ({ context: ctx, limits: PROFILES.BALANCED, positionBaseUnits: '1000000' }), ...over,
  };
  return { d, getQuote, recordRisk };
}

describe('processExecution', () => {
  it('rejects before spending a quote call when the Governor already says no', async () => {
    const { d, getQuote, recordRisk } = deps({}, context({ agentPaused: true }));
    const r = await processExecution(job(), d);
    expect(r.status).toBe('rejected');
    expect(getQuote).not.toHaveBeenCalled();
    expect(recordRisk).toHaveBeenCalledTimes(1);
  });
  it('does not treat WATCH as a trade', async () => {
    const { d, getQuote } = deps();
    expect((await processExecution(job({ action: 'WATCH' }), d)).status).toBe('no_trade');
    expect(getQuote).not.toHaveBeenCalled();
  });
  it('requests a BUY quote for the clamped size and never executes without an executor', async () => {
    const { d, getQuote } = deps();
    const r = await processExecution(job(), d);
    expect(r.status).toBe('execution_disabled');
    expect(getQuote).toHaveBeenCalledWith({ inputMint: WSOL_MINT, outputMint: MINT, amount: 200_000_000n, slippageBps: 100 });
  });
  it('routes by mode without executing', async () => {
    for (const [mode, status] of [['SHADOW', 'logged'], ['PAPER', 'simulated'], ['SEMI_AUTO', 'awaiting_confirmation']] as const) {
      const { d } = deps({}, context({ mode }));
      expect((await processExecution(job(), d)).status).toBe(status);
    }
  });
  it('rejects when the fresh quote shows too much price impact', async () => {
    const { d } = deps({ jupiter: { getQuote: async () => quote({ priceImpactPct: 5 }) } });
    const r = await processExecution(job(), d);
    expect(r.status).toBe('rejected');
    expect(r.result.violations.map((v) => v.code)).toContain('PRICE_IMPACT_TOO_HIGH');
  });
  it('fails closed when the quote cannot be fetched', async () => {
    const { d, recordRisk } = deps({ jupiter: { getQuote: async () => { throw new Error('down'); } } });
    const r = await processExecution(job(), d);
    expect(r.status).toBe('quote_failed');
    expect(r.result.route).toBe('REJECT');
    expect(recordRisk).toHaveBeenCalledTimes(1);
  });
  it('calls the executor once with the approved size, and blocks stale quotes', async () => {
    const execute = vi.fn(async (_i: { sizeSol: number }) => ({ signature: 'sig1' }));
    const { d } = deps({ executor: { execute } });
    const r = await processExecution(job(), d);
    expect(r.status).toBe('executed');
    expect(r.signature).toBe('sig1');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0]?.sizeSol).toBeCloseTo(0.2);

    const exec2 = vi.fn(async (_i: { sizeSol: number }) => ({ signature: 'x' }));
    const stale = deps({ executor: { execute: exec2 }, jupiter: { getQuote: async () => quote({ fetchedAt: new Date(NOW.getTime() - 60_000) }) } });
    expect((await processExecution(job(), stale.d)).status).toBe('quote_stale');
    expect(exec2).not.toHaveBeenCalled();
  });
  it('sizes a partial exit from the position amount', async () => {
    const { d, getQuote } = deps({}, context({ portfolio: { ...context().portfolio, hasPositionInToken: true } }));
    await processExecution(job({ action: 'REDUCE', suggestedPositionSizePct: 50 }), d);
    expect(getQuote).toHaveBeenCalledWith({ inputMint: MINT, outputMint: WSOL_MINT, amount: 500_000n, slippageBps: 100 });
  });
});

describe('processExecution: B4 paths', () => {
  const heldCtx = (mode: RiskContext['mode'] = 'PAPER') => context({ mode, portfolio: { ...context().portfolio, hasPositionInToken: true } });

  it('returns the fresh quote with the outcome, so paper fills are computed from it', async () => {
    const { d } = deps({ jupiter: { getQuote: async () => quote({ outAmount: '777', priceImpactPct: 0.9 }) } }, context({ mode: 'PAPER' }));
    const r = await processExecution(job(), d);
    expect(r.status).toBe('simulated');
    expect(r.quote).toMatchObject({ outAmount: '777', priceImpactPct: 0.9 });
  });
  it('returns no quote when the job is stopped before one is taken', async () => {
    const { d } = deps({}, context({ mode: 'PAPER', agentPaused: true }));
    const r = await processExecution(job(), d);
    expect(r.status).toBe('rejected');
    expect(r.quote).toBeNull();
  });
  it('a paused agent stops buys and automated exits alike', async () => {
    for (const action of ['BUY', 'SELL'] as const) {
      const { d, getQuote } = deps({}, { ...heldCtx(), agentPaused: true });
      const r = await processExecution(job({ action, suggestedPositionSizePct: 100 }), d);
      expect(r.status).toBe('rejected');
      expect(r.result.violations.map((v) => v.code)).toContain('AGENT_PAUSED');
      expect(getQuote).not.toHaveBeenCalled();
    }
  });
  it('an exit is not blocked by a breached daily-loss or drawdown limit, and is simulated in PAPER', async () => {
    const ctx = heldCtx();
    const { d } = deps({}, { ...ctx, portfolio: { ...ctx.portfolio, realizedPnlTodaySol: -5, drawdownPct: 60 } });
    const r = await processExecution(job({ action: 'SELL', suggestedPositionSizePct: 100 }), d);
    expect(r.status).toBe('simulated');
    expect(r.result.exitFraction).toBe(1);
  });
  it('the same breach does block a BUY', async () => {
    const { d } = deps({}, context({ mode: 'PAPER', portfolio: { ...context().portfolio, realizedPnlTodaySol: -5 } }));
    const r = await processExecution(job(), d);
    expect(r.status).toBe('rejected');
    expect(r.result.violations.map((v) => v.code)).toContain('DAILY_LOSS_LIMIT');
  });
  it('a missing balance fails closed: the state loader throws and nothing is recorded or quoted', async () => {
    const getQuote = vi.fn(async () => quote());
    const recordRisk = vi.fn(async () => {});
    const d: ExecutionDeps = { jupiter: { getQuote }, recordRisk, now: () => NOW, loadPreTradeState: async () => { throw new Error('balance unavailable'); } };
    await expect(processExecution(job(), d)).rejects.toThrow('balance unavailable');
    expect(getQuote).not.toHaveBeenCalled();
    expect(recordRisk).not.toHaveBeenCalled();
  });
  describe('a confirmed order (job has a confirmationId)', () => {
    const confirmed = (): ExecutionJob => ({ ...job(), idempotencyKey: 'confirm:abc-0001', confirmationId: 'abc' });
    it('re-runs the Governor with a fresh quote, and with no Executor stops at execution_disabled', async () => {
      const { d, getQuote, recordRisk } = deps({}, context({ mode: 'SEMI_AUTO', idempotencyKey: 'confirm:abc-0001' }));
      const r = await processExecution(confirmed(), d);
      expect(r.status).toBe('execution_disabled');
      expect(getQuote).toHaveBeenCalledTimes(1);
      expect(recordRisk).toHaveBeenCalledTimes(1);
    });
    it('is rejected, not executed, when the fresh quote now breaks a limit', async () => {
      const execute = vi.fn(async (_i: { sizeSol: number }) => ({ signature: 'x' }));
      const { d } = deps({ executor: { execute }, jupiter: { getQuote: async () => quote({ priceImpactPct: 9 }) } }, context({ mode: 'SEMI_AUTO', idempotencyKey: 'confirm:abc-0001' }));
      const r = await processExecution(confirmed(), d);
      expect(r.status).toBe('rejected');
      expect(execute).not.toHaveBeenCalled();
    });
    it('is rejected when the agent was paused or AI access revoked after the user was asked', async () => {
      for (const over of [{ agentPaused: true }, { aiAccessEnabled: false }]) {
        const { d, getQuote } = deps({}, context({ mode: 'SEMI_AUTO', idempotencyKey: 'confirm:abc-0001', ...over }));
        const r = await processExecution(confirmed(), d);
        expect(r.status).toBe('rejected');
        expect(getQuote).not.toHaveBeenCalled();
      }
    });
    it('never becomes a paper fill if the user has since moved to PAPER', async () => {
      const { d } = deps({}, context({ mode: 'PAPER', idempotencyKey: 'confirm:abc-0001' }));
      const r = await processExecution(confirmed(), d);
      expect(r.status).toBe('rejected');
      expect(r.result.violations.map((v) => v.code)).toContain('MODE_CHANGED');
    });
    it('without a confirmationId the same SEMI_AUTO job only asks for confirmation', async () => {
      const { d } = deps({}, context({ mode: 'SEMI_AUTO' }));
      expect((await processExecution(job(), d)).status).toBe('awaiting_confirmation');
    });
  });
  it('a job without a decisionId (an exit) is valid and carries its evaluation', async () => {
    const { ExecutionJobSchema } = await import('@narra/queue');
    const exit = { ...job({ action: 'SELL', suggestedPositionSizePct: 100 }), decisionId: undefined, evaluationId: 'e1', positionId: 'p1', idempotencyKey: 'exit:e1:1' };
    expect(ExecutionJobSchema.parse(exit)).toMatchObject({ evaluationId: 'e1', positionId: 'p1' });
  });
});

const EVENT: SwapEvent = { signature: 'sig'.padEnd(64, '1'), wallet: 'W'.padEnd(40, '1'), mint: MINT, side: 'BUY', amountSol: 2, tokenAmount: 1000, at: NOW.toISOString() };

describe('processWalletEvent', () => {
  const mk = (saved: 'created' | 'duplicate', score: number | null) => {
    const enqueueAiScreening = vi.fn(async () => {});
    return { enqueueAiScreening, deps: { saveWalletTrade: async () => saved, getWalletScore: async () => score, enqueueAiScreening } };
  };
  it('ignores duplicates', async () => {
    const m = mk('duplicate', 95);
    expect(await processWalletEvent(EVENT, m.deps)).toBe('duplicate');
    expect(m.enqueueAiScreening).not.toHaveBeenCalled();
  });
  it('sends only big buys from high-score wallets to screening', async () => {
    const hi = mk('created', 90);
    expect(await processWalletEvent(EVENT, hi.deps)).toBe('queued_for_screening');
    expect(hi.enqueueAiScreening).toHaveBeenCalledTimes(1);
    for (const m of [mk('created', 40), mk('created', null)]) expect(await processWalletEvent(EVENT, m.deps)).toBe('stored');
    expect(await processWalletEvent({ ...EVENT, side: 'SELL' }, mk('created', 90).deps)).toBe('stored');
    expect(await processWalletEvent({ ...EVENT, amountSol: 0.1 }, mk('created', 90).deps)).toBe('stored');
  });
});
