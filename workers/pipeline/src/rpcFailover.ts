import { makePooledRpc } from './rpcPool';

/** How long the primary endpoint is skipped after a provider-level rejection. */
export const RPC_FAILOVER_LIMITS = { cooldownMs: 15 * 60_000 } as const;

/**
 * Wraps a primary RPC client so a provider-level rejection moves subsequent calls to
 * the fallback for a cooldown. The first rejected call is retried on the fallback, so
 * one exhausted key does not fail the whole enrichment run.
 *
 * This is the two-endpoint case of `makePooledRpc`; new code that can have more than two
 * keys should use the pool directly.
 */
export function makeFailoverRpc<T extends object>(
  primary: T,
  fallback: T,
  opts: { cooldownMs?: number; now?: () => number } = {},
): T {
  return makePooledRpc([
    { tier: 'primary', client: primary },
    { tier: 'fallback', client: fallback },
  ], opts);
}
