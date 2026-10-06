import type { ExecutionJob } from '@narra/queue';
import { evaluateRisk, type RiskContext, type RiskLimits, type RiskResult } from '@narra/risk';
import { WSOL_MINT, isQuoteFresh, type JupiterClient, type Quote } from '@narra/solana';

export interface PreTradeState {
  /** Everything the Governor needs except the quote. Loaded server-side, never supplied by the model. */
  context: Omit<RiskContext, 'quote'>;
  limits: Partial<RiskLimits>;
  /** The system ceiling to enforce: the code defaults with any admin overrides (never looser than the code). Absent means the code defaults. */
  systemLimits?: RiskLimits;
  /** Token base units held, needed to size exits. Null when there is no position. */
  positionBaseUnits: string | null;
}

/** The only thing allowed to sign and send. Left undefined in Phase 1, so nothing can trade. */
export interface Executor {
  execute(input: { job: ExecutionJob; sizeSol: number; exitFraction: number; quote: Quote }): Promise<{ signature: string }>;
}

/**
 * B5a. Builds, verifies and simulates the transaction an Executor WOULD send, and records the verdict. It holds no signing
 * capability and sends nothing. Returns null when it does not apply (for example the user is not on the canary allow list),
 * in which case the order ends as execution_disabled exactly as before.
 */
export interface DryRunner {
  run(input: { job: ExecutionJob; sizeSol: number; exitFraction: number; quote: Quote; result: RiskResult }): Promise<DryRunSummary | null>;
}
export interface DryRunSummary { id: string; outcome: 'ACCEPTED' | 'REJECTED' | 'ERROR'; codes: string[] }

export interface ExecutionDeps {
  jupiter: Pick<JupiterClient, 'getQuote'>;
  loadPreTradeState(job: ExecutionJob): Promise<PreTradeState>;
  /** Persist the risk decision and an audit entry. Called for every outcome, including rejections. */
  recordRisk(rec: { job: ExecutionJob; result: RiskResult; quote: Quote | null; status: ExecutionStatus }): Promise<void>;
  executor?: Executor;
  /** Used only when there is no executor. Never signs or sends. */
  dryRunner?: DryRunner;
  now?: () => Date;
  maxQuoteAgeMs?: number;
}

export type ExecutionStatus =
  | 'rejected' | 'no_trade' | 'logged' | 'simulated' | 'awaiting_confirmation'
  | 'execution_disabled' | 'dry_run' | 'executed' | 'quote_failed' | 'quote_stale';

export interface ExecutionOutcome {
  status: ExecutionStatus;
  result: RiskResult;
  signature?: string;
  /** The fresh quote the decision was checked against. Paper fills are computed from it. Null when no quote was taken. */
  quote: Quote | null;
  /** Set when the order ended as a dry run: the recorded verdict. Nothing was sent. */
  dryRun?: DryRunSummary;
}

const LAMPORTS = 1_000_000_000;

function reject(result: RiskResult, code: string, message: string): RiskResult {
  return { ...result, approved: false, route: 'REJECT', sizeSol: 0, exitFraction: 0, violations: [...result.violations, { code, message }] };
}

/**
 * Execution path: Zod-validated decision -> Risk Governor -> fresh quote -> Governor again -> route by mode.
 * The first pass uses a neutral quote to get the clamped size without spending an API call on trades that
 * would be rejected anyway. The second pass re-checks with the real quote.
 */
export async function processExecution(job: ExecutionJob, deps: ExecutionDeps): Promise<ExecutionOutcome> {
  const now = deps.now ?? (() => new Date());
  const state = await deps.loadPreTradeState(job);
  const neutral = { priceImpactPct: 0, expectedSlippageBps: 0 };

  const first = evaluateRisk(job.decision, { ...state.context, quote: neutral }, state.limits, state.systemLimits);
  const finish = async (status: ExecutionStatus, result: RiskResult, quote: Quote | null, signature?: string, dryRun?: DryRunSummary): Promise<ExecutionOutcome> => {
    await deps.recordRisk({ job, result, quote, status });
    return { status, result, signature, quote, ...(dryRun ? { dryRun } : {}) };
  };

  if (!first.approved) return finish('rejected', first, null);
  if (first.route === 'NO_TRADE') return finish('no_trade', first, null);

  const isBuy = job.decision.action === 'BUY';
  let amount: bigint;
  if (isBuy) {
    amount = BigInt(Math.floor(first.sizeSol * LAMPORTS));
  } else {
    if (!state.positionBaseUnits) return finish('rejected', reject(first, 'NO_POSITION', 'No position amount available.'), null);
    amount = (BigInt(state.positionBaseUnits) * BigInt(Math.round(first.exitFraction * 10_000))) / 10_000n;
  }
  if (amount <= 0n) return finish('rejected', reject(first, 'ZERO_AMOUNT', 'The trade amount rounds to zero.'), null);

  let quote: Quote;
  try {
    quote = await deps.jupiter.getQuote({
      inputMint: isBuy ? WSOL_MINT : job.mint,
      outputMint: isBuy ? job.mint : WSOL_MINT,
      amount,
      slippageBps: first.maxSlippageBps,
    });
  } catch {
    return finish('quote_failed', reject(first, 'QUOTE_UNAVAILABLE', 'Could not get a fresh quote.'), null);
  }

  // The quote's slippage is the tolerance we will submit with, so it is the worst case the Governor checks.
  const second = evaluateRisk(
    job.decision,
    { ...state.context, quote: { priceImpactPct: quote.priceImpactPct, expectedSlippageBps: quote.slippageBps } },
    state.limits,
    state.systemLimits,
  );
  if (!second.approved) return finish('rejected', second, quote);

  // A job with a confirmationId was confirmed by the user. The Governor has just re-run with a fresh quote and fresh
  // state, so the order is allowed on. It is still routed by the user's mode now: a confirmed order never becomes
  // a paper fill, and with no Executor it stops at execution_disabled.
  const confirmed = !!job.confirmationId;
  const toExecutor = async (): Promise<ExecutionOutcome> => {
    if (!deps.executor) {
      // No Executor exists. The most that can happen is a dry run, and only for users the dry runner accepts.
      if (deps.dryRunner && isQuoteFresh(quote, now(), deps.maxQuoteAgeMs)) {
        const report = await deps.dryRunner.run({ job, sizeSol: second.sizeSol, exitFraction: second.exitFraction, quote, result: second });
        if (report) return finish('dry_run', second, quote, undefined, report);
      }
      return finish('execution_disabled', second, quote);
    }
    if (!isQuoteFresh(quote, now(), deps.maxQuoteAgeMs)) return finish('quote_stale', reject(second, 'QUOTE_STALE', 'The quote expired before execution.'), quote);
    const { signature } = await deps.executor.execute({ job, sizeSol: second.sizeSol, exitFraction: second.exitFraction, quote });
    return finish('executed', second, quote, signature);
  };
  switch (second.route) {
    case 'LOG_ONLY': return finish('logged', second, quote);
    case 'SIMULATE':
      if (confirmed) return finish('rejected', reject(second, 'MODE_CHANGED', 'The account is now in a mode that does not take confirmed orders.'), quote);
      return finish('simulated', second, quote);
    case 'AWAIT_CONFIRMATION': return confirmed ? toExecutor() : finish('awaiting_confirmation', second, quote);
    case 'EXECUTE': return toExecutor();
    default: return finish('rejected', reject(second, 'UNKNOWN_ROUTE', 'Unexpected route.'), quote);
  }
}
