import type { Prisma, PrismaClient } from '@narra/database';
import { sanitizeUntrusted } from '@narra/shared';
import { MarketDataError, WSOL_MINT, tokenRisk, type LaunchSource, type MarketQuoteSource, type MarketSnapshot, type TokenInfo, type TokenInfoSource } from '@narra/market-data';

/** Starting values. None is validated against outcomes, and each should become an admin-editable setting. */
export const MARKET_DATA_LIMITS = {
  /** A new pool below this liquidity is ignored, so junk launches never become rows. Opportunities still need 20K. */
  launchMinLiquidityUsd: 5_000,
  maxLaunchesPerRun: 20,
  /** Tokens refreshed per run. Beyond this, the rest wait for the next run (ordered by id, so the same tail can starve). */
  maxTokensPerRun: 150,
  /** Slow-source calls per run. The free GeckoTerminal limit is 30 a minute, so 20 calls take about 45 s. */
  maxInfoCallsPerRun: 20,
  /** How long a token-info lookup (holders, authorities, risk) is reused. */
  infoRefreshMs: 30 * 60_000,
  /** A token with a price row this recent stays in the refresh set. */
  activeWindowMs: 24 * 3_600_000,
  quoteBatch: 30,
} as const;

export const SOL_PRICE_KEY = 'market.solUsd';

export interface MarketDataDeps {
  quotes: MarketQuoteSource;
  /** Optional. Without it no holder or risk rows are written, so tokens stay unranked (fail closed). */
  info: TokenInfoSource | null;
  /** Optional. Without it new launches are only found through wallet activity. */
  launches: LaunchSource | null;
}

export interface MarketDataSummary {
  launchesSeen: number;
  tokensCreated: number;
  tokensConsidered: number;
  tokensWithPrice: number;
  /** Requested but the source had no complete, usable data. Nothing was written for these. */
  tokensWithoutData: number;
  metricsWritten: number;
  fdvUsedAsMarketCap: number;
  infoCalls: number;
  infoUnavailable: number;
  holderRowsWritten: number;
  riskRowsWritten: number;
  solUsd: number | null;
  errors: string[];
}

const errText = (source: string, e: unknown) => `${source}: ${e instanceof MarketDataError ? `${e.kind} (${e.message})` : (e as Error).message}`;
const clean = (s: string, max: number) => sanitizeUntrusted(s, max);

/**
 * Keeps token rows, price rows, holder rows and risk rows current from the market data sources.
 * Rules: a missing price, liquidity, volume or holder figure is never replaced by zero (the row is skipped), token
 * names and symbols are sanitized before storage, and this job only writes research data. It has no access to orders,
 * positions or execution. Source errors are collected in the summary and never stop the other steps.
 */
export async function refreshMarketData(
  db: PrismaClient, deps: MarketDataDeps, now: Date = new Date(),
  opts: { maxTokens?: number; maxInfoCalls?: number } = {},
): Promise<MarketDataSummary> {
  const L = MARKET_DATA_LIMITS;
  const out: MarketDataSummary = { launchesSeen: 0, tokensCreated: 0, tokensConsidered: 0, tokensWithPrice: 0, tokensWithoutData: 0, metricsWritten: 0, fdvUsedAsMarketCap: 0, infoCalls: 0, infoUnavailable: 0, holderRowsWritten: 0, riskRowsWritten: 0, solUsd: null, errors: [] };

  // 1. SOL/USD, kept in one settings row so every later consumer reads the same number.
  try {
    const sol = (await deps.quotes.getSnapshots([WSOL_MINT])).get(WSOL_MINT);
    if (sol) {
      const value = { priceUsd: sol.priceUsd, at: now.toISOString(), source: deps.quotes.name };
      await db.systemSetting.upsert({ where: { key: SOL_PRICE_KEY }, create: { key: SOL_PRICE_KEY, value }, update: { value } });
      out.solUsd = sol.priceUsd;
    } else out.errors.push('sol price: no usable data');
  } catch (e) { out.errors.push(errText('sol price', e)); }

  // 2. Launch detection. New pools with real liquidity become token rows, so a narrative can find a token the moment it exists.
  const launchMints: string[] = [];
  if (deps.launches) {
    try {
      const pools = await deps.launches.getNewPools();
      out.launchesSeen = pools.length;
      for (const p of pools.slice(0, L.maxLaunchesPerRun)) {
        if (p.liquidityUsd == null || p.liquidityUsd < L.launchMinLiquidityUsd) continue;
        try {
          const existing = await db.token.findUnique({ where: { mint: p.mint }, select: { id: true, symbol: true, createdOnChainAt: true, blacklisted: true } });
          if (existing?.blacklisted) continue;
          const symbol = clean(p.symbol, 32), name = clean(p.name, 64);
          if (!existing) {
            await db.token.create({ data: { mint: p.mint, symbol: symbol || 'UNKNOWN', name: name || 'Unknown', createdOnChainAt: p.createdAt } });
            out.tokensCreated++;
          } else {
            const patch: Prisma.TokenUpdateInput = {};
            if (existing.symbol === 'UNKNOWN' && symbol) { patch.symbol = symbol; patch.name = name || symbol; }
            if (!existing.createdOnChainAt) patch.createdOnChainAt = p.createdAt;
            if (Object.keys(patch).length) await db.token.update({ where: { id: existing.id }, data: patch });
          }
          launchMints.push(p.mint);
        } catch (e) { out.errors.push(errText(`launch ${p.mint.slice(0, 6)}`, e)); }
      }
    } catch (e) { out.errors.push(errText(deps.launches.name, e)); }
  }

  // 3. The refresh set: placeholders that need a name, fresh launches, recently priced tokens, narrative candidates and held tokens.
  const tokens = await db.token.findMany({
    where: {
      blacklisted: false, mint: { not: WSOL_MINT },
      OR: [
        { symbol: 'UNKNOWN' }, { mint: { in: launchMints } },
        { metrics: { some: { at: { gte: new Date(now.getTime() - L.activeWindowMs) } } } },
        { narratives: { some: {} } }, { positions: { some: {} } },
      ],
    },
    orderBy: { id: 'asc' }, take: opts.maxTokens ?? L.maxTokensPerRun,
    select: { id: true, mint: true, symbol: true, createdOnChainAt: true, risk: { orderBy: { at: 'desc' }, take: 1, select: { at: true } } },
  });
  out.tokensConsidered = tokens.length;

  // 4. Prices. One batch failing does not lose the others, and a 429 stops the step.
  const snaps = new Map<string, MarketSnapshot>();
  const mints = tokens.map((t) => t.mint);
  for (let i = 0; i < mints.length; i += L.quoteBatch) {
    try {
      for (const [k, v] of await deps.quotes.getSnapshots(mints.slice(i, i + L.quoteBatch))) snaps.set(k, v);
    } catch (e) {
      out.errors.push(errText(deps.quotes.name, e));
      if (e instanceof MarketDataError && e.kind === 'rate_limited') break;
    }
  }
  for (const t of tokens) {
    const s = snaps.get(t.mint);
    if (!s) { out.tokensWithoutData++; continue; }
    out.tokensWithPrice++;
    await db.tokenMetric.create({ data: { tokenId: t.id, priceUsd: s.priceUsd, marketCapUsd: s.marketCapUsd, liquidityUsd: s.liquidityUsd, volume24hUsd: s.volume24hUsd, at: now } });
    out.metricsWritten++;
    if (s.marketCapIsFdv) out.fdvUsedAsMarketCap++;
    const patch: Prisma.TokenUpdateInput = {};
    const symbol = clean(s.symbol, 32);
    if (t.symbol === 'UNKNOWN' && symbol) { patch.symbol = symbol; patch.name = clean(s.name, 64) || symbol; }
    // Pool creation is the earliest on-chain time the free sources give. It is a proxy for token age, not the mint time.
    if (!t.createdOnChainAt && s.pairCreatedAt) patch.createdOnChainAt = s.pairCreatedAt;
    if (Object.keys(patch).length) await db.token.update({ where: { id: t.id }, data: patch });
  }

  // 5. Holders and risk, from the slow source. Never-looked-up tokens go first, then the stalest. Developer holding is not available from free sources, so it is stored as unknown.
  if (deps.info) {
    const due = tokens
      .filter((t) => snaps.has(t.mint) && (!t.risk[0] || now.getTime() - t.risk[0].at.getTime() >= L.infoRefreshMs))
      .sort((a, b) => (a.risk[0]?.at.getTime() ?? 0) - (b.risk[0]?.at.getTime() ?? 0))
      .slice(0, opts.maxInfoCalls ?? L.maxInfoCallsPerRun);
    for (const t of due) {
      const s = snaps.get(t.mint)!;
      let info: TokenInfo | null;
      try {
        info = await deps.info.getTokenInfo(t.mint);
        out.infoCalls++;
      } catch (e) {
        out.errors.push(errText(deps.info.name, e));
        if (e instanceof MarketDataError && e.kind === 'rate_limited') break;
        continue;
      }
      const created = t.createdOnChainAt ?? s.pairCreatedAt;
      const pairAgeMinutes = created ? (now.getTime() - created.getTime()) / 60_000 : null;
      const risk = tokenRisk({
        liquidityUsd: s.liquidityUsd, holders: info?.holders ?? null, top10Pct: info?.top10Pct ?? null, devHoldingPct: null,
        mintAuthorityActive: info?.mintAuthorityActive ?? null, freezeAuthorityActive: info?.freezeAuthorityActive ?? null,
        isHoneypot: info?.isHoneypot ?? null, pairAgeMinutes,
      });
      if (!info) { out.infoUnavailable++; risk.flags.push('INFO_UNAVAILABLE'); }
      // A holder row needs both numbers. With either missing, nothing is written and the token stays unranked.
      if (info && info.holders != null && info.top10Pct != null) {
        await db.tokenHolderMetric.create({ data: { tokenId: t.id, holders: info.holders, top10Pct: info.top10Pct, devHoldingPct: null, at: now } });
        out.holderRowsWritten++;
      }
      await db.tokenRiskMetric.create({ data: { tokenId: t.id, riskScore: risk.riskScore, flags: risk.flags, at: now } });
      out.riskRowsWritten++;
    }
  }
  return out;
}

/** SOL/USD from the last refresh. Throws when it is missing or older than `maxAgeMs`, so callers fail closed. */
export async function readSolUsd(db: PrismaClient, now: Date = new Date(), maxAgeMs = 15 * 60_000): Promise<number> {
  const row = await db.systemSetting.findUnique({ where: { key: SOL_PRICE_KEY } });
  const v = row?.value as { priceUsd?: unknown; at?: unknown } | null | undefined;
  const price = typeof v?.priceUsd === 'number' && Number.isFinite(v.priceUsd) && v.priceUsd > 0 ? v.priceUsd : null;
  const at = typeof v?.at === 'string' ? new Date(v.at) : null;
  if (price == null || !at || Number.isNaN(at.getTime())) throw new Error('SOL/USD price is not available');
  if (now.getTime() - at.getTime() > maxAgeMs) throw new Error('SOL/USD price is stale');
  return price;
}
