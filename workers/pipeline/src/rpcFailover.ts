import { RpcHttpError } from '@narra/solana';

/** How long the primary endpoint is skipped after a provider-level rejection. */
export const RPC_FAILOVER_LIMITS = { cooldownMs: 15 * 60_000 } as const;

/**
 * A 429, a timeout or a 5xx is an endpoint problem, so the fallback can answer the
 * same question. A malformed or stale response is a data problem that the fallback
 * would report the same way, so it is never hidden.
 */
function providerFailure(error: unknown): boolean {
  if (error instanceof RpcHttpError) return error.status === 408 || error.status === 429 || error.status >= 500;
  const message = error instanceof Error ? error.message : String(error);
  return /HTTP\s*(408|429|5\d\d)|rate.?limit|ECONN|ETIMEDOUT|timeout|timed out|fetch failed|aborted/i.test(message);
}

/**
 * Wraps a primary RPC client so a provider-level rejection moves subsequent calls to
 * the fallback for a cooldown. The first rejected call is retried on the fallback, so
 * one exhausted key does not fail the whole enrichment run.
 *
 * The cooldown is in-process. A restart costs one rejected probe and then fails over
 * again. Only the methods the wrapped client exposes are used by the callers.
 */
export function makeFailoverRpc<T extends object>(
  primary: T,
  fallback: T,
  opts: { cooldownMs?: number; now?: () => number } = {},
): T {
  const cooldownMs = opts.cooldownMs ?? RPC_FAILOVER_LIMITS.cooldownMs, now = opts.now ?? Date.now;
  let primaryCooldownUntil = 0;
  const callFallback = (property: PropertyKey, args: unknown[]) =>
    (Reflect.get(fallback, property) as (...args: unknown[]) => Promise<unknown>).apply(fallback, args);
  return new Proxy(primary, {
    get(target, property) {
      const value = Reflect.get(target, property) as unknown;
      if (typeof value !== 'function') return value;
      const primaryMethod = value as (...args: unknown[]) => Promise<unknown>;
      return async (...args: unknown[]) => {
        if (primaryCooldownUntil > now()) return callFallback(property, args);
        try {
          return await primaryMethod.apply(target, args);
        } catch (error) {
          if (!providerFailure(error)) throw error;
          primaryCooldownUntil = now() + cooldownMs;
          return callFallback(property, args);
        }
      };
    },
  });
}
