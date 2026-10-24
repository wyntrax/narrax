export type MarketDataErrorKind = 'rate_limited' | 'http' | 'network' | 'shape';

/** Every provider failure is one of these, so callers can tell "slow down" from "bad data" and always fail closed. */
export class MarketDataError extends Error {
  constructor(public readonly kind: MarketDataErrorKind, message: string) { super(message); }
}

export const WSOL_MINT = 'So11111111111111111111111111111111111111112';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

/** Price and liquidity facts for one token, taken from its deepest pool. Every number here was present in the source. */
export interface MarketSnapshot {
  mint: string;
  /** Untrusted. Sanitize before storing. */
  symbol: string;
  /** Untrusted. Sanitize before storing. */
  name: string;
  /** Optional provider-supplied token artwork, never a verification badge. */
  imageUrl?: string | null;
  priceUsd: number;
  marketCapUsd: number;
  /** True when the source gave no market cap and the fully diluted value was used instead. */
  marketCapIsFdv: boolean;
  liquidityUsd: number;
  volume24hUsd: number;
  priceChange1hPct: number | null;
  pairAddress: string;
  dexId: string | null;
  /** When the deepest pool was created. A proxy for token age, not the mint time. */
  pairCreatedAt: Date | null;
}

/** Token facts that need a deeper lookup. A null means the source did not say, never "zero" or "safe". */
export interface TokenInfo {
  mint: string;
  name: string | null;
  symbol: string | null;
  holders: number | null;
  /** Percent of supply (0 to 100) held by the ten largest accounts. May include pool and exchange accounts. */
  top10Pct: number | null;
  mintAuthorityActive: boolean | null;
  freezeAuthorityActive: boolean | null;
  isHoneypot: boolean | null;
  websites: string[];
  twitterHandle: string | null;
}

export interface NewPool {
  mint: string;
  /** Untrusted. */
  symbol: string;
  /** Untrusted. */
  name: string;
  poolAddress: string;
  createdAt: Date;
  liquidityUsd: number | null;
}

/** Current price, liquidity and volume. Mints missing from the result had no usable data. */
export interface MarketQuoteSource {
  readonly name: string;
  getSnapshots(mints: string[]): Promise<Map<string, MarketSnapshot>>;
  /**
   * Price-only read for reference assets such as wrapped SOL, whose deepest pool may legitimately carry no market
   * cap or FDV. Sources without this method use `getSnapshots` for the reference instead.
   */
  getReferencePrices?(mints: string[]): Promise<Map<string, number>>;
}

export interface TokenInfoSource {
  readonly name: string;
  /** null when the source does not know the token. Throws on any failure. */
  getTokenInfo(mint: string): Promise<TokenInfo | null>;
}

export interface LaunchSource {
  readonly name: string;
  getNewPools(): Promise<NewPool[]>;
}
