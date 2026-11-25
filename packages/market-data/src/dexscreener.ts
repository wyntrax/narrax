import { z } from 'zod';
import { tokenImageUrl } from '@narra/shared';
import { getJson, toNumber, type HttpOptions } from './http';
import { RateLimiter } from './limiter';
import { MarketDataError, type MarketQuoteSource, type MarketSnapshot, type SnapshotRead, type SnapshotOmissionReason } from './types';

/** Documented limit is 300 requests a minute for these endpoints. 250 ms spacing stays well under it. */
export const DEXSCREENER_MIN_INTERVAL_MS = 250;
/** The tokens endpoint accepts up to 30 comma-separated addresses per call. */
export const DEXSCREENER_BATCH = 30;

const Pair = z.object({
  chainId: z.string(),
  dexId: z.string().nullish(),
  pairAddress: z.string(),
  baseToken: z.object({ address: z.string(), name: z.string().nullish(), symbol: z.string().nullish() }),
  priceUsd: z.union([z.string(), z.number()]).nullish(),
  liquidity: z.object({ usd: z.number().nullish() }).nullish(),
  volume: z.object({ h24: z.number().nullish() }).nullish(),
  priceChange: z.object({ h1: z.number().nullish() }).nullish(),
  marketCap: z.number().nullish(),
  fdv: z.number().nullish(),
  pairCreatedAt: z.number().nullish(),
  info: z.object({
    imageUrl: z.unknown().optional(),
    websites: z.array(z.object({ label: z.string().nullish(), url: z.string().nullish() })).nullish().catch(null),
    socials: z.array(z.object({ type: z.string().nullish(), url: z.string().nullish() })).nullish().catch(null),
  }).nullish().catch(null),
});
type Pair = z.infer<typeof Pair>;

export interface DexScreenerOptions extends HttpOptions { baseUrl?: string }

/**
 * Prices and liquidity from the public DEX Screener API (no key). Per token it keeps the pool with the most liquidity.
 * A token is dropped, not zero-filled, when its price, liquidity, 24h volume, or both market cap and FDV are missing.
 * Response shape is taken from the public reference; confirm it against one real response before relying on it.
 */
export class DexScreenerSource implements MarketQuoteSource {
  readonly name = 'dexscreener';
  private readonly baseUrl: string;
  private readonly limiter: RateLimiter;
  constructor(private readonly opts: DexScreenerOptions = {}) {
    this.baseUrl = (opts.baseUrl || 'https://api.dexscreener.com').replace(/\/$/, '');
    this.limiter = opts.limiter ?? new RateLimiter(DEXSCREENER_MIN_INTERVAL_MS);
  }

  private async pairs(chunk: string[]): Promise<{ pairs: Pair[]; invalidMints: Set<string> }> {
    const { body } = await getJson(`${this.baseUrl}/tokens/v1/solana/${chunk.join(',')}`, { ...this.opts, limiter: this.limiter });
    const raw = Array.isArray(body) ? body : body && typeof body === 'object' && 'pairs' in body && Array.isArray((body as { pairs: unknown }).pairs) ? (body as { pairs: unknown[] }).pairs : null;
    if (!raw) {
      // The API may answer { pairs: null } for tokens it has never seen. Anything else is a shape change.
      if (body && typeof body === 'object' && 'pairs' in body && body.pairs === null) return { pairs: [], invalidMints: new Set() };
      throw new MarketDataError('shape', 'dexscreener returned an unexpected body');
    }
    const invalidMints = new Set<string>();
    const pairs = raw.flatMap(item => {
      const p = Pair.safeParse(item);
      if (!p.success && item?.chainId === 'solana' && typeof item?.baseToken?.address === 'string' && chunk.includes(item.baseToken.address)) invalidMints.add(item.baseToken.address);
      return p.success && p.data.chainId === 'solana' ? [p.data] : [];
    });
    return { pairs, invalidMints };
  }

  async getSnapshots(mints: string[]): Promise<Map<string, MarketSnapshot>> {
    return (await this.getSnapshotsWithDiagnostics(mints)).snapshots;
  }

  async getSnapshotsWithDiagnostics(mints: string[]): Promise<SnapshotRead> {
    const out = new Map<string, MarketSnapshot>();
    const omissions = new Map<string, SnapshotOmissionReason>();
    const unique = [...new Set(mints)];
    for (let i = 0; i < unique.length; i += DEXSCREENER_BATCH) {
      const chunk = unique.slice(i, i + DEXSCREENER_BATCH);
      const best = new Map<string, Pair>();
      const response = await this.pairs(chunk);
      for (const p of response.pairs) {
        const mint = p.baseToken.address;
        if (!chunk.includes(mint)) continue; // pools where the token is only the quote side price the other asset
        const liq = p.liquidity?.usd ?? -1;
        const cur = best.get(mint);
        if (!cur || liq > (cur.liquidity?.usd ?? -1)) best.set(mint, p);
      }
      for (const mint of chunk) {
        const p = best.get(mint);
        if (!p) { omissions.set(mint, response.invalidMints.has(mint) ? 'INVALID_PAIR' : 'NO_MATCHING_PAIR'); continue; }
        const snap = toSnapshot(mint, p);
        if (snap) out.set(mint, snap);
        else omissions.set(mint, snapshotOmission(p) ?? 'UNSPECIFIED');
      }
    }
    return { snapshots: out, omissions };
  }

  async getReferencePrices(mints: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const unique = [...new Set(mints)];
    for (let i = 0; i < unique.length; i += DEXSCREENER_BATCH) {
      const chunk = unique.slice(i, i + DEXSCREENER_BATCH);
      const best = new Map<string, { price: number; liquidity: number }>();
      for (const p of (await this.pairs(chunk)).pairs) {
        const mint = p.baseToken.address;
        if (!chunk.includes(mint)) continue;
        const price = toNumber(p.priceUsd);
        if (price == null || price <= 0) continue;
        const liquidity = toNumber(p.liquidity?.usd);
        const volume = toNumber(p.volume?.h24);
        if (liquidity == null || liquidity < 0 || volume == null || volume < 0) continue;
        const cur = best.get(mint);
        // Reference assets have no market cap requirement, but still use the deepest pool for the price.
        if (!cur || liquidity > cur.liquidity) best.set(mint, { price, liquidity });
      }
      for (const [mint, value] of best) out.set(mint, value.price);
    }
    return out;
  }
}

/** First failing requirement of the selected deepest pool; do not substitute another pool or fill absent fields. */
function snapshotOmission(p: Pair): SnapshotOmissionReason | null {
  const price = toNumber(p.priceUsd);
  if (price == null || price <= 0) return 'PRICE_UNAVAILABLE';
  if (p.liquidity?.usd == null || p.liquidity.usd < 0) return 'LIQUIDITY_UNAVAILABLE';
  if (p.volume?.h24 == null || p.volume.h24 < 0) return 'VOLUME_UNAVAILABLE';
  if (p.marketCap == null && p.fdv == null) return 'MARKET_VALUE_UNAVAILABLE';
  return null;
}

function safeExternalUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 256) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    if (parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function extractLinks(info: Pair['info']): { websiteUrl: string | null; twitterUrl: string | null } {
  const websites = info?.websites ?? [];
  const socials = info?.socials ?? [];
  let websiteUrl: string | null = null;
  for (const w of websites) {
    const clean = safeExternalUrl(w?.url);
    if (clean) { websiteUrl = clean; break; }
  }
  let twitterUrl: string | null = null;
  for (const s of socials) {
    const clean = safeExternalUrl(s?.url);
    if (!clean) continue;
    const type = s?.type?.trim().toLowerCase() ?? '';
    const host = new URL(clean).hostname.toLowerCase();
    if (type === 'twitter' || type === 'x' || host === 'x.com' || host === 'www.x.com' || host === 'twitter.com' || host === 'www.twitter.com') {
      twitterUrl = clean;
      break;
    }
  }
  return { websiteUrl, twitterUrl };
}

function toSnapshot(mint: string, p: Pair): MarketSnapshot | null {
  const price = toNumber(p.priceUsd);
  const liquidity = p.liquidity?.usd ?? null;
  const volume = p.volume?.h24 ?? null;
  const cap = p.marketCap ?? null;
  const fdv = p.fdv ?? null;
  if (snapshotOmission(p) || price == null || liquidity == null || volume == null) return null;
  const { websiteUrl, twitterUrl } = extractLinks(p.info);
  return {
    mint,
    symbol: p.baseToken.symbol ?? '',
    name: p.baseToken.name ?? '',
    imageUrl: tokenImageUrl(p.info?.imageUrl),
    websiteUrl,
    twitterUrl,
    priceUsd: price,
    marketCapUsd: (cap ?? fdv)!,
    marketCapIsFdv: cap == null,
    liquidityUsd: liquidity,
    volume24hUsd: volume,
    priceChange1hPct: p.priceChange?.h1 ?? null,
    pairAddress: p.pairAddress,
    dexId: p.dexId ?? null,
    pairCreatedAt: p.pairCreatedAt != null && Number.isFinite(p.pairCreatedAt) ? new Date(p.pairCreatedAt) : null,
  };
}
