import { describe, expect, it } from 'vitest';
import { MarketDataError, RugCheckSource, parseRugCheckReport } from './index';

const MINT = 'FRxQFfRZZpr6aXWsVAhYQ1n3rUPHD89QbNqQFmqNpump';
const reply = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const market = (over: Record<string, unknown> = {}) => ({
  pubkey: 'POOL1111111111111111111111111111111111111111',
  mintLP: 'LP11111111111111111111111111111111111111111',
  liquidityAAccount: { owner: 'POOL1111111111111111111111111111111111111111' },
  liquidityBAccount: { owner: 'POOL1111111111111111111111111111111111111111' },
  lp: { lpMint: 'LP11111111111111111111111111111111111111111', lpLockedPct: 100, quoteUSD: 1000, baseUSD: 2000, lpTotalSupply: '1000' },
  ...over,
});
const holders = [
  { address: 'pool-token-account', pct: 30, owner: 'POOL1111111111111111111111111111111111111111', insider: false },
  { address: 'locker-token-account', pct: 5, owner: 'LOCK1111111111111111111111111111111111111111', insider: false },
  ...[10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0.5].map((pct, i) => ({ address: `holder-${i}`, pct, owner: `owner-${i}`, insider: false })),
];
const report = (over: Record<string, unknown> = {}) => ({
  mint: MINT,
  creator: 'creator-wallet',
  creatorBalance: '250',
  token: { supply: '1000' },
  topHolders: holders,
  knownAccounts: {
    'POOL1111111111111111111111111111111111111111': { type: 'AMM' },
    'LOCK1111111111111111111111111111111111111111': { type: 'LOCKER' },
  },
  markets: [market()],
  totalHolders: 50,
  rugged: false,
  risks: [{ name: 'Low Liquidity', level: 'warn' }],
  detectedAt: '2026-10-20T23:51:17.840Z',
  ...over,
});

describe('parseRugCheckReport', () => {
  it('removes known pool and locker accounts from top-10, maps LP and dev holding, and keeps unknowns null', () => {
    expect(parseRugCheckReport(report())).toMatchObject({
      mint: MINT,
      creator: 'creator-wallet',
      devHoldingPct: 25,
      top10ExLpPct: 55,
      lpLockedPct: 100,
      lpLocked: true,
      rugged: false,
      riskFlags: [],
      totalHolders: 50,
    });
  });

  it('does not claim a top-10 sum when the report is missing holders', () => {
    expect(parseRugCheckReport(report({ topHolders: holders.slice(0, 4) })).top10ExLpPct).toBeNull();
  });

  it('picks the fungible LP market with the most liquidity and treats an unlocked LP as a block-ready fact', () => {
    const r = parseRugCheckReport(report({
      markets: [
        market({ lp: { lpMint: 'LP11111111111111111111111111111111111111111', lpLockedPct: 0, quoteUSD: 100, baseUSD: 100, lpTotalSupply: '1000' } }),
        market({ pubkey: 'POOL2222222222222222222222222222222222222222', lp: { lpMint: 'LP22222222222222222222222222222222222222222', lpLockedPct: 100, quoteUSD: 5, baseUSD: 5, lpTotalSupply: '1000' } }),
      ],
    }));
    expect(r.lpLockedPct).toBe(0);
    expect(r.lpLocked).toBe(false);
  });

  it('maps only explicit danger/authority flags, never the heuristic score', () => {
    const r = parseRugCheckReport(report({
      rugged: true,
      risks: [{ name: 'Honeypot', level: 'danger' }, { name: 'Mint Authority', level: 'danger' }, { name: 'Freeze Authority', level: 'danger' }],
    }));
    expect(r.riskFlags).toEqual(['RUGGED', 'HONEYPOT', 'MINT_AUTHORITY_ACTIVE', 'FREEZE_AUTHORITY_ACTIVE']);
  });

  it('fails closed on an unexpected body instead of filling missing facts', () => {
    expect(() => parseRugCheckReport({ mint: MINT, topHolders: 'not-an-array' })).toThrow(MarketDataError);
  });

  it('treats a 404 as no report and never calls for an invalid mint', async () => {
    let calls = 0;
    const fakeFetch = (async () => { calls++; return new Response('{}', { status: 404 }); }) as unknown as typeof fetch;
    const source = new RugCheckSource({ baseUrl: 'https://rugcheck.test', fetch: fakeFetch });
    expect(await source.getReport(MINT)).toBeNull();
    expect(await source.getReport('not-a-mint')).toBeNull();
    expect(await source.getReport('1'.repeat(44))).toBeNull();
    expect(calls).toBe(1);
  });

  it('parses a live-shaped response through the HTTP source', async () => {
    const source = new RugCheckSource({ baseUrl: 'https://rugcheck.test', fetch: reply(report()) });
    expect(await source.getReport(MINT)).toMatchObject({ devHoldingPct: 25, top10ExLpPct: 55, lpLocked: true });
  });

  it('rejects a report for a different mint', async () => {
    const source = new RugCheckSource({ fetch: reply(report({ mint: '7thgKgtK1rp1UtLpWUZEuu9vakedTMoZzuyps6RGpump' })) });
    await expect(source.getReport(MINT)).rejects.toThrow('different mint');
  });

  it('times out a stalled response body after headers arrive', async () => {
    const fakeFetch: typeof fetch = async (_url, init) => new Response(new ReadableStream({
      start(controller) { init?.signal?.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true }); },
    }));
    const source = new RugCheckSource({ fetch: fakeFetch, timeoutMs: 10 });
    await expect(source.getReport(MINT)).rejects.toMatchObject({ kind: 'network' });
  });

  it('does not substitute a small locked pool when the dominant pool has unknown lock evidence', () => {
    const r = parseRugCheckReport(report({ markets: [market({ lp: { quoteUSD: 10_000, baseUSD: 10_000 } }), market()] }));
    expect(r.lpLocked).toBeNull();
    expect(parseRugCheckReport(report({ markets: [market({ lp: { lpLockedPct: 100 } })] })).lpLocked).toBeNull();
  });

  it('rejects invalid percentages and keeps absent rug status unknown', () => {
    expect(() => parseRugCheckReport(report({ topHolders: [{ address: 'invalid', pct: -1 }] }))).toThrow(MarketDataError);
    expect(parseRugCheckReport(report({ rugged: undefined, risks: [{ name: 'Mint Authority disabled' }] }))).toMatchObject({ rugged: null, riskFlags: [] });
  });
});
