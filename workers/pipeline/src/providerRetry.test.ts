import { describe, expect, it } from 'vitest';
import { isRetryableProviderError, retryProviderCall } from './providerRetry';

class FakeProviderError extends Error {
  constructor(readonly code: string, readonly status = 0, readonly retryAfterSeconds = 0) { super(code); }
}

describe('retryProviderCall', () => {
  it('retries a 429, honors Retry-After, and reports each retry', async () => {
    const sleeps: number[] = [];
    const retries: Array<[number, number]> = [];
    let calls = 0;
    const result = await retryProviderCall(async () => {
      calls++;
      if (calls < 3) throw new FakeProviderError('TREG_HTTP_429', 429, 2);
      return 'ok';
    }, {
      attempts: 3, baseDelayMs: 500, maxDelayMs: 5_000,
      sleep: async (ms) => { sleeps.push(ms); },
      onRetry: (attempt, delay) => { retries.push([attempt, delay]); },
    });
    expect(result).toBe('ok');
    expect(calls).toBe(3);
    expect(sleeps).toEqual([2_000, 2_000]);
    expect(retries).toEqual([[2, 2_000], [3, 2_000]]);
  });

  it('retries a 502 with exponential backoff', async () => {
    const sleeps: number[] = [];
    let calls = 0;
    await retryProviderCall(async () => {
      calls++;
      if (calls < 3) throw new FakeProviderError('TREG_HTTP_502', 502);
      return 'ok';
    }, { sleep: async (ms) => { sleeps.push(ms); } });
    expect(calls).toBe(3);
    expect(sleeps).toEqual([500, 1_000]);
  });

  it('does not retry auth or validation failures', async () => {
    let calls = 0;
    await expect(retryProviderCall(async () => {
      calls++;
      throw new FakeProviderError('TREG_HTTP_401', 401);
    }, { sleep: async () => {} })).rejects.toMatchObject({ code: 'TREG_HTTP_401' });
    expect(calls).toBe(1);
  });

  it('stops after the attempt limit and rethrows the last error', async () => {
    let calls = 0;
    await expect(retryProviderCall(async () => {
      calls++;
      throw new FakeProviderError('TREG_HTTP_502', 502);
    }, { attempts: 3, sleep: async () => {} })).rejects.toMatchObject({ code: 'TREG_HTTP_502' });
    expect(calls).toBe(3);
  });

  it('caps a large Retry-After at maxDelayMs', async () => {
    const sleeps: number[] = [];
    await expect(retryProviderCall(async () => {
      throw new FakeProviderError('TREG_HTTP_429', 429, 60);
    }, { attempts: 2, maxDelayMs: 5_000, sleep: async (ms) => { sleeps.push(ms); } })).rejects.toMatchObject({ code: 'TREG_HTTP_429' });
    expect(sleeps).toEqual([5_000]);
  });

  it('classifies only transient provider failures', () => {
    expect(isRetryableProviderError(new FakeProviderError('x', 429))).toBe(true);
    expect(isRetryableProviderError(new FakeProviderError('x', 503))).toBe(true);
    expect(isRetryableProviderError(new FakeProviderError('TREG_TIMEOUT'))).toBe(true);
    expect(isRetryableProviderError(new FakeProviderError('TREG_REQUEST_FAILED'))).toBe(true);
    expect(isRetryableProviderError(new FakeProviderError('x', 401))).toBe(false);
    expect(isRetryableProviderError(new FakeProviderError('x', 400))).toBe(false);
    expect(isRetryableProviderError(new Error('x'))).toBe(false);
  });
});
