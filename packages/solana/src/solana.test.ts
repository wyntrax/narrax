import { describe, expect, it } from 'vitest';
import { JupiterClient, QuoteError, WSOL_MINT, isQuoteFresh, parseHeliusSwaps, verifyWebhookAuth } from './index';

const MINT = 'Tok1111111111111111111111111111111111111111';
const WALLET = 'Wal1111111111111111111111111111111111111111';
const SIG = 'sig'.padEnd(64, '1');
const tokenLeg = (mint: string, amt: string, dec = 6) => ({ mint, rawTokenAmount: { tokenAmount: amt, decimals: dec } });

describe('parseHeliusSwaps', () => {
  it('parses a native SOL buy', () => {
    const r = parseHeliusSwaps([{ signature: SIG, timestamp: 1_790_000_000, slot: 5, feePayer: WALLET, type: 'SWAP',
      events: { swap: { nativeInput: { account: WALLET, amount: '2500000000' }, tokenOutputs: [tokenLeg(MINT, '1000000')] } } }]);
    expect(r.events).toEqual([{ signature: SIG, wallet: WALLET, mint: MINT, side: 'BUY', amountSol: 2.5, tokenAmount: 1, slot: 5, at: new Date(1_790_000_000_000).toISOString() }]);
  });
  it('parses a sell into wrapped SOL', () => {
    const r = parseHeliusSwaps([{ signature: SIG, timestamp: 1_790_000_000, feePayer: WALLET,
      events: { swap: { tokenInputs: [tokenLeg(MINT, '500000')], tokenOutputs: [tokenLeg(WSOL_MINT, '1500000000', 9)] } } }]);
    expect(r.events[0]).toMatchObject({ side: 'SELL', mint: MINT, amountSol: 1.5, tokenAmount: 0.5 });
  });
  it('skips token-to-token swaps, transfers and malformed items instead of guessing', () => {
    const r = parseHeliusSwaps([
      { signature: SIG, timestamp: 1, feePayer: WALLET, events: { swap: { tokenInputs: [tokenLeg(MINT, '1')], tokenOutputs: [tokenLeg('Other'.padEnd(40, '1'), '1')] } } },
      { signature: SIG, timestamp: 1, feePayer: WALLET, events: {} },
      { nonsense: true }, 'string', null,
    ]);
    expect(r.events).toHaveLength(0);
    expect(r.skipped).toBe(5);
    expect(parseHeliusSwaps({ not: 'an array' })).toEqual({ events: [], skipped: 0 });
  });
});

describe('verifyWebhookAuth', () => {
  it('accepts only the exact secret', () => {
    expect(verifyWebhookAuth('s3cret-value', 's3cret-value')).toBe(true);
    expect(verifyWebhookAuth('s3cret-valuf', 's3cret-value')).toBe(false);
    expect(verifyWebhookAuth('short', 's3cret-value')).toBe(false);
    expect(verifyWebhookAuth(undefined, 's3cret-value')).toBe(false);
    expect(verifyWebhookAuth('', '')).toBe(false);
  });
});

const okFetch = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const body = { inputMint: WSOL_MINT, outputMint: MINT, inAmount: '250000000', outAmount: '900000', priceImpactPct: '0.012', slippageBps: 100 };
const req = { inputMint: WSOL_MINT, outputMint: MINT, amount: 250_000_000n, slippageBps: 100 };

describe('JupiterClient', () => {
  it('returns a normalized quote and converts a fractional price impact to percent', async () => {
    const now = new Date('2026-09-30T10:00:00Z');
    const q = await new JupiterClient({ fetch: okFetch(body), now: () => now }).getQuote(req);
    expect(q.priceImpactPct).toBeCloseTo(1.2);
    expect(q.fetchedAt).toEqual(now);
    expect((await new JupiterClient({ fetch: okFetch(body), priceImpactFormat: 'percent' }).getQuote(req)).priceImpactPct).toBeCloseTo(0.012);
  });
  it('sends the api key and query parameters', async () => {
    let seen: { url?: URL; headers?: HeadersInit } = {};
    const f = (async (u: URL, init: RequestInit) => { seen = { url: u, headers: init.headers }; return new Response(JSON.stringify(body)); }) as unknown as typeof fetch;
    await new JupiterClient({ fetch: f, apiKey: 'k' }).getQuote(req);
    expect(seen.url?.searchParams.get('amount')).toBe('250000000');
    expect(seen.url?.searchParams.get('slippageBps')).toBe('100');
    expect(seen.headers).toEqual({ 'x-api-key': 'k' });
  });
  it('fails closed on HTTP errors, bad shapes and timeouts', async () => {
    await expect(new JupiterClient({ fetch: okFetch({}, 500) }).getQuote(req)).rejects.toThrow(QuoteError);
    await expect(new JupiterClient({ fetch: okFetch({ hello: 1 }) }).getQuote(req)).rejects.toThrow('unexpected shape');
    const hang = ((_u: URL, init: RequestInit) => new Promise((_r, rej) => init.signal?.addEventListener('abort', () => rej(new Error('x'))))) as unknown as typeof fetch;
    await expect(new JupiterClient({ fetch: hang, timeoutMs: 20 }).getQuote(req)).rejects.toThrow(QuoteError);
  });
  it('knows when a quote is stale', () => {
    const q = { fetchedAt: new Date('2026-09-30T10:00:00Z') } as never;
    expect(isQuoteFresh(q, new Date('2026-09-30T10:00:03Z'))).toBe(true);
    expect(isQuoteFresh(q, new Date('2026-09-30T10:00:09Z'))).toBe(false);
    expect(isQuoteFresh(q, new Date('2026-09-30T09:59:59Z'))).toBe(false);
  });
});
