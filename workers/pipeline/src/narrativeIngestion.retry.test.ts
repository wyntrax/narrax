import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@narra/database';
import type { NarrativeProvider } from '@narra/narrative';
import { ingestNarratives } from './narrativeIngestion';

class FakeProviderError extends Error {
  constructor(readonly code: string, readonly status = 0, readonly retryAfterSeconds = 0) { super(code); }
}

// The failing paths never touch the database; the cast keeps the test focused on retry behavior.
const db = {} as PrismaClient;
const now = new Date('2026-11-22T12:00:00Z');

describe('ingestNarratives provider retries', () => {
  it('retries a 429 topic failure, then reports one provider error and two retries', async () => {
    const sleeps: number[] = [];
    const retries: Array<[string, number, number]> = [];
    const errors: string[] = [];
    const provider: NarrativeProvider = {
      name: 'flaky',
      getTrendingTopics: async () => [{ externalId: 't1', name: 'Topic One' }],
      getTopicActivity: async () => { throw new FakeProviderError('TREG_HTTP_429', 429, 1); },
    };
    const result = await ingestNarratives(db, [provider], now, {
      providerRetryAttempts: 3,
      providerRetryBaseDelayMs: 500,
      providerRetryMaxDelayMs: 5_000,
      sleep: async (ms) => { sleeps.push(ms); },
      onProviderRetry: (name, attempt, delay) => { retries.push([name, attempt, delay]); },
      onProviderError: (name) => { errors.push(name); },
    });
    expect(result).toMatchObject({ topicsSeen: 1, providerErrors: 1, providerRetries: 2, mentionsStored: 0 });
    expect(sleeps).toEqual([1_000, 1_000]);
    expect(retries).toEqual([['flaky', 2, 1_000], ['flaky', 3, 1_000]]);
    expect(errors).toEqual(['flaky']);
  });

  it('retries a trending-topics failure before giving up', async () => {
    let calls = 0;
    const retries: number[] = [];
    const provider: NarrativeProvider = {
      name: 'flaky-topics',
      getTrendingTopics: async () => {
        calls++;
        if (calls < 3) throw new FakeProviderError('TREG_HTTP_502', 502);
        return [];
      },
      getTopicActivity: async () => [],
    };
    const result = await ingestNarratives(db, [provider], now, {
      sleep: async () => {},
      onProviderRetry: (_name, attempt) => { retries.push(attempt); },
    });
    expect(calls).toBe(3);
    expect(retries).toEqual([2, 3]);
    expect(result).toMatchObject({ topicsSeen: 0, providerErrors: 0, providerRetries: 2 });
  });
});
