import type { Prisma, PrismaClient } from '@narra/database';
import { LATEST_EVIDENCE_MAX_AGE_MS, sanitizeUntrusted } from '@narra/shared';
import { MarketDataError, WSOL_MINT, tokenRisk, type MarketSnapshot, type TokenInfo } from '@narra/market-data';
import type { MarketDataDeps } from './marketData';
import { storeMarketSnapshot } from './marketSnapshot';
import { refreshHolderFallback } from './holderFallback';
import { HOLDER_RPC_LIMITS } from './holderRpc';

/** Separate progress key so on-demand Trade refreshes never collide with or pause radar/market holder fallback. */
export const TRADE_HOLDER_FALLBACK_KEY = 'research.holderFallback.trade.progress';

export const TRADE_EVIDENCE_LIMITS = {
  /** Matches trade-research.ts market freshness gate (15 minutes). */
  marketMaxAgeMs: 15 * 60_000,
  /** Matches trade-research.ts holder freshness gate (60 minutes). */
  holdersMaxAgeMs: 60 * 60_000,
  /** Matches trade-research.ts risk freshness gate (60 minutes). */
  riskMaxAgeMs: 60 * 60_000,
  /** Keep the token in the market priority lane for 30 minutes after a Trade open. */
  priorityWindowMs: 30 * 60_000,
  /** Bounded RPC deadline for a single-token holder enumeration. */
  holderFallbackDeadlineMs: 12_000,
} as const;

export interface TradeEvidenceRefreshSummary {
  mint: string;
  tokenId: string | null;
  status: 'refreshed' | 'already_fresh' | 'no_pool' | 'blacklisted' | 'invalid_mint';
  tokenCreated: boolean;
  marketWritten: boolean;
  holdersWritten: boolean;
  holderFallbackUsed: boolean;
  riskWritten: boolean;
  errors: string[];
}

const errText = (source: string, e: unknown) =>
  `${source}: ${e instanceof MarketDataError ? `${e.kind} (${e.message})` : (e as Error).message}`;
const clean = (s: string, max: number) => sanitizeUntrusted(s, max);
const isFresh = (at: Date | null | undefined, now: Date, maxAgeMs: number) =>
  !!at && +at <= +now && +now - +at <= maxAgeMs;

/**
 * Fast-lane, selective evidence refresh for a single token opened in Trade.
 *
 * Cost & safety invariants:
 * - Only fetches the pieces (market, holders, risk) that are missing or stale.
 * - No-pool short-circuit: if DexScreener returns no active pool and no fresh market
 *   metric exists, returns immediately with zero holder/risk RPC calls.
 * - Never fabricates missing numbers or weakens any trade-research freshness gate.
 * - Writes identical provenance keys (`research.market.*`, `research.holders.*`) as
 *   the scheduled pipeline so `tradeResearch()` trusts the observations immediately.
 */
export async function refreshTradeEvidence(
  db: PrismaClient,
  deps: Pick<MarketDataDeps, 'quotes' | 'info' | 'holderFallback'>,
  mint: string,
  now: Date = new Date(),
): Promise<TradeEvidenceRefreshSummary> {
  // Advance from `now` by real elapsed wall time so RPC block timestamps acquired seconds
  // into the job never appear to be "in the future" relative to job start, while keeping
  // deterministic unit tests (elapsed ~0ms) anchored to `now`.
  const startedAtMs = Date.now();
  const currentClock = () => new Date(+now + Math.max(0, Date.now() - startedAtMs));
  const out: TradeEvidenceRefreshSummary = {
    mint,
    tokenId: null,
    status: 'refreshed',
    tokenCreated: false,
    marketWritten: false,
    holdersWritten: false,
    holderFallbackUsed: false,
    riskWritten: false,
    errors: [],
  };

  if (mint === WSOL_MINT) {
    out.status = 'invalid_mint';
    return out;
  }

  const priorityUntil = new Date(+now + TRADE_EVIDENCE_LIMITS.priorityWindowMs);
  const existing = await db.token.findUnique({
    where: { mint },
    select: {
      id: true,
      mint: true,
      symbol: true,
      name: true,
      blacklisted: true,
      createdOnChainAt: true,
      marketQuoteFailures: true,
      marketQuarantineUntil: true,
      metrics: { orderBy: { at: 'desc' }, take: 1, select: { id: true, at: true, liquidityUsd: true } },
      holders: { orderBy: { at: 'desc' }, take: 1, select: { at: true, holders: true, top10Pct: true } },
      risk: { orderBy: { at: 'desc' }, take: 1, select: { at: true } },
    },
  });

  if (existing?.blacklisted) {
    out.tokenId = existing.id;
    out.status = 'blacklisted';
    return out;
  }

  let token: NonNullable<typeof existing>;
  if (!existing) {
    const created = await db.token.upsert({
      where: { mint },
      create: { mint, symbol: 'UNKNOWN', name: 'UNKNOWN', marketPriorityUntil: priorityUntil },
      update: { marketPriorityUntil: priorityUntil },
      select: {
        id: true,
        mint: true,
        symbol: true,
        name: true,
        blacklisted: true,
        createdOnChainAt: true,
        marketQuoteFailures: true,
        marketQuarantineUntil: true,
        metrics: { orderBy: { at: 'desc' }, take: 1, select: { id: true, at: true, liquidityUsd: true } },
        holders: { orderBy: { at: 'desc' }, take: 1, select: { at: true, holders: true, top10Pct: true } },
        risk: { orderBy: { at: 'desc' }, take: 1, select: { at: true } },
      },
    });
    if (created.blacklisted) {
      out.tokenId = created.id;
      out.status = 'blacklisted';
      return out;
    }
    token = created;
    out.tokenCreated = true;
  } else {
    token = existing;
    await db.token.update({ where: { id: token.id }, data: { marketPriorityUntil: priorityUntil } });
  }
  out.tokenId = token.id;

  // 1. Check current freshness of all 3 required buy-evidence checks.
  const latestMetric = token.metrics[0] ?? null;
  const latestHolder = token.holders[0] ?? null;
  const latestRisk = token.risk[0] ?? null;

  const marketSetting = latestMetric
    ? await db.systemSetting.findUnique({ where: { key: `research.market.${token.id}` }, select: { value: true } })
    : null;
  const marketSource = marketSetting?.value as { metricId?: unknown; stale?: unknown } | null | undefined;
  const marketProvenanceValid = !!latestMetric && marketSource?.metricId === latestMetric.id && !marketSource?.stale;

  const marketFresh = marketProvenanceValid && isFresh(latestMetric?.at, now, TRADE_EVIDENCE_LIMITS.marketMaxAgeMs);
  const holdersFresh = isFresh(latestHolder?.at, now, TRADE_EVIDENCE_LIMITS.holdersMaxAgeMs);
  const riskFresh = isFresh(latestRisk?.at, now, TRADE_EVIDENCE_LIMITS.riskMaxAgeMs);

  if (marketFresh && holdersFresh && riskFresh) {
    out.status = 'already_fresh';
    return out;
  }

  // 2. Market refresh (selective).
  let activeLiquidityUsd: number | null = marketFresh ? Number(latestMetric!.liquidityUsd) : null;
  let pairCreatedAt: Date | null = token.createdOnChainAt ?? null;

  if (!marketFresh) {
    let snap: MarketSnapshot | undefined;
    try {
      const snaps = await deps.quotes.getSnapshots([mint]);
      snap = snaps.get(mint);
    } catch (e) {
      out.errors.push(errText(deps.quotes.name, e));
    }

    if (snap) {
      await db.$transaction(tx => storeMarketSnapshot(tx, token.id, snap, deps.quotes.name, now), { timeout: 30_000, maxWait: 10_000 });
      out.marketWritten = true;
      activeLiquidityUsd = snap.liquidityUsd;
      pairCreatedAt = token.createdOnChainAt ?? snap.pairCreatedAt ?? null;

      const patch: Prisma.TokenUpdateInput = {};
      const symbol = clean(snap.symbol, 32);
      if (token.symbol === 'UNKNOWN' && symbol) {
        patch.symbol = symbol;
        patch.name = clean(snap.name, 64) || symbol;
      }
      if (!token.createdOnChainAt && snap.pairCreatedAt) patch.createdOnChainAt = snap.pairCreatedAt;
      if (token.marketQuoteFailures !== 0 || token.marketQuarantineUntil) {
        patch.marketQuoteFailures = 0;
        patch.marketQuarantineUntil = null;
      }
      if (Object.keys(patch).length) await db.token.update({ where: { id: token.id }, data: patch });
    } else {
      // No-pool short-circuit: never spend holder/risk RPC credits on unpooled or dead mints.
      out.status = 'no_pool';
      return out;
    }
  }

  // 3. Holders & risk refresh (selective — only when either is stale/missing).
  if (!holdersFresh || !riskFresh) {
    let info: TokenInfo | null = null;
    let infoFetched = false;
    if (deps.info) {
      try {
        info = await deps.info.getTokenInfo(mint);
        infoFetched = true;
      } catch (e) {
        out.errors.push(errText(deps.info.name, e));
      }
    }

    let holdersNowFresh = holdersFresh;
    let resolvedHolders: number | null = holdersFresh ? latestHolder!.holders : null;
    let resolvedTop10Pct: number | null = holdersFresh ? latestHolder!.top10Pct : null;

    if (!holdersNowFresh && info && info.holders != null && info.top10Pct != null) {
      const holderAt = info.holdersUpdatedAt === undefined ? now : info.holdersUpdatedAt;
      const infoHoldersFresh = holderAt != null && Number.isFinite(+holderAt) && +holderAt <= +now && +now - +holderAt <= LATEST_EVIDENCE_MAX_AGE_MS.holders;
      const key = `research.holders.${token.id}`;
      const value = {
        mint,
        source: deps.info!.name,
        sourceAt: holderAt && Number.isFinite(+holderAt) ? holderAt.toISOString() : null,
        retrievedAt: now.toISOString(),
        holders: info.holders,
        top10Pct: info.top10Pct,
        devHoldingPct: null,
      };
      const previous = (await db.systemSetting.findUnique({ where: { key }, select: { value: true } }))?.value as { sourceAt?: string | null } | null;
      if (!previous?.sourceAt || (value.sourceAt && Date.parse(value.sourceAt) >= Date.parse(previous.sourceAt))) {
        await db.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
      }
      if (holderAt && Number.isFinite(+holderAt) && +holderAt <= +now) {
        await db.tokenHolderMetric.create({ data: { tokenId: token.id, holders: info.holders, top10Pct: info.top10Pct, devHoldingPct: null, at: holderAt } });
        if (infoHoldersFresh) {
          out.holdersWritten = true;
          holdersNowFresh = true;
          resolvedHolders = info.holders;
          resolvedTop10Pct = info.top10Pct;
        }
      }
    }

    // Complete on-chain holder enumeration if token-info holders were missing or stale.
    // Run before writing TokenRiskMetric so risk reflects the fresh holder counts.
    if (!holdersNowFresh && deps.holderFallback) {
      const knownHolders = info?.holders ?? (latestHolder ? latestHolder.holders : null);
      // Fast-path: mints already known to exceed the 20K-account full-enumeration cap will always
      // hit TOO_LARGE after 15-25s of getProgramAccounts. Skip straight to getTokenLargestAccounts (~300ms).
      const skipFullEnum = (knownHolders ?? 0) > HOLDER_RPC_LIMITS.maxAccounts && !!deps.holderFallback.getLargestAccountsFallback;
      let fb: Awaited<ReturnType<typeof refreshHolderFallback>> | null = null;
      if (!skipFullEnum) {
        fb = await refreshHolderFallback(
          db,
          deps.holderFallback,
          [{ id: token.id, mint }],
          () => now,
          { perRun: 1, deadlineMs: TRADE_EVIDENCE_LIMITS.holderFallbackDeadlineMs, stateKey: TRADE_HOLDER_FALLBACK_KEY, retrievedAt: currentClock },
        );
        out.holderFallbackUsed = fb.holderFallbackAttempts > 0;
        if (fb.holderFallbackWritten > 0) {
          out.holdersWritten = true;
          holdersNowFresh = true;
          const freshHolder = await db.tokenHolderMetric.findFirst({
            where: { tokenId: token.id },
            orderBy: { at: 'desc' },
            select: { holders: true, top10Pct: true },
          });
          if (freshHolder) {
            resolvedHolders = freshHolder.holders;
            resolvedTop10Pct = freshHolder.top10Pct;
          }
        }
      }
      if (!holdersNowFresh && deps.holderFallback.getLargestAccountsFallback) {
        // Full getProgramAccounts enumeration cannot complete on large mints (>20K total/empty ATAs).
        // Fall back to finalized getTokenLargestAccounts for live on-chain top10Pct without fabricating holder counts.
        const tooLarge = skipFullEnum || (fb?.holderFallbackReasons.TOO_LARGE ?? 0) > 0;
        const canUseLargest = tooLarge || (((fb?.holderFallbackReasons.INVALID_OR_INCOMPLETE ?? 0) > 0 || (fb?.holderFallbackAttempts ?? 0) === 0) && (knownHolders ?? 0) >= 50);
        const observedHolders = tooLarge
          ? Math.max(HOLDER_RPC_LIMITS.maxAccounts, knownHolders ?? 0)
          : canUseLargest
            ? knownHolders!
            : null;
        if (observedHolders != null) {
          const largest = await deps.holderFallback
            .getLargestAccountsFallback(mint, observedHolders)
            .catch(() => ({ ok: false as const, reason: 'UNAVAILABLE' as const }));
          const checkedAt = currentClock();
          if (largest.ok && largest.mint === mint && +largest.sourceAt <= +checkedAt && +checkedAt - +largest.sourceAt <= LATEST_EVIDENCE_MAX_AGE_MS.holders) {
            await db.$transaction(async tx => {
              const metric = await tx.tokenHolderMetric.create({
                data: { tokenId: token.id, holders: largest.holders, top10Pct: largest.top10Pct, devHoldingPct: null, at: largest.sourceAt },
              });
              const value = {
                mint,
                metricId: metric.id,
                source: 'solana-rpc-largest',
                sourceAt: largest.sourceAt.toISOString(),
                retrievedAt: checkedAt.toISOString(),
                slot: largest.slot,
                program: largest.program,
                accounts: largest.accounts,
                holders: largest.holders,
                top10Pct: largest.top10Pct,
                devHoldingPct: null,
                basis: 'rpc-largest-accounts-fallback',
                complete: false,
              };
              await tx.systemSetting.create({ data: { key: `research.holderMetric.${metric.id}`, value } });
              await tx.systemSetting.upsert({ where: { key: `research.holders.${token.id}` }, create: { key: `research.holders.${token.id}`, value }, update: { value } });
            }, { timeout: 30_000, maxWait: 10_000 });
            out.holderFallbackUsed = true;
            out.holdersWritten = true;
            holdersNowFresh = true;
            resolvedHolders = largest.holders;
            resolvedTop10Pct = largest.top10Pct;
          }
        }
      }
    }

    if (!riskFresh && activeLiquidityUsd != null && infoFetched) {
      const riskAt = currentClock();
      const pairAgeMinutes = pairCreatedAt ? (+riskAt - +pairCreatedAt) / 60_000 : null;
      const risk = tokenRisk({
        liquidityUsd: activeLiquidityUsd,
        holders: holdersNowFresh ? resolvedHolders : null,
        top10Pct: holdersNowFresh ? resolvedTop10Pct : null,
        devHoldingPct: null,
        mintAuthorityActive: info?.mintAuthorityActive ?? null,
        freezeAuthorityActive: info?.freezeAuthorityActive ?? null,
        isHoneypot: info?.isHoneypot ?? null,
        pairAgeMinutes,
      });
      if (!info) risk.flags.push('INFO_UNAVAILABLE');
      if (info && !holdersNowFresh) risk.flags.push('HOLDER_OBSERVATION_STALE_OR_UNKNOWN');
      await db.tokenRiskMetric.create({ data: { tokenId: token.id, riskScore: risk.riskScore, flags: risk.flags, at: riskAt } });
      out.riskWritten = true;
    }
  }

  return out;
}
