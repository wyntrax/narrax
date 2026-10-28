import { RpcHttpError } from '@narra/solana';

export const DISCOVERY_RPC_LIMITS = {
  minIntervalMs: 1000,
  maxRetries: 2,
  retryDelayMs: 2000,
  maxRetryWaitMs: 30_000,
  cooldownMs: 15 * 60_000,
} as const;

export class DiscoveryPause extends Error {
  constructor(readonly reason: 'REQUEST_BUDGET' | 'RATE_LIMITED', readonly retryAt: number | null = null) { super(reason); }
}

export interface DiscoveryClock { now(): number; sleep(ms: number): Promise<void> }
const realClock: DiscoveryClock = { now: Date.now, sleep: ms => new Promise(resolve => setTimeout(resolve, ms)) };

/** Per-discovery-run pacing. Every wire attempt, including retries, consumes the
 * original request ceiling. This is not a provider-wide/cross-process limiter. */
export function discoveryRpcBudget(maxRequests: number, clock: DiscoveryClock = realClock) {
  let nextAt = 0;
  const stats = { requests: 0, retries: 0, rateLimits: 0 };
  return {
    stats,
    async call<T>(request: () => Promise<T>): Promise<T> {
      let retry = false;
      for (;;) {
        if (stats.requests >= maxRequests) throw new DiscoveryPause('REQUEST_BUDGET');
        const delay = Math.max(0, nextAt - clock.now());
        if (delay) await clock.sleep(delay);
        stats.requests++;
        if (retry) stats.retries++;
        nextAt = clock.now() + DISCOVERY_RPC_LIMITS.minIntervalMs;
        try { return await request(); }
        catch (e) {
          if (!(e instanceof RpcHttpError) || e.status !== 429) throw e;
          stats.rateLimits++;
          const wait = Math.max(e.retryAfterMs ?? 0, DISCOVERY_RPC_LIMITS.retryDelayMs * 2 ** stats.retries);
          if (stats.retries >= DISCOVERY_RPC_LIMITS.maxRetries || wait > DISCOVERY_RPC_LIMITS.maxRetryWaitMs || stats.requests >= maxRequests) {
            throw new DiscoveryPause('RATE_LIMITED', clock.now() + Math.max(DISCOVERY_RPC_LIMITS.cooldownMs, e.retryAfterMs ?? 0));
          }
          nextAt = Math.max(nextAt, clock.now() + wait);
          retry = true;
        }
      }
    },
  };
}
