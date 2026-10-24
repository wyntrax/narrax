import { z } from 'zod';
import { isSolanaAddress } from '@narra/shared';
import { getJson, type HttpOptions } from './http';
import { RateLimiter } from './limiter';
import { MarketDataError } from './types';

/**
 * RugCheck is a public, heuristic Solana token report service. It is not an authority and its score is not a
 * probability of a rug. We use only the fields we can map to explicit facts and keep every unmapped field null.
 * The response shape is confirmed against live reports for Pump.fun AMM and Meteora tokens, but the provider may
 * change it; a shape change fails closed instead of guessing.
 */
export const RUGCHECK_MIN_INTERVAL_MS = 500;
export const RUGCHECK_MIN_LP_LOCKED_PCT = 80;
const MAX_TOP_HOLDERS = 40;
const MAX_MARKETS = 20;

const RawNumber = z.union([z.string(), z.number()]);
const Holder = z.object({
  address: z.string(),
  pct: z.number().finite().min(0).max(100),
  owner: z.string().nullish(),
  insider: z.boolean().nullish(),
});
const Market = z.object({
  pubkey: z.string(),
  marketType: z.string().nullish(),
  mintLP: z.string().nullish(),
  liquidityAAccount: z.object({ owner: z.string().nullish() }).nullish(),
  liquidityBAccount: z.object({ owner: z.string().nullish() }).nullish(),
  lp: z.object({
    lpMint: z.string().nullish(),
    lpLockedPct: z.number().nullish(),
    quoteUSD: z.number().finite().nonnegative().nullish(),
    baseUSD: z.number().finite().nonnegative().nullish(),
    lpTotalSupply: RawNumber.nullish(),
  }).nullish(),
});
const Risk = z.object({ name: z.string(), level: z.string().nullish(), value: z.string().nullish() });
const Report = z.object({
  mint: z.string(),
  creator: z.string().nullish(),
  creatorBalance: RawNumber.nullish(),
  token: z.object({ supply: RawNumber.nullish() }).nullish(),
  topHolders: z.array(Holder).nullish(),
  knownAccounts: z.record(z.object({ name: z.string().nullish(), type: z.string().nullish() })).nullish(),
  markets: z.array(Market).nullish(),
  totalHolders: z.number().int().nonnegative().nullish(),
  rugged: z.boolean().nullish(),
  risks: z.array(Risk).nullish(),
  detectedAt: z.string().nullish(),
});

export interface RugCheckReport {
  mint: string;
  /** First-seen time reported by RugCheck. It is not the observation time of this fetch. */
  detectedAt: Date | null;
  creator: string | null;
  devHoldingPct: number | null;
  /** Sum of the ten largest holders after removing known AMM/locker accounts. Null when the report is incomplete. */
  top10ExLpPct: number | null;
  /** Locked/burned share of the largest fungible LP position, 0-100. */
  lpLockedPct: number | null;
  lpLocked: boolean | null;
  rugged: boolean | null;
  riskFlags: string[];
  totalHolders: number | null;
}

export interface RugCheckOptions extends HttpOptions { baseUrl?: string }

const rawBigInt = (value: unknown): bigint | null => {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    try { return BigInt(value.trim()); } catch { return null; }
  }
  return null;
};

const pctOf = (part: bigint | null, whole: bigint | null): number | null => {
  if (part == null || whole == null || whole <= 0n || part < 0n || part > whole) return null;
  return Number(part * 1_000_000n / whole) / 10_000;
};

/** Deterministic mapping from a report body. Exported so the mapping can be tested without HTTP. */
export function parseRugCheckReport(body: unknown): RugCheckReport {
  const parsed = Report.safeParse(body);
  if (!parsed.success) throw new MarketDataError('shape', 'rugcheck returned an unexpected body');
  const r = parsed.data;
  const known = r.knownAccounts ?? {};
  const excludedOwners = new Set<string>();
  for (const [address, account] of Object.entries(known)) {
    if (account.type === 'AMM' || account.type === 'LOCKER') excludedOwners.add(address);
  }
  for (const market of (r.markets ?? []).slice(0, MAX_MARKETS)) {
    excludedOwners.add(market.pubkey);
    if (market.liquidityAAccount?.owner) excludedOwners.add(market.liquidityAAccount.owner);
    if (market.liquidityBAccount?.owner) excludedOwners.add(market.liquidityBAccount.owner);
  }

  const holders = (r.topHolders ?? [])
    .filter((h) => Number.isFinite(h.pct) && h.pct > 0)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, MAX_TOP_HOLDERS);
  if (new Set(holders.map(h => h.address)).size !== holders.length || holders.reduce((sum, h) => sum + h.pct, 0) > 100.01) {
    throw new MarketDataError('shape', 'rugcheck returned inconsistent holders');
  }
  const real = holders.filter((h) => !h.owner || !excludedOwners.has(h.owner));
  // If fewer than ten real holders are visible and the report cannot prove that is the whole set, the sum is incomplete.
  const top10ExLpPct = real.length === 0 || (real.length < 10 && (r.totalHolders == null || r.totalHolders > real.length))
    ? null
    : real.slice(0, 10).reduce((sum, h) => sum + h.pct, 0);

  let lpLockedPct: number | null = null;
  // Identify the largest market BEFORE checking lock data. A tiny locked pool must not stand in for a larger
  // unsupported/unreported pool. Missing liquidity prevents us from establishing which market is largest.
  const markets = r.markets ?? [];
  const completeMarkets = markets.length > 0 && markets.length <= MAX_MARKETS && markets.every(m => m.lp?.quoteUSD != null && m.lp.baseUSD != null);
  const largest = completeMarkets ? [...markets].sort((a, b) => (b.lp!.quoteUSD! + b.lp!.baseUSD!) - (a.lp!.quoteUSD! + a.lp!.baseUSD!))[0] : null;
  const lp = largest?.lp;
  if (lp?.lpMint && lp.lpMint !== '11111111111111111111111111111111') {
    const totalSupply = rawBigInt(lp.lpTotalSupply);
    const liquidity = (lp.quoteUSD ?? 0) + (lp.baseUSD ?? 0);
    if (totalSupply != null && totalSupply > 0n && liquidity > 0 && lp.lpLockedPct != null && Number.isFinite(lp.lpLockedPct) && lp.lpLockedPct >= 0 && lp.lpLockedPct <= 100) {
      lpLockedPct = lp.lpLockedPct;
    }
  }

  const supply = rawBigInt(r.token?.supply);
  const creatorBalance = rawBigInt(r.creatorBalance);
  const devHoldingPct = r.creator && supply != null ? pctOf(creatorBalance, supply) : null;
  const riskNames = (r.risks ?? []).map((x) => x.name.trim().toLowerCase());
  const riskFlags = [
    ...(r.rugged === true ? ['RUGGED'] : []),
    ...(riskNames.some((x) => x === 'honeypot') ? ['HONEYPOT'] : []),
    ...(riskNames.some((x) => x === 'mint authority' || x === 'mint authority enabled') ? ['MINT_AUTHORITY_ACTIVE'] : []),
    ...(riskNames.some((x) => x === 'freeze authority' || x === 'freeze authority enabled') ? ['FREEZE_AUTHORITY_ACTIVE'] : []),
  ];
  const detected = r.detectedAt ? new Date(r.detectedAt) : null;
  return {
    mint: r.mint,
    detectedAt: detected && Number.isFinite(+detected) ? detected : null,
    creator: r.creator ?? null,
    devHoldingPct,
    top10ExLpPct,
    lpLockedPct,
    lpLocked: lpLockedPct == null ? null : lpLockedPct >= RUGCHECK_MIN_LP_LOCKED_PCT,
    rugged: r.rugged ?? null,
    riskFlags,
    totalHolders: r.totalHolders != null && Number.isInteger(r.totalHolders) && r.totalHolders >= 0 ? r.totalHolders : null,
  };
}

export class RugCheckSource {
  readonly name = 'rugcheck';
  private readonly baseUrl: string;
  private readonly limiter: RateLimiter;
  constructor(private readonly opts: RugCheckOptions = {}) {
    this.baseUrl = (opts.baseUrl || 'https://api.rugcheck.xyz').replace(/\/$/, '');
    this.limiter = opts.limiter ?? new RateLimiter(RUGCHECK_MIN_INTERVAL_MS);
  }

  async getReport(mint: string): Promise<RugCheckReport | null> {
    if (!isSolanaAddress(mint)) return null;
    const { status, body } = await getJson(`${this.baseUrl}/v1/tokens/${encodeURIComponent(mint)}/report`, {
      ...this.opts, limiter: this.limiter, timeoutMs: this.opts.timeoutMs ?? 6000,
    });
    if (status === 404) return null;
    const report = parseRugCheckReport(body);
    if (report.mint !== mint) throw new MarketDataError('shape', 'rugcheck returned a different mint');
    return report;
  }
}
