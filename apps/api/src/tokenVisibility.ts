import type { Prisma } from '@narra/database';

/**
 * A token is hidden from discovery and narrative lists when its market has been
 * unusable for three days. The failure counter is only incremented after a completed
 * quote read that found no matching pair or no usable liquidity, so a provider outage
 * does not hide tokens. A successful quote resets the counter and restores the token.
 */
export const TOKEN_VISIBILITY = {
  noMarketAfterMs: 3 * 86_400_000,
  /** Mirrors MARKET_DATA_LIMITS.quoteFailureLimit in the pipeline worker. */
  deadQuoteFailures: 2,
} as const;

export type TokenMarketStatus = 'ACTIVE' | 'NO_MARKET';

export function tokenVisibilityCutoff(now: Date): Date {
  return new Date(+now - TOKEN_VISIBILITY.noMarketAfterMs);
}

/** Prisma filter for tokens that may appear in discovery, search and narrative lists. */
export function visibleTokenWhere(now: Date): Prisma.TokenWhereInput {
  const cutoff = tokenVisibilityCutoff(now);
  return {
    blacklisted: false,
    OR: [
      // Not enough completed dead-pool reads to call the market gone.
      { marketQuoteFailures: { lt: TOKEN_VISIBILITY.deadQuoteFailures } },
      // A successful quote inside the grace window keeps it visible.
      { metrics: { some: { at: { gte: cutoff, lte: now } } } },
      // A newly seen token gets the full grace window before it can be hidden.
      { firstSeenAt: { gte: cutoff } },
    ],
  };
}

/** The same rule for the direct token page and its tombstone. */
export function tokenMarketStatus(
  token: { marketQuoteFailures: number; firstSeenAt: Date },
  latestMetricAt: Date | null,
  now: Date,
): TokenMarketStatus {
  const cutoff = tokenVisibilityCutoff(now);
  const confirmedDead = token.marketQuoteFailures >= TOKEN_VISIBILITY.deadQuoteFailures;
  const recentlyPriced = !!latestMetricAt && latestMetricAt <= now && latestMetricAt >= cutoff;
  const withinGrace = token.firstSeenAt >= cutoff;
  return confirmedDead && !recentlyPriced && !withinGrace ? 'NO_MARKET' : 'ACTIVE';
}
