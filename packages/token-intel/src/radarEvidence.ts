import { EARLY_RULES } from './earlyRadar';

/** Operational starting values, not tuned on returns. Holder collection reuses data for
 * 30 minutes; 60 minutes allows one refresh/retry window without accepting hours-old inputs. */
export const RADAR_EVIDENCE_LIMITS = { marketMaxAgeMs: 15 * 60_000, holdersMaxAgeMs: 60 * 60_000 } as const;
export type RadarEvidenceIssue = 'MARKET_MISSING' | 'MARKET_INVALID' | 'MARKET_FUTURE' | 'MARKET_STALE' | 'MARKET_UNVERIFIED' | 'HOLDERS_MISSING' | 'HOLDERS_INVALID' | 'HOLDERS_FUTURE' | 'HOLDERS_STALE';
export type RadarEvidenceSkips = Partial<Record<RadarEvidenceIssue, number>>;
export function radarEvidenceIssue(
  market: { at: Date; priceUsd: number | null } | null | undefined,
  holders: { at: Date } | null | undefined,
  now: Date,
): RadarEvidenceIssue | null {
  if (!market) return 'MARKET_MISSING';
  if (!Number.isFinite(+now) || !Number.isFinite(+market.at) || market.priceUsd == null || !Number.isFinite(market.priceUsd) || market.priceUsd <= 0) return 'MARKET_INVALID';
  if (+market.at > +now) return 'MARKET_FUTURE';
  if (+now - +market.at > RADAR_EVIDENCE_LIMITS.marketMaxAgeMs) return 'MARKET_STALE';
  if (!holders) return 'HOLDERS_MISSING';
  if (!Number.isFinite(+holders.at)) return 'HOLDERS_INVALID';
  if (+holders.at > +now) return 'HOLDERS_FUTURE';
  if (+now - +holders.at > RADAR_EVIDENCE_LIMITS.holdersMaxAgeMs) return 'HOLDERS_STALE';
  return null;
}
/** First failing reason per token preflight, or per rejected publication attempt. */
export function recordRadarEvidenceSkip(skips: RadarEvidenceSkips, reason: RadarEvidenceIssue): void {
  skips[reason] = (skips[reason] ?? 0) + 1;
}
/**
 * True only for a token that would enter the early lane at all. A larger token, a
 * suspicious copy or a token with no usable market cap is not a withheld radar call,
 * so it must not inflate the evidence-skip report.
 */
export function isRadarEvidenceCandidate(marketCapUsd: number | null | undefined, relation: string): boolean {
  return marketCapUsd != null && Number.isFinite(marketCapUsd) && marketCapUsd < EARLY_RULES.maxMarketCapUsd && relation !== 'SUSPICIOUS';
}
