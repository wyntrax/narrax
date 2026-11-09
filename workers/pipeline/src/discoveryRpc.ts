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
export function discoveryRpcBudget(maxRequests: number, clock: DiscoveryClock = realClock, options: { fallback?: boolean; primaryCooldownUntil?: number } = {}) {
  let nextAt = 0;
  let primaryCooldownUntil = options.primaryCooldownUntil ?? 0;
  let endpoint: 'primary' | 'fallback' = options.fallback && primaryCooldownUntil > clock.now() ? 'fallback' : 'primary';
  const stats = { requests: 0, retries: 0, rateLimits: 0, primaryRequests: 0, fallbackRequests: 0, failovers: 0 };
  return {
    stats,
    get primaryCooldownUntil() { return primaryCooldownUntil || null; },
    async call<T>(request: (endpoint: 'primary' | 'fallback') => Promise<T>): Promise<T> {
      let retry = false;
      for (;;) {
        if (endpoint === 'primary' && primaryCooldownUntil > clock.now()) throw new DiscoveryPause('RATE_LIMITED', primaryCooldownUntil);
        if (stats.requests >= maxRequests) throw new DiscoveryPause('REQUEST_BUDGET');
        const delay = Math.max(0, nextAt - clock.now());
        if (delay) await clock.sleep(delay);
        stats.requests++;
        if (endpoint === 'primary') stats.primaryRequests++; else stats.fallbackRequests++;
        if (retry) stats.retries++;
        nextAt = clock.now() + DISCOVERY_RPC_LIMITS.minIntervalMs;
        try { return await request(endpoint); }
        catch (e) {
          if (!(e instanceof RpcHttpError) || e.status !== 429) throw e;
          stats.rateLimits++;
          if (endpoint === 'primary' && options.fallback) {
            // Retry-After applies to this endpoint. Persist its cooldown so the
            // next scheduled run can keep using the healthy secondary.
            primaryCooldownUntil = clock.now() + Math.max(DISCOVERY_RPC_LIMITS.cooldownMs, e.retryAfterMs ?? 0);
            if (stats.retries < DISCOVERY_RPC_LIMITS.maxRetries && stats.requests < maxRequests) {
              endpoint = 'fallback';
              stats.failovers++;
              retry = true;
              continue; // The normal pacing delay still applies to this attempt.
            }
          }
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
