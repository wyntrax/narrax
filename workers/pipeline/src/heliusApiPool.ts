import { providerFailure, RPC_POOL_LIMITS, type RpcPoolOptions } from './rpcPool';
import { WalletHistoryError } from './walletHistory';

export interface HeliusApiKeyPool {
  readonly size: number;
  run<T>(task: (apiKey: string, opts: { rateLimitRetries: number }) => Promise<T>): Promise<T>;
}

function isRetryableKeyError(error: unknown): boolean {
  if (error instanceof WalletHistoryError) {
    return (
      error.code === 'RATE_LIMITED' ||
      error.code === 'TIMEOUT' ||
      error.code === 'NETWORK' ||
      (error.httpStatus != null && error.httpStatus >= 500)
    );
  }
  return providerFailure(error);
}

/**
 * Round-robins Helius Enhanced API requests across configured API keys and puts any key that
 * returns HTTP 429, timeout, or 5xx on cooldown before retrying with the next healthy key.
 */
export function makeHeliusApiKeyPool(
  rawKeys: readonly string[],
  opts: RpcPoolOptions = {},
): HeliusApiKeyPool | null {
  const keys = [...new Set(rawKeys.map((k) => k.trim()).filter(Boolean))];
  if (!keys.length) return null;
  const cooldownMs = opts.cooldownMs ?? RPC_POOL_LIMITS.cooldownMs;
  const now = opts.now ?? Date.now;
  const cooldownUntil = keys.map(() => 0);
  let cursor = 0;

  return {
    size: keys.length,
    async run<T>(task: (apiKey: string, runOpts: { rateLimitRetries: number }) => Promise<T>): Promise<T> {
      let lastError: unknown;
      let tried = false;
      for (let offset = 0; offset < keys.length; offset++) {
        const index = (cursor + offset) % keys.length;
        if (cooldownUntil[index]! > now()) continue;
        tried = true;
        try {
          const result = await task(keys[index]!, { rateLimitRetries: keys.length > 1 ? 0 : 2 });
          cursor = (index + 1) % keys.length;
          return result;
        } catch (error) {
          if (!isRetryableKeyError(error)) throw error;
          lastError = error;
          cooldownUntil[index] = now() + cooldownMs;
        }
      }
      if (!tried) throw new WalletHistoryError('RATE_LIMITED', 0, 429);
      throw lastError ?? new WalletHistoryError('RATE_LIMITED', 0, 429);
    },
  };
}
