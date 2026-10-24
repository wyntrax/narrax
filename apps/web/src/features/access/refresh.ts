/**
 * Scheduling for the "membership expires" refresh.
 *
 * Browsers and Node store timer delays as 32-bit signed integers (max 2^31-1 ms, about 24.8 days).
 * A longer delay silently becomes ~1 ms, so a member whose nextExpiry was further away than that
 * triggered an immediate refetch, which re-armed the same timer: a tight request loop.
 * The delay is therefore capped, and the timer re-arms itself until the expiry has really passed.
 */
export const MIN_REFRESH_MS = 5000;
export const MAX_TIMER_MS = 24 * 60 * 60 * 1000;

export interface Scheduler {
  now(): number;
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}
const realScheduler: Scheduler = {
  now: () => Date.now(),
  set: (fn, ms) => setTimeout(fn, ms),
  clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Always finite, never below MIN_REFRESH_MS (bounds polling when the server clock lags) and never above MAX_TIMER_MS. */
export function refreshDelay(expiryMs: number, nowMs: number): number {
  const wait = expiryMs - nowMs;
  if (!Number.isFinite(wait)) return MIN_REFRESH_MS;
  return Math.min(MAX_TIMER_MS, Math.max(MIN_REFRESH_MS, wait));
}

/** Calls onDue once the expiry has passed. Returns a cancel function. An unparsable date schedules nothing. */
export function scheduleRefresh(nextExpiry: string, onDue: () => void, scheduler: Scheduler = realScheduler): () => void {
  const expiry = Date.parse(nextExpiry);
  if (!Number.isFinite(expiry)) return () => {};
  let handle: unknown;
  let cancelled = false;
  const arm = () => {
    handle = scheduler.set(() => {
      if (cancelled) return;
      if (scheduler.now() >= expiry) onDue();
      else arm();
    }, refreshDelay(expiry, scheduler.now()));
  };
  arm();
  return () => { cancelled = true; scheduler.clear(handle); };
}
