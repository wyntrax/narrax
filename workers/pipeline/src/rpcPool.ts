import { RpcHttpError, SolanaRpc } from '@narra/solana';

/** How long one endpoint is skipped after a provider-level rejection. */
export const RPC_POOL_LIMITS = { cooldownMs: 15 * 60_000 } as const;

/**
 * A 429, a timeout or a 5xx is an endpoint problem, so another endpoint can answer the
 * same question. A malformed or stale response is a data problem that every endpoint
 * would report the same way, so it is never hidden.
 *
 * SolanaRpc wraps transport failures as "<method> failed: AbortError" (timeout) or
 * "<method> failed: TypeError" (network), so those shapes match as well as a raw HTTP
 * status. Metadata sources throw "request failed" for the same transport conditions.
 */
export function providerFailure(error: unknown): boolean {
  if (error instanceof RpcHttpError) return error.status === 408 || error.status === 429 || error.status >= 500;
  // Vitest can load more than one copy of the Solana package; a structural check keeps
  // the classifier correct without depending on the class identity.
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === 'number' && (status === 408 || status === 429 || status >= 500)) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /HTTP\s*(408|429|5\d\d)|rate.?limit|ECONN|ETIMEDOUT|timeout|timed out|fetch failed|request failed|abort|failed: TypeError/i.test(message);
}

export interface PooledRpcEndpoint<T> {
  tier: 'primary' | 'fallback';
  client: T;
}

export interface RpcPoolOptions {
  cooldownMs?: number;
  now?: () => number;
}

/**
 * Round-robins across the primary endpoints and uses fallbacks only when every primary
 * is cooling down or failing. A successful call moves the cursor, so sequential calls
 * spread across all keys instead of spending one key first.
 *
 * Cooldowns are in-process and per endpoint. A restart costs one rejected probe per
 * exhausted key and then the pool routes around it again.
 */
export function makePooledRpc<T extends object>(endpoints: PooledRpcEndpoint<T>[], opts: RpcPoolOptions = {}): T {
  const first = endpoints[0]?.client;
  if (!first) throw new Error('RPC pool requires at least one endpoint');
  const cooldownMs = opts.cooldownMs ?? RPC_POOL_LIMITS.cooldownMs, now = opts.now ?? Date.now;
  const cooldownUntil = endpoints.map(() => 0);
  const groups = [
    endpoints.flatMap((endpoint, index) => endpoint.tier === 'primary' ? [index] : []),
    endpoints.flatMap((endpoint, index) => endpoint.tier === 'fallback' ? [index] : []),
  ];
  let cursor = 0;
  return new Proxy(first, {
    get(target, property) {
      const value = Reflect.get(target, property) as unknown;
      if (typeof value !== 'function') return value;
      return async (...args: unknown[]) => {
        let lastError: unknown;
        for (const group of groups) {
          for (let offset = 0; offset < group.length; offset++) {
            const index = group[(cursor + offset) % group.length]!;
            if (cooldownUntil[index]! > now()) continue;
            try {
              const client = endpoints[index]!.client;
              const method = Reflect.get(client, property) as (...args: unknown[]) => Promise<unknown>;
              const result = await method.apply(client, args);
              cursor = (index + 1) % endpoints.length;
              return result;
            } catch (error) {
              if (!providerFailure(error)) throw error;
              lastError = error;
              cooldownUntil[index] = now() + cooldownMs;
            }
          }
        }
        // All endpoints are cooling. Report the shape discovery and other callers
        // already understand as a provider rejection, without naming a URL.
        throw lastError ?? new RpcHttpError(String(property), 429);
      };
    },
  });
}

export interface HeliusRpcPoolOptions extends RpcPoolOptions {
  timeoutMs?: number;
  fetch?: typeof fetch;
}

function rpcClients(urls: readonly string[], opts: HeliusRpcPoolOptions): SolanaRpc[] {
  return urls.map(url => new SolanaRpc({
    url,
    timeoutMs: opts.timeoutMs ?? 15_000,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  }));
}

/** A single pool over both tiers. Use when a caller does not keep its own checkpoint. */
export function makeHeliusRpcPool(primaryUrls: readonly string[], fallbackUrls: readonly string[], opts: HeliusRpcPoolOptions = {}): SolanaRpc | null {
  const endpoints: PooledRpcEndpoint<SolanaRpc>[] = [
    ...rpcClients(primaryUrls, opts).map(client => ({ tier: 'primary' as const, client })),
    ...rpcClients(fallbackUrls, opts).map(client => ({ tier: 'fallback' as const, client })),
  ];
  return endpoints.length ? makePooledRpc(endpoints, opts) : null;
}

/** Separate tier pools, for discovery's checkpointed primary-to-fallback transition. */
export function makeHeliusRpcTiers(primaryUrls: readonly string[], fallbackUrls: readonly string[], opts: HeliusRpcPoolOptions = {}): { primary: SolanaRpc | null; fallback: SolanaRpc | null } {
  const primary = rpcClients(primaryUrls, opts), fallback = rpcClients(fallbackUrls, opts);
  return {
    primary: primary.length ? makePooledRpc(primary.map(client => ({ tier: 'primary' as const, client })), opts) : null,
    fallback: fallback.length ? makePooledRpc(fallback.map(client => ({ tier: 'fallback' as const, client })), opts) : null,
  };
}
