import { describe, expect, it, vi } from 'vitest';
import { createTregClient, TREG_ENDPOINTS } from './tregClient';
import { parseTregPage, TregNarrativeProvider } from './tregProvider';
import { readTregConfig } from './tregConfig';

const now = new Date('2026-10-14T12:00:00Z'), since = new Date('2026-10-12T12:00:00Z');
const at = now.getTime() / 1000 - 60;
const x = { id: 'post-1', authorUsername: 'alice', text: 'Solana narrative observation', createdUtc: at, likeCount: 2, replyCount: 1, retweetCount: 3, quoteCount: 0 };
const wrap = (key: string, rows: unknown[], cursor: string | null = null) => ({ output: { found: !!rows.length, data: { [key]: rows, nextCursor: cursor } } });

describe('Treg social contracts', () => {
  it('maps the catalog-confirmed X, Reddit and TikTok shapes; views are not engagement', () => {
    expect(parseTregPage('x', wrap('items', [x]), since, now).mentions[0]).toMatchObject({ platform: 'x', externalId: 'post-1', creatorHandle: 'alice', engagement: 6, creatorAgeDays: null });
    const reddit = { id: 'r1', author: 'bob', title: 'Solana', selftext: 'Research notes', createdUtc: at, score: -2, numComments: 4 };
    expect(parseTregPage('reddit', wrap('posts', [reddit]), since, now).mentions[0]).toMatchObject({ text: 'Solana\nResearch notes', engagement: 4, creatorAgeDays: null });
    const video = { id: 't1', author: 'carol', caption: 'Solana video', createdUtc: at, likes: 2, comments: 3, shares: 4, views: 999999 };
    expect(parseTregPage('tiktok', wrap('videos', [video]), since, now).mentions[0]).toMatchObject({ platform: 'tiktok', engagement: 9 });
  });
  it('rejects unknown envelopes, malformed arrays, missing dates and missing metrics instead of making observations', () => {
    expect(() => parseTregPage('x', { data: { items: [] } }, since, now)).toThrow('TREG_INVALID_RESPONSE');
    for (const change of [{ createdUtc: null }, { createdUtc: '2026-10-14' }, { likeCount: undefined }, { id: Number.MAX_SAFE_INTEGER + 1 }, { authorUsername: '[deleted]' }]) {
      expect(() => parseTregPage('x', wrap('items', [{ ...x, ...change }]), since, now)).toThrow('TREG_INVALID_RECORDS');
    }
  });
  it('filters old/future records, deduplicates ids and preserves real zeros', () => {
    const result = parseTregPage('x', wrap('items', [x, x, { ...x, id: 'future', createdUtc: at + 500 }, { ...x, id: 'old', createdUtc: at - 86400 * 3 }, { ...x, id: 'zero', likeCount: 0, retweetCount: 0, replyCount: 0 }]), since, now);
    expect(result.mentions).toHaveLength(2); expect(result.mentions[1]!.engagement).toBe(0); expect(result.outsideWindow).toBe(2);
  });
  it('counts invalid rows separately from genuine empty searches', () => {
    const partial = parseTregPage('x', wrap('items', [x, { broken: true }]), since, now);
    expect(partial.invalid).toBe(1); expect(partial.mentions).toHaveLength(1);
    expect(parseTregPage('x', wrap('items', []), since, now)).toMatchObject({ mentions: [], received: 0, invalid: 0 });
  });
  it('bounds engagement to the storage integer range', () => {
    expect(parseTregPage('x', wrap('items', [{ ...x, likeCount: 5000000000 }]), since, now).mentions[0]!.engagement).toBe(2147483647);
  });
});

describe('bounded watchlist provider', () => {
  it('uses exact native request parameters, opaque cursors and deduplicates repeated pages', async () => {
    const call = vi.fn().mockResolvedValueOnce(wrap('items', [x], 'opaque+/=')).mockResolvedValueOnce(wrap('items', [x, { ...x, id: 'post-2' }], 'opaque+/='));
    const provider = new TregNarrativeProvider({ platform: 'x', topics: [{ name: 'Solana', query: 'solana OR $SOL' }], call, now, maxPages: 3, runId: 'one-job' });
    const [topic] = await provider.getTrendingTopics();
    expect(await provider.getTopicActivity(topic!, since)).toHaveLength(2);
    expect(call).toHaveBeenCalledTimes(2);
    expect(call.mock.calls[0]!.slice(0, 2)).toEqual([TREG_ENDPOINTS.x, { query: '(solana OR $SOL) since:2026-10-12', queryType: 'Latest', limit: 20 }]);
    expect(call.mock.calls[1]![1].cursor).toBe('opaque+/=');
  });
  it('one page is the default; stable job context reuses the same idempotency key', async () => {
    const call = vi.fn().mockResolvedValue(wrap('posts', [], 'more'));
    const options = { platform: 'reddit' as const, topics: [{ name: 'Solana', query: 'solana' }], call, now, runId: 'repeatable' };
    for (let i = 0; i < 2; i++) { const provider = new TregNarrativeProvider(options); await provider.getTopicActivity((await provider.getTrendingTopics())[0]!, since); }
    expect(call).toHaveBeenCalledTimes(2); expect(call.mock.calls[0]![2]).toBe(call.mock.calls[1]![2]);
    expect(call.mock.calls[0]![1]).toEqual({ query: 'solana', sort: 'relevance', timeframe: 'all' });
  });
  it('does not quietly retain a partial page set after a provider failure', async () => {
    const call = vi.fn().mockResolvedValueOnce(wrap('items', [x], 'next')).mockRejectedValueOnce(new Error('failed'));
    const provider = new TregNarrativeProvider({ platform: 'x', topics: [{ name: 'Solana', query: 'solana' }], call, now, maxPages: 2 });
    await expect(provider.getTopicActivity((await provider.getTrendingTopics())[0]!, since)).rejects.toThrow('failed');
  });
});

describe('Treg authenticated transport', () => {
  it('records authoritative charge headers, caps spend, disables redirects and sets server-owned tags', async () => {
    const receipt = vi.fn(), fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(wrap('items', [x])), { headers: { 'X-Treg-Call-Id': 'call-1', 'X-Treg-Cost-Micro': '750' } }));
    const call = createTregClient({ token: 'test-token', org: 'test-org', fetcher, onReceipt: receipt });
    await call(TREG_ENDPOINTS.x, { query: 'solana' }, 'same-request');
    expect(fetcher).toHaveBeenCalledWith('https://treg.to/call/anyapi.x.search.posts', expect.objectContaining({ redirect: 'error', method: 'POST', headers: expect.objectContaining({ 'X-Treg-Token': 'test-token', 'X-Treg-Org': 'test-org', 'X-Treg-Route-Max-Cost': '0.010000', 'Idempotency-Key': 'same-request', 'X-Treg-Meta': 'feature=narrative-ingestion' }) }));
    expect(receipt).toHaveBeenCalledWith(expect.objectContaining({ callId: 'call-1', costMicro: 750, status: 200 }));
  });
  it('does not substitute body costs for missing ledger headers or retry an HTTP error', async () => {
    const receipt = vi.fn(), fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ token: 'do-not-log', costUsd: 2, balance_micro: 99 }), { status: 429, headers: { 'Retry-After': '30' } }));
    const call = createTregClient({ token: 'test', fetcher, onReceipt: receipt });
    await expect(call(TREG_ENDPOINTS.x, {}, 'id')).rejects.toMatchObject({ message: 'TREG_HTTP_429', retryAfterSeconds: 30 });
    expect(fetcher).toHaveBeenCalledOnce(); expect(receipt).toHaveBeenCalledWith(expect.objectContaining({ costMicro: null }));
  });
  it('handles pending work and invalid payloads as errors, not empty activity', async () => {
    for (const response of [new Response('{}', { status: 202 }), new Response('<html>error</html>')]) {
      const call = createTregClient({ token: 'test', fetcher: vi.fn().mockResolvedValue(response) });
      await expect(call(TREG_ENDPOINTS.x, {}, 'id')).rejects.toThrow(/TREG_PENDING|TREG_INVALID_RESPONSE/);
    }
  });
  it('distinguishes pending reservations from charges and marks idempotent replays', async () => {
    const receipt = vi.fn();
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 202, headers: { 'X-Treg-Cost-Micro': '750', 'X-Treg-Async': '1' } }))
      .mockResolvedValueOnce(new Response('{}', { headers: { 'X-Treg-Cost-Micro': '0', 'X-Treg-Idempotent-Replay': '1' } }));
    const call = createTregClient({ token: 'test', fetcher, onReceipt: receipt });
    await expect(call(TREG_ENDPOINTS.x, {}, 'id')).rejects.toThrow('TREG_PENDING');
    expect(receipt).toHaveBeenNthCalledWith(1, expect.objectContaining({ costMicro: null, status: 202 }));
    await call(TREG_ENDPOINTS.x, {}, 'id');
    expect(receipt).toHaveBeenNthCalledWith(2, expect.objectContaining({ costMicro: 0, replayed: true }));
  });
  it('aborts requests at the timeout without leaking network errors', async () => {
    const fetcher = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('private network detail')))));
    await expect(createTregClient({ token: 'test', timeoutMs: 5, fetcher })(TREG_ENDPOINTS.x, {}, 'id')).rejects.toThrow('TREG_TIMEOUT');
  });
  it('stops oversized bodies', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(new Uint8Array(8 * 1024 * 1024 + 1)));
    await expect(createTregClient({ token: 'test', fetcher })(TREG_ENDPOINTS.x, {}, 'id')).rejects.toThrow('TREG_RESPONSE_TOO_LARGE');
  });
});

describe('Treg worker enablement', () => {
  const enabled = { TREG_NARRATIVE_ENABLED: 'true', TREG_TOKEN: 'test', TREG_NARRATIVE_TOPICS: JSON.stringify([{ name: 'Solana', query: 'solana' }]) };
  it('a token alone starts no jobs; explicit configuration has bounded defaults', () => {
    expect(readTregConfig({ TREG_TOKEN: 'test' })).toBeNull();
    expect(readTregConfig(enabled)).toMatchObject({ platforms: ['x', 'reddit', 'tiktok'], maxPages: 1, maxCostUsd: .01, intervalMs: 1800000 });
  });
  it.each([{ TREG_TOKEN: '' }, { TREG_NARRATIVE_TOPICS: 'secret-invalid' }, { TREG_NARRATIVE_PLATFORMS: 'x,x' }, { TREG_NARRATIVE_MAX_PAGES: '100' }, { TREG_MAX_COST_USD: 'NaN' }, { TREG_NARRATIVE_INTERVAL_MS: '1' }])('refuses invalid enabled configuration: %j', change => {
    expect(() => readTregConfig({ ...enabled, ...change })).toThrow(/TREG/);
  });
});

describe('Treg worker topic packs', () => {
  const env = { TREG_NARRATIVE_ENABLED: 'true', TREG_TOKEN: 'test' };
  it('packs alone are enough, and the old single-topic JSON still works', () => {
    expect(readTregConfig({ ...env, TREG_NARRATIVE_PACKS: 'trencher,holder' })!.topics.length).toBeGreaterThan(5);
    expect(readTregConfig({ ...env, TREG_NARRATIVE_TOPICS: JSON.stringify([{ name: 'Solana ecosystem', query: 'solana' }]) })!.topics).toEqual([{ name: 'Solana ecosystem', query: 'solana' }]);
  });
  it('packs and custom topics combine; bad input is refused rather than dropped', () => {
    const cfg = readTregConfig({ ...env, TREG_NARRATIVE_PACKS: 'trencher', TREG_NARRATIVE_TOPICS: JSON.stringify([{ name: 'Zorblax', query: 'zorblax' }]) })!;
    expect(cfg.topics[0]).toEqual({ name: 'Zorblax', query: 'zorblax' });
    expect(() => readTregConfig({ ...env, TREG_NARRATIVE_PACKS: 'nope' })).toThrow('INVALID_TREG_PACK');
    expect(() => readTregConfig({ ...env })).toThrow('INVALID_TREG_TOPICS_JSON');
    expect(() => readTregConfig({ ...env, TREG_NARRATIVE_PACKS: 'trencher', TREG_NARRATIVE_TOPICS: JSON.stringify(Array.from({ length: 6 }, (_, i) => ({ name: `Extra topic ${String.fromCharCode(97 + i)}`, query: 'q' }))) })).toThrow('TOO_MANY_TREG_TOPICS');
  });
});
