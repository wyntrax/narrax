/**
 * Every number the fan-out, paper-trading and confirmation code uses, as a named starting value.
 * NONE of these has been validated against real outcomes. Each should become an admin-editable setting (B9).
 */

/** Flat cost charged on every paper fill, in SOL: base fee, priority fee and a tip estimate. UNVALIDATED guess. */
export const PAPER_FEE_SOL = 0.002;

/**
 * Virtual starting balance for PAPER and SHADOW users, who have no funded wallet.
 * The balance is this, minus paper buys and fees, plus paper sell proceeds. UNVALIDATED.
 */
export const PAPER_START_BALANCE_SOL = 10;

/** A semi-auto confirmation can be confirmed for this long after it is created. */
export const CONFIRMATION_TTL_MS = 5 * 60_000;

/** A BUY decision older than this is ignored by the entry fan-out. */
export const MAX_DECISION_AGE_MS = 10 * 60_000;

/**
 * A REDUCE or SELL evaluation older than this is ignored by the exit fan-out. The monitor records an unchanged
 * evaluation hourly, so twice that is the longest a live recommendation can be quiet. UNVALIDATED.
 */
export const MAX_EVALUATION_AGE_MS = 2 * 3_600_000;

/** A position is reduced at most this many times. After that only a SELL acts. UNVALIDATED. */
export const MAX_REDUCES_PER_POSITION = 2;

/** A failed exit is tried again after this long, with a new attempt number in its idempotency key. */
export const EXIT_RETRY_COOLDOWN_MS = 5 * 60_000;

/** An evaluation is acted on at most this many times in total. */
export const MAX_EXIT_ATTEMPTS = 3;

/**
 * Outcomes that mean nothing was sold, so the exit may be retried. 'queued' and 'awaiting_confirmation' are NOT here:
 * the first may still run, and retrying could sell twice.
 */
export const RETRYABLE_EXIT_OUTCOMES: readonly string[] = ['rejected', 'quote_failed', 'quote_stale', 'expired', 'error'];

/** Used in a REDUCE's reason codes when no signal code could be read. */
export const UNSPECIFIED_EXIT_CODE = 'UNSPECIFIED';

export const entryKey = (decisionId: string, userId: string) => `entry:${decisionId}:${userId}`;
export const exitKey = (evaluationId: string, attempt: number) => `exit:${evaluationId}:${attempt}`;
export const confirmKey = (confirmationId: string) => `confirm:${confirmationId}`;
/** Unique while a position is open, so a user cannot hold two open positions in one token. */
export const openPositionKey = (userId: string, tokenId: string) => `${userId}:${tokenId}`;
