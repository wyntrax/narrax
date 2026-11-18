import { describe, expect, it } from 'vitest';
import { makeHeliusApiKeyPool } from './heliusApiPool';
import { WalletHistoryError } from './walletHistory';

describe('makeHeliusApiKeyPool', () => {
  it('returns null when no usable keys exist and deduplicates keys', () => {
    expect(makeHeliusApiKeyPool([])).toBeNull();
    expect(makeHeliusApiKeyPool(['  ', ''])).toBeNull();
    const pool = makeHeliusApiKeyPool(['k1', 'k2', 'k1', ' k3 ']);
    expect(pool?.size).toBe(3);
  });

  it('rotates calls round-robin across keys and fails over on 429', async () => {
    let now = 0;
    const pool = makeHeliusApiKeyPool(['k1', 'k2', 'k3'], { cooldownMs: 60_000, now: () => now })!;
    const used: string[] = [];

    // Spread consecutive calls across k1 -> k2 -> k3
    for (let i = 0; i < 3; i++) {
      await pool.run(async (key, opts) => {
        used.push(`${key}:${opts.rateLimitRetries}`);
        return key;
      });
    }
    expect(used).toEqual(['k1:0', 'k2:0', 'k3:0']);

    // Next cursor starts at k1: fail k1 with 429, fail over to k2, advance cursor to k3
    used.length = 0;
    const res = await pool.run(async (key) => {
      used.push(key);
      if (key === 'k1') throw new WalletHistoryError('RATE_LIMITED', 0, 429);
      return 'ok';
    });
    expect(res).toBe('ok');
    expect(used).toEqual(['k1', 'k2']);

    // k1 stays on cooldown until cooldownMs elapses
    used.length = 0;
    for (let i = 0; i < 3; i++) {
      await pool.run(async (key) => {
        used.push(key);
        return key;
      });
    }
    expect(used).toEqual(['k3', 'k2', 'k3']);

    now = 60_000;
    used.length = 0;
    await pool.run(async (key) => { used.push(key); return key; });
    await pool.run(async (key) => { used.push(key); return key; });
    expect(used).toEqual(['k1', 'k2']);
  });

  it('does not cool down keys on non-provider errors and fails cleanly when all keys cool', async () => {
    let now = 0;
    const pool = makeHeliusApiKeyPool(['k1', 'k2'], { cooldownMs: 60_000, now: () => now })!;

    await expect(pool.run(async () => { throw new WalletHistoryError('INVALID_PAYLOAD', 1); })).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' });

    const seen: string[] = [];
    await pool.run(async (k) => { seen.push(k); return k; });
    expect(seen).toEqual(['k1']);

    await expect(pool.run(async () => { throw new WalletHistoryError('RATE_LIMITED', 0, 429); })).rejects.toMatchObject({ code: 'RATE_LIMITED', httpStatus: 429 });
    await expect(pool.run(async () => 'never')).rejects.toMatchObject({ code: 'RATE_LIMITED', httpStatus: 429 });
  });
});
