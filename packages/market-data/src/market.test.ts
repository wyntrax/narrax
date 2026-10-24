import { describe, expect, it } from 'vitest';
import { DexScreenerSource, GeckoTerminalSource, MarketDataError, RateLimiter, USDC_MINT, WSOL_MINT, parseAuthority, tokenRisk, toNumber } from './index';

const M1 = 'AaaaAaaaAaaaAaaaAaaaAaaaAaaaAaaaAaaaAaaaAaaa'.slice(0, 44);
const M2 = 'BbbbBbbbBbbbBbbbBbbbBbbbBbbbBbbbBbbbBbbbBbbb'.slice(0, 44);

const reply = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const fast = { limiter: new RateLimiter(0) };

const pair = (over: Record<string, unknown> = {}) => ({
  chainId: 'solana', dexId: 'raydium', pairAddress: 'P1',
  baseToken: { address: M1, name: 'Zorb Token', symbol: 'ZORB' }, quoteToken: { address: WSOL_MINT, name: 'Wrapped SOL', symbol: 'SOL' },
  priceUsd: '0.00000412', liquidity: { usd: 50_000 }, volume: { h24: 120_000 }, priceChange: { h1: 4.5 }, marketCap: 4_120_000, fdv: 4_120_000, pairCreatedAt: 1_760_000_000_000,
  ...over,
});

describe('RateLimiter', () => {
  it('spaces concurrent callers by the minimum interval', async () => {
    let t = 1000;
    const sleeps: number[] = [];
    const l = new RateLimiter(200, () => t, async (ms) => { sleeps.push(ms); t += ms; });
    await Promise.all([l.wait(), l.wait(), l.wait()]);
    // The first call goes straight through. The next two are pushed to 200 ms and 400 ms after the first.
    expect(sleeps).toEqual([200, 200]);
    expect(t).toBe(1400);
  });
  it('does not sleep when enough time has passed', async () => {
    let t = 0;
    const sleeps: number[] = [];
    const l = new RateLimiter(100, () => t, async (ms) => { sleeps.push(ms); });
    await l.wait(); t = 500; await l.wait();
    expect(sleeps).toEqual([]);
  });
});

describe('toNumber', () => {
  it('never turns missing values into zero', () => {
    expect(toNumber(undefined)).toBeNull();
    expect(toNumber(null)).toBeNull();
    expect(toNumber('')).toBeNull();
    expect(toNumber('abc')).toBeNull();
    expect(toNumber(NaN)).toBeNull();
    expect(toNumber('0.5')).toBe(0.5);
  });
});

describe('DexScreenerSource', () => {
  it('parses a bare array and keeps the deepest pool for the token', async () => {
    const src = new DexScreenerSource({ ...fast, fetch: reply([pair({ pairAddress: 'thin', liquidity: { usd: 1000 } }), pair({ pairAddress: 'deep', liquidity: { usd: 90_000 } })]) });
    const s = (await src.getSnapshots([M1])).get(M1)!;
    expect(s.pairAddress).toBe('deep');
    expect(s).toMatchObject({ priceUsd: 0.00000412, liquidityUsd: 90_000, volume24hUsd: 120_000, marketCapUsd: 4_120_000, marketCapIsFdv: false, priceChange1hPct: 4.5, symbol: 'ZORB' });
    expect(s.pairCreatedAt?.getTime()).toBe(1_760_000_000_000);
  });

  it('also accepts a { pairs } envelope and treats { pairs: null } as no data', async () => {
    expect((await new DexScreenerSource({ ...fast, fetch: reply({ pairs: [pair()] }) }).getSnapshots([M1])).has(M1)).toBe(true);
    expect((await new DexScreenerSource({ ...fast, fetch: reply({ pairs: null }) }).getSnapshots([M1])).size).toBe(0);
  });

  it('drops a token instead of zero-filling a missing price, liquidity, volume or market value', async () => {
    const bad = [
      pair({ priceUsd: null }), pair({ priceUsd: '0' }), pair({ priceUsd: 'nope' }),
      pair({ liquidity: undefined }), pair({ volume: undefined }), pair({ marketCap: undefined, fdv: undefined }),
    ];
    for (const p of bad) expect((await new DexScreenerSource({ ...fast, fetch: reply([p]) }).getSnapshots([M1])).size).toBe(0);
  });

  it('keeps only allow-listed provider artwork and never invents one', async () => {
    const shot = async (imageUrl?: unknown) => (await new DexScreenerSource({ ...fast, fetch: reply([pair(imageUrl === undefined ? {} : { info: { imageUrl } })]) }).getSnapshots([M1])).get(M1)!;
    expect((await shot('https://dd.dexscreener.com/ds-data/tokens/solana/Z.png')).imageUrl).toBe('https://dd.dexscreener.com/ds-data/tokens/solana/Z.png');
    for (const imageUrl of ['https://evil.example/x.png', 'javascript:alert(1)', 42]) expect((await shot(imageUrl)).imageUrl).toBeNull();
    expect((await shot()).imageUrl).toBeNull();
  });

  it('falls back to FDV when market cap is missing and says so', async () => {
    const s = (await new DexScreenerSource({ ...fast, fetch: reply([pair({ marketCap: undefined, fdv: 9_000_000 })]) }).getSnapshots([M1])).get(M1)!;
    expect(s).toMatchObject({ marketCapUsd: 9_000_000, marketCapIsFdv: true });
  });

  it('reads a reference price when the deepest pool has no market cap or FDV', async () => {
    const body = [pair({
      baseToken: { address: WSOL_MINT, name: 'Wrapped SOL', symbol: 'SOL' },
      quoteToken: { address: USDC_MINT, name: 'USD Coin', symbol: 'USDC' },
      priceUsd: '102.38', marketCap: null, fdv: null, liquidity: { usd: 29_000_000 },
    })];
    const src = new DexScreenerSource({ ...fast, fetch: reply(body) });
    expect((await src.getSnapshots([WSOL_MINT])).size).toBe(0);
    expect((await src.getReferencePrices([WSOL_MINT])).get(WSOL_MINT)).toBe(102.38);
  });

  it('uses the deepest priced pool for a reference asset and never a zero price', async () => {
    const body = [
      pair({ baseToken: { address: WSOL_MINT, name: 'Wrapped SOL', symbol: 'SOL' }, priceUsd: '99', marketCap: null, fdv: null, liquidity: { usd: 10 } }),
      pair({ baseToken: { address: WSOL_MINT, name: 'Wrapped SOL', symbol: 'SOL' }, priceUsd: '101', marketCap: null, fdv: null, liquidity: { usd: 20_000_000 } }),
      pair({ baseToken: { address: WSOL_MINT, name: 'Wrapped SOL', symbol: 'SOL' }, priceUsd: '0', marketCap: null, fdv: null, liquidity: { usd: 40_000_000 } }),
    ];
    expect((await new DexScreenerSource({ ...fast, fetch: reply(body) }).getReferencePrices([WSOL_MINT])).get(WSOL_MINT)).toBe(101);
  });

  it('does not relax liquidity, volume, chain or mint binding for reference prices', async () => {
    for (const over of [{ liquidity: null }, { liquidity: { usd: -1 } }, { volume: null }, { volume: { h24: -1 } }, { chainId: 'base' }, { baseToken: { address: M2 } }, { priceUsd: '1e999' }]) {
      const src = new DexScreenerSource({ ...fast, fetch: reply([pair({ marketCap: null, fdv: null, ...over })]) });
      expect((await src.getReferencePrices([M1])).size).toBe(0);
    }
  });

  it('ignores other chains, unrequested tokens, and pools where the token is only the quote side', async () => {
    const body = [pair({ chainId: 'base' }), pair({ baseToken: { address: M2, name: 'x', symbol: 'x' } }), pair({ baseToken: { address: WSOL_MINT, name: 'SOL', symbol: 'SOL' }, quoteToken: { address: M1, name: 'z', symbol: 'z' } })];
    expect((await new DexScreenerSource({ ...fast, fetch: reply(body) }).getSnapshots([M1])).size).toBe(0);
  });

  it('skips one malformed pair without losing the rest', async () => {
    const s = await new DexScreenerSource({ ...fast, fetch: reply([{ nonsense: true }, pair()]) }).getSnapshots([M1]);
    expect(s.size).toBe(1);
  });

  it('batches requests in groups of 30', async () => {
    const urls: string[] = [];
    const f = (async (u: string) => { urls.push(u); return new Response('[]'); }) as unknown as typeof fetch;
    const mints = Array.from({ length: 65 }, (_, i) => `${String(i).padStart(2, '0')}`.repeat(20));
    await new DexScreenerSource({ ...fast, fetch: f }).getSnapshots(mints);
    expect(urls).toHaveLength(3);
    expect(urls[0]!.split('/').pop()!.split(',')).toHaveLength(30);
  });

  it('throws typed errors for 429, server errors, network failures and unknown bodies', async () => {
    const kind = async (f: typeof fetch) => { try { await new DexScreenerSource({ ...fast, fetch: f }).getSnapshots([M1]); return 'none'; } catch (e) { return (e as MarketDataError).kind; } };
    expect(await kind(reply({}, 429))).toBe('rate_limited');
    expect(await kind(reply({}, 500))).toBe('http');
    expect(await kind((async () => { throw new Error('down'); }) as unknown as typeof fetch)).toBe('network');
    expect(await kind(reply({ weird: 1 }))).toBe('shape');
  });
});

describe('GeckoTerminalSource.getTokenInfo', () => {
  const body = (attrs: Record<string, unknown>) => ({ data: { id: `solana_${M1}`, type: 'token', attributes: { address: M1, name: 'Zorb', symbol: 'ZORB', ...attrs } } });

  it('reads holders, concentration, authorities and honeypot status', async () => {
    const src = new GeckoTerminalSource({ ...fast, fetch: reply(body({ holders: { count: 181, distribution_percentage: { top_10: '58.0709' } }, mint_authority: 'no', freeze_authority: M2, is_honeypot: false, websites: ['https://zorb.example', 'javascript:alert(1)'], twitter_handle: 'zorb' })) });
    expect(await src.getTokenInfo(M1)).toMatchObject({ holders: 181, top10Pct: 58.0709, mintAuthorityActive: false, freezeAuthorityActive: true, isHoneypot: false, websites: ['https://zorb.example'], twitterHandle: 'zorb' });
  });

  it('reports unknown, not zero, when holder data is absent or implausible', async () => {
    for (const holders of [undefined, null, { count: 0, distribution_percentage: { top_10: '120' } }, { count: null, distribution_percentage: null }]) {
      const r = await new GeckoTerminalSource({ ...fast, fetch: reply(body({ holders })) }).getTokenInfo(M1);
      expect(r).toMatchObject({ holders: null, top10Pct: null });
    }
  });

  it('treats a non-boolean honeypot value as unknown', async () => {
    expect((await new GeckoTerminalSource({ ...fast, fetch: reply(body({ is_honeypot: 'unknown' })) }).getTokenInfo(M1))!.isHoneypot).toBeNull();
  });

  it('returns null for 404 and throws for a changed shape', async () => {
    expect(await new GeckoTerminalSource({ ...fast, fetch: reply({}, 404) }).getTokenInfo(M1)).toBeNull();
    await expect(new GeckoTerminalSource({ ...fast, fetch: reply({ data: {} }) }).getTokenInfo(M1)).rejects.toMatchObject({ kind: 'shape' });
    await expect(new GeckoTerminalSource({ ...fast, fetch: reply({}, 429) }).getTokenInfo(M1)).rejects.toMatchObject({ kind: 'rate_limited' });
  });

  it('parseAuthority only calls an address-shaped value active', () => {
    expect(parseAuthority(M2)).toBe(true);
    expect(parseAuthority('no')).toBe(false);
    expect(parseAuthority(null)).toBeNull();
    expect(parseAuthority('???')).toBeNull();
  });
});

describe('GeckoTerminalSource.getNewPools', () => {
  it('uses the API path for an origin-only configuration and discovers both pool samples', async () => {
    const urls:string[]=[];
    const src=new GeckoTerminalSource({...fast,baseUrl:'https://api.geckoterminal.com/',fetch:async(input)=>{urls.push(String(input));return new Response(JSON.stringify({data:[]}),{status:200});}});
    await src.getNewPools();await src.getTrendingPools();
    expect(urls).toEqual(['https://api.geckoterminal.com/api/v2/networks/solana/new_pools?include=base_token&page=1','https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?include=base_token&page=1']);
  });
  const pool = (tokenId: string, over: Record<string, unknown> = {}) => ({
    id: `solana_pool${tokenId}`, type: 'pool',
    attributes: { address: 'Pool1', name: 'ZORB / SOL', pool_created_at: '2026-09-30T11:00:00Z', reserve_in_usd: '42000.5', ...over },
    relationships: { base_token: { data: { id: tokenId, type: 'token' } } },
  });

  it('maps pools to mints using the included token, and parses liquidity', async () => {
    const f = reply({ data: [pool(`solana_${M1}`)], included: [{ id: `solana_${M1}`, type: 'token', attributes: { address: M1, name: 'Zorb Token', symbol: 'ZORB' } }] });
    const [p] = await new GeckoTerminalSource({ ...fast, fetch: f }).getNewPools();
    expect(p).toMatchObject({ mint: M1, symbol: 'ZORB', name: 'Zorb Token', liquidityUsd: 42000.5, poolAddress: 'Pool1' });
    expect(p!.createdAt.toISOString()).toBe('2026-09-30T11:00:00.000Z');
  });

  it('falls back to the pool name and id, and skips quote assets, bad times and bad mints', async () => {
    const f = reply({ data: [pool(`solana_${M1}`), pool(`solana_${WSOL_MINT}`), pool(`solana_${USDC_MINT}`), pool(`solana_${M2}`, { pool_created_at: 'garbage' }), pool('solana_short')] });
    const r = await new GeckoTerminalSource({ ...fast, fetch: f }).getNewPools();
    expect(r.map((p) => p.mint)).toEqual([M1]);
    expect(r[0]).toMatchObject({ symbol: 'ZORB', name: 'ZORB' });
  });

  it('keeps liquidity null when the source does not give it', async () => {
    const [p] = await new GeckoTerminalSource({ ...fast, fetch: reply({ data: [pool(`solana_${M1}`, { reserve_in_usd: null })] }) }).getNewPools();
    expect(p!.liquidityUsd).toBeNull();
  });
});

describe('tokenRisk', () => {
  const base = { liquidityUsd: 100_000, holders: 500, top10Pct: 25, devHoldingPct: 2, mintAuthorityActive: false, freezeAuthorityActive: false, isHoneypot: false, pairAgeMinutes: 600 };
  it('scores a clean token at zero with no flags', () => {
    expect(tokenRisk(base)).toEqual({ riskScore: 0, flags: [] });
  });
  it('treats a honeypot as maximum risk on its own', () => {
    expect(tokenRisk({ ...base, isHoneypot: true })).toEqual({ riskScore: 100, flags: ['HONEYPOT'] });
  });
  it('adds points for confirmed problems only', () => {
    const r = tokenRisk({ ...base, mintAuthorityActive: true, freezeAuthorityActive: true, top10Pct: 70, liquidityUsd: 5_000, holders: 10, pairAgeMinutes: 5 });
    expect(r.flags).toEqual(['MINT_AUTHORITY_ACTIVE', 'FREEZE_AUTHORITY_ACTIVE', 'TOP10_OVER_60', 'THIN_LIQUIDITY', 'FEW_HOLDERS', 'VERY_NEW']);
    expect(r.riskScore).toBe(100);
  });
  it('flags unknown inputs without lowering or inflating the score', () => {
    const r = tokenRisk({ ...base, holders: null, top10Pct: null, devHoldingPct: null, mintAuthorityActive: null, freezeAuthorityActive: null, isHoneypot: null });
    expect(r.flags).toEqual(['HOLDERS_UNKNOWN', 'DEV_HOLDING_UNKNOWN', 'CONCENTRATION_UNKNOWN']);
    expect(r.riskScore).toBe(5);
  });
  it('uses the 40 to 60 band for concentration', () => {
    expect(tokenRisk({ ...base, top10Pct: 45 }).flags).toEqual(['TOP10_OVER_40']);
  });
});
