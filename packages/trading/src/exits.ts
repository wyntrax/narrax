import type { AgentDecision } from '@narra/shared';
import {
  EXIT_RETRY_COOLDOWN_MS, MAX_EVALUATION_AGE_MS, MAX_EXIT_ATTEMPTS, MAX_REDUCES_PER_POSITION, RETRYABLE_EXIT_OUTCOMES, UNSPECIFIED_EXIT_CODE,
} from './constants';

const CODE = /^[A-Z0-9_]{2,48}$/;

/** Signal codes written by the monitor. They are our own constants, but anything that is not a clean code is dropped. */
export function signalCodesOf(signals: unknown): string[] {
  if (!Array.isArray(signals)) return [];
  const codes = signals.map((s) => (s as { code?: unknown } | null)?.code).filter((c): c is string => typeof c === 'string' && CODE.test(c));
  return [...new Set(codes)];
}

export interface EvaluationFacts {
  action: string;
  fractionPct: number;
  signals: unknown;
  createdAt: Date;
}

export interface PositionExitState {
  reducedForCodes: string[];
  reduceCount: number;
}

export type ExitSkip = 'NOT_AN_EXIT' | 'EVALUATION_STALE' | 'REDUCE_CAP' | 'ALREADY_REDUCED';
export type ExitDecision = { act: true; codes: string[] } | { act: false; reason: ExitSkip };

/**
 * Whether a monitor evaluation should become an exit job.
 * A SELL always acts. A REDUCE acts only when it carries a signal code that has not already caused a reduce, and
 * only while the position has been reduced fewer than MAX_REDUCES_PER_POSITION times. So a take-profit REDUCE,
 * which stays true while the price stays high, reduces once and not on every heartbeat.
 */
export function shouldActOnEvaluation(ev: EvaluationFacts, state: PositionExitState, now: Date): ExitDecision {
  if (ev.action !== 'REDUCE' && ev.action !== 'SELL') return { act: false, reason: 'NOT_AN_EXIT' };
  const age = now.getTime() - ev.createdAt.getTime();
  if (!Number.isFinite(age) || age < 0 || age > MAX_EVALUATION_AGE_MS) return { act: false, reason: 'EVALUATION_STALE' };
  const codes = signalCodesOf(ev.signals);
  const triggers = codes.length ? codes : [UNSPECIFIED_EXIT_CODE];
  if (ev.action === 'SELL') return { act: true, codes: triggers };
  if (state.reduceCount >= MAX_REDUCES_PER_POSITION) return { act: false, reason: 'REDUCE_CAP' };
  if (triggers.every((c) => state.reducedForCodes.includes(c))) return { act: false, reason: 'ALREADY_REDUCED' };
  return { act: true, codes: triggers };
}

/** Share of the position to sell, from the evaluation: SELL is everything, REDUCE is its stated share kept strictly inside (0, 100). */
export function exitSizePct(ev: Pick<EvaluationFacts, 'action' | 'fractionPct'>): number {
  if (ev.action === 'SELL') return 100;
  return Math.min(Math.max(Math.round(ev.fractionPct), 1), 99);
}

/**
 * The decision an exit job carries. It is built from fixed rules, not from a model, so confidence is 1 and the
 * Governor ignores it for exits. The slippage and impact ceilings are the caller's, normally the system limits.
 */
export function buildExitDecision(ev: Pick<EvaluationFacts, 'action' | 'fractionPct'>, codes: string[], ceilings: { maxSlippageBps: number; maxPriceImpactPct: number }): AgentDecision {
  const action = ev.action === 'SELL' ? 'SELL' : 'REDUCE';
  return {
    action, confidence: 1, reasonCodes: codes.filter((c) => CODE.test(c)).slice(0, 24),
    positiveSignals: [], negativeSignals: [], risks: [],
    suggestedPositionSizePct: exitSizePct(ev),
    entry: { maxSlippageBps: Math.round(ceilings.maxSlippageBps), maxPriceImpactPct: ceilings.maxPriceImpactPct },
    exit: { stopLossPct: null, takeProfitPct: null, trailingStopPct: null },
    invalidationConditions: [], summary: 'Exit recommended by the position monitor rules.',
  };
}

/**
 * An evaluation that was acted on may be acted on again only if nothing was sold: the last attempt ended in one of
 * the retryable outcomes, it is old enough, and the attempts are not used up. A job that is queued or waiting for
 * a confirmation is never retried, because it may still run and a second one could sell twice.
 */
export function canRetryExit(row: { outcome: string; attempts: number; lastAttemptAt: Date }, now: Date): boolean {
  if (!RETRYABLE_EXIT_OUTCOMES.includes(row.outcome)) return false;
  if (row.attempts >= MAX_EXIT_ATTEMPTS) return false;
  return now.getTime() - row.lastAttemptAt.getTime() >= EXIT_RETRY_COOLDOWN_MS;
}
