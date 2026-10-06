import type { TradingMode } from '@narra/shared';
import { MAX_DECISION_AGE_MS } from './constants';

export interface PermissionFacts {
  aiTradingEnabled: boolean;
  agentPaused: boolean;
  revokedAt: Date | null;
  delegatedUntil: Date | null;
}

export type SkipReason = 'AGENT_PAUSED' | 'AI_ACCESS_REVOKED' | 'AI_ACCESS_OFF' | 'DELEGATION_EXPIRED';

export type Eligibility = { eligible: true } | { eligible: false; reason: SkipReason };

/**
 * Cheap pre-filter run before a job is created. The Risk Governor re-checks everything and stays the authority.
 * - Paused or revoked stops every mode, SHADOW included.
 * - SHADOW needs no AI access: it only logs what the agent would have done.
 * - PAPER, SEMI_AUTO and AUTO need AI access on. SEMI_AUTO and AUTO also need an unexpired delegation
 *   (no expiry set means no expiry, as everywhere else in the code).
 * A user with no permission row has never enabled anything, so only SHADOW is eligible.
 */
export function checkEligibility(mode: TradingMode, permission: PermissionFacts | null, now: Date): Eligibility {
  if (permission?.agentPaused) return { eligible: false, reason: 'AGENT_PAUSED' };
  if (permission?.revokedAt) return { eligible: false, reason: 'AI_ACCESS_REVOKED' };
  if (mode === 'SHADOW') return { eligible: true };
  if (!permission?.aiTradingEnabled) return { eligible: false, reason: 'AI_ACCESS_OFF' };
  if ((mode === 'SEMI_AUTO' || mode === 'AUTO') && permission.delegatedUntil && permission.delegatedUntil <= now) {
    return { eligible: false, reason: 'DELEGATION_EXPIRED' };
  }
  return { eligible: true };
}

/** A decision from the future (clock trouble) is not fresh either. Unknown is never treated as fine. */
export function isDecisionFresh(createdAt: Date, now: Date, maxAgeMs: number = MAX_DECISION_AGE_MS): boolean {
  const age = now.getTime() - createdAt.getTime();
  return Number.isFinite(age) && age >= 0 && age <= maxAgeMs;
}

/** What a user may actually spend: the balance minus the SOL reserve. Zero or less means no trade. */
export function tradableBalance(balanceSol: number, reserveSol: number): number {
  return balanceSol - reserveSol;
}
