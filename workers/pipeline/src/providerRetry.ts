/**
 * Bounded retries for transient external-provider failures.
 *
 * Treg returns 429 for rate limits and 5xx for upstream failures. The Treg client deliberately
 * does not retry (a retry with a fresh idempotency key could double-charge), so the ingestion
 * loop retries here. Auth and validation errors are never retried.
 */
export interface ProviderRetryOptions {
  /** Total attempts, including the first one. */
  attempts?: number;
  baseDelayMs?: number;
  /** Cap for both exponential backoff and a provider's Retry-After. */
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Called before each wait. `attempt` is the attempt that is about to run (1-based). */
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function isRetryableProviderError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const status = (error as { status?: unknown }).status;
  if (typeof status === 'number' && Number.isFinite(status)) {
    if (status === 429 || (status >= 500 && status <= 599)) return true;
  }
  const code = (error as { code?: unknown }).code;
  return code === 'TREG_TIMEOUT' || code === 'TREG_REQUEST_FAILED';
}

function retryAfterMs(error: unknown): number {
  const seconds = (error as { retryAfterSeconds?: unknown }).retryAfterSeconds;
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
}

export async function retryProviderCall<T>(fn: () => Promise<T>, opts: ProviderRetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, Math.floor(opts.attempts ?? 3));
  const baseDelayMs = Math.max(1, Math.floor(opts.baseDelayMs ?? 500));
  const maxDelayMs = Math.max(baseDelayMs, Math.floor(opts.maxDelayMs ?? 30_000));
  const sleep = opts.sleep ?? defaultSleep;

  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= attempts || !isRetryableProviderError(error)) throw error;
      const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const delay = Math.min(maxDelayMs, Math.max(backoff, retryAfterMs(error)));
      opts.onRetry?.(attempt + 1, delay, error);
      await sleep(delay);
    }
  }
}
