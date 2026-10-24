import type { LaunchSource, MarketQuoteSource, MarketSnapshot, NewPool, TokenInfo, TokenInfoSource } from './types';

/**
 * In-memory source for tests and local development. It implements all three ports, so the worker can run end to end
 * with no network. Anything not registered is simply absent, which is how a real source behaves for an unknown token.
 */
export class FixtureMarketData implements MarketQuoteSource, TokenInfoSource, LaunchSource {
  readonly name = 'fixture';
  readonly infoCalls: string[] = [];
  constructor(private readonly data: { snapshots?: MarketSnapshot[]; info?: TokenInfo[]; pools?: NewPool[] } = {}) {}
  async getSnapshots(mints: string[]) {
    const wanted = new Set(mints);
    return new Map((this.data.snapshots ?? []).filter((s) => wanted.has(s.mint)).map((s) => [s.mint, s]));
  }
  async getReferencePrices(mints: string[]) {
    const wanted = new Set(mints);
    return new Map((this.data.snapshots ?? []).filter((s) => wanted.has(s.mint) && s.priceUsd > 0).map((s) => [s.mint, s.priceUsd]));
  }
  async getTokenInfo(mint: string) {
    this.infoCalls.push(mint);
    return (this.data.info ?? []).find((i) => i.mint === mint) ?? null;
  }
  async getNewPools() { return this.data.pools ?? []; }
}

export function snapshot(mint: string, over: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return { mint, symbol: 'TKN', name: 'Token', priceUsd: 0.01, marketCapUsd: 1_000_000, marketCapIsFdv: false, liquidityUsd: 100_000, volume24hUsd: 250_000, priceChange1hPct: null, pairAddress: `pair-${mint}`, dexId: 'raydium', pairCreatedAt: null, ...over };
}

export function info(mint: string, over: Partial<TokenInfo> = {}): TokenInfo {
  return { mint, name: null, symbol: null, holders: 500, top10Pct: 30, mintAuthorityActive: false, freezeAuthorityActive: false, isHoneypot: false, websites: [], twitterHandle: null, ...over };
}
