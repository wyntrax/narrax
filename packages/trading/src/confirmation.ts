import { CONFIRMATION_TTL_MS } from './constants';

export type ConfirmationState = 'PENDING' | 'CLAIMED' | 'REJECTED' | 'EXPIRED';

export const confirmationExpiry = (now: Date, ttlMs: number = CONFIRMATION_TTL_MS) => new Date(now.getTime() + ttlMs);

/** A pending confirmation past its expiry is expired, whether or not a sweep has recorded that yet. */
export function effectiveStatus(row: { status: ConfirmationState; expiresAt: Date }, now: Date): ConfirmationState {
  return row.status === 'PENDING' && row.expiresAt <= now ? 'EXPIRED' : row.status;
}

/** Only a pending, unexpired confirmation can be claimed. The database claim repeats this check atomically. */
export const canClaim = (row: { status: ConfirmationState; expiresAt: Date }, now: Date) => effectiveStatus(row, now) === 'PENDING';
