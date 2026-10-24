import type { EarlyProfile } from './earlyRadar';
import {TradeabilityQuoteSchema,TRADEABILITY_MAX_AGE_MS,type TradeabilityQuote} from '@narra/shared';

/**
 * Safety gate for the early-radar research lane.
 *
 * This is deliberately separate from the attention score. The score ranks narrative interest; this gate asks a
 * different question: do we have enough evidence that the token's supply, liquidity control and social origin are
 * not obviously unsafe? A high attention score never overrides a blocker or a missing critical fact.
 *
 * Every threshold here is a starting value. They are based on rug mechanics and the small October 2026 cohort, not
 * on a validated predictive model. Unknown critical evidence is `UNKNOWN`, never `PASS`. Only a complete `PASS` may
 * be published when enforcement is enabled.
 *
 * Optional RugCheck enrichment supplies some reported holder/LP facts. Bundle/sniper/insider supply, unique buyers,
 * and deployer history may remain unavailable. Jupiter buy quotes supply bounded price-impact evidence. Missing facts stay `UNKNOWN`: the radar must not call a
 * token safe because a field is absent, and retrieval freshness is not proof of upstream observation freshness.
 */

export type RadarSafetyMode = 'off' | 'shadow' | 'enforce';
export type RadarSafetyStatus = 'PASS' | 'BLOCK' | 'UNKNOWN';
export type RadarSafetyCheckStatus = 'PASS' | 'BLOCK' | 'UNKNOWN' | 'WARN';
export type RadarSafetyRoute = 'NARRATIVE' | 'SOCIAL';
export type RadarSafetyCheckSeverity = 'CRITICAL' | 'WARN';

export const RADAR_SAFETY_POLICY = {
  version: 'radar-safety-v2',
  /** Reported top-10 share. A source may or may not include the pool; see top10ExLpPct for the real check. */
  maxTop10Pct: 35,
  /** Top-10 excluding the pool, burn and known infrastructure. This is the one that matters for supply overhang. */
  maxTop10ExLpPct: 35,
  maxDevHoldingPct: { trencher: 10, holder: 5 } as const,
  maxBundleSniperInsiderPct: 20,
  minLpBurnedPct: 80,
  washTurnover: 30,
  minWashUniqueBuyers24h: 50,
  maxOrganicManipulationRisk: 60,
  maxMarketAgeMs: 15 * 60_000,
  maxHoldersAgeMs: 60 * 60_000,
  maxRiskAgeMs: 60 * 60_000,
  priceExtension1hPct: 50,
  priceExtension3hPct: 100,
  maxPriceImpactPct: 3,
} as const;

export interface RadarSafetyFacts {
  tokenId: string;
  mint: string;
  profile: EarlyProfile;
  route: RadarSafetyRoute;
  matchKind: string;
  tier: string;
  score: number;
  metricId: string;
  holderMetricId: string;
  riskMetricId?: string | null;
  priceUsd: number | null;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  holders: number | null;
  top10Pct: number | null;
  devHoldingPct: number | null;
  riskFlags: readonly string[];
  marketAt: Date | null;
  holdersAt: Date | null;
  riskAt: Date | null;
  priceGrowth1hPct: number | null;
  priceGrowth3hPct: number | null;
  narrativeManipulationRisk: number | null;
  /** The following facts are optional because current sources do not provide them. Null means unknown, never safe. */
  top10ExLpPct?: number | null;
  lpBurnedPct?: number | null;
  lpLocked?: boolean | null;
  bundlePct?: number | null;
  sniperPct?: number | null;
  insiderPct?: number | null;
  uniqueBuyers24h?: number | null;
  uniqueSellers24h?: number | null;
  priceImpactPct?: number | null;
  deployerPriorRugs?: number | null;
  /** Quote source timestamp, kept separate from the primary evidence provenance. */
  tradeabilityAt?: Date | null;
  tradeability?: TradeabilityQuote | null;
  /** Provenance for optional evidence. These are recorded, never used as a positive signal. */
  evidenceSource?: string | null;
  evidenceAt?: Date | null;
}

export interface RadarSafetyCheck {
  code: string;
  severity: RadarSafetyCheckSeverity;
  status: RadarSafetyCheckStatus;
  value: string | number | boolean | null;
  threshold: string | number | null;
  detail?: string;
}

export interface RadarSafetySnapshot {
  policyVersion: string;
  mode: Exclude<RadarSafetyMode, 'off'>;
  status: RadarSafetyStatus;
  /** True when enforcement would suppress this call. In shadow mode this is advisory only. */
  wouldBlock: boolean;
  blockers: string[];
  unknowns: string[];
  warnings: string[];
  checks: RadarSafetyCheck[];
  facts: {
    tokenId: string;
    mint: string;
    profile: EarlyProfile;
    route: RadarSafetyRoute;
    matchKind: string;
    tier: string;
    score: number;
    metricId: string;
    holderMetricId: string;
    riskMetricId: string | null;
    marketAt: string | null;
    holdersAt: string | null;
    riskAt: string | null;
    priceUsd: number | null;
    marketCapUsd: number | null;
    liquidityUsd: number | null;
    volume24hUsd: number | null;
    holders: number | null;
    top10Pct: number | null;
    top10ExLpPct: number | null;
    devHoldingPct: number | null;
    riskFlags: string[];
    priceGrowth1hPct: number | null;
    priceGrowth3hPct: number | null;
    narrativeManipulationRisk: number | null;
    lpBurnedPct: number | null;
    lpLocked: boolean | null;
    bundlePct: number | null;
    sniperPct: number | null;
    insiderPct: number | null;
    uniqueBuyers24h: number | null;
    uniqueSellers24h: number | null;
    priceImpactPct: number | null;
    deployerPriorRugs: number | null;
    evidenceSource: string | null;
    evidenceAt: string | null;
    /** Absent on snapshots frozen before tradeability quotes existed. */
    tradeabilityAt?: string | null;
    tradeability?: TradeabilityQuote | null;
  };
  evaluatedAt: string;
}

export const RADAR_SAFETY_SETTING_PREFIX = 'research.radarSafety.';
export const RADAR_SAFETY_SOURCE_MAX_AGE_MS = 10 * 60_000;
export const RADAR_SAFETY_BLOCKED_SETTING_PREFIX = 'research.radarSafetyBlocked.';
export const radarSafetySettingKey = (alertId: string): string => `${RADAR_SAFETY_SETTING_PREFIX}${alertId}`;
export const radarSafetyBlockedSettingKey = (tokenId: string, profile: EarlyProfile): string => `${RADAR_SAFETY_BLOCKED_SETTING_PREFIX}${tokenId}.${profile}`;

/** Invalid or missing configuration is shadow. A typo must not silently enforce or disable the gate. */
export function radarSafetyModeFromEnv(env: NodeJS.ProcessEnv = process.env): RadarSafetyMode {
  const raw = env.RADAR_SAFETY_MODE?.trim().toLowerCase();
  return raw === 'off' || raw === 'enforce' ? raw : 'shadow';
}

const finite = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);
const iso = (at: Date | null | undefined): string | null => (at && Number.isFinite(+at) ? new Date(at).toISOString() : null);

const check = (
  code: string,
  severity: RadarSafetyCheckSeverity,
  status: RadarSafetyCheckStatus,
  value: string | number | boolean | null,
  threshold: string | number | null,
  detail?: string,
): RadarSafetyCheck => ({ code, severity, status, value, threshold, ...(detail ? { detail } : {}) });

const evidence = (at: Date | null, now: Date, maxAgeMs: number): { status: 'PASS' | 'UNKNOWN'; detail?: string } => {
  if (!at || !Number.isFinite(+at)) return { status: 'UNKNOWN', detail: 'timestamp missing' };
  if (+at > +now) return { status: 'UNKNOWN', detail: 'timestamp is in the future' };
  const age = +now - +at;
  if (age > maxAgeMs) return { status: 'UNKNOWN', detail: `timestamp is ${Math.round(age / 60_000)}m old; maximum ${Math.round(maxAgeMs / 60_000)}m` };
  return { status: 'PASS' };
};

/**
 * Deterministic assessment. Blockers take precedence over unknowns, and unknowns take precedence over warnings.
 * A warning never blocks, but it is retained in the snapshot so a later enforcement decision can review it.
 */
export function evaluateRadarSafety(i: RadarSafetyFacts, now: Date = new Date()): RadarSafetySnapshot {
  const checks: RadarSafetyCheck[] = [];
  const policy = RADAR_SAFETY_POLICY;
  if (i.evidenceSource) {
    const sourceEvidence = evidence(i.evidenceAt ?? null, now, RADAR_SAFETY_SOURCE_MAX_AGE_MS);
    checks.push(check('SOURCE_EVIDENCE', 'CRITICAL', sourceEvidence.status, iso(i.evidenceAt), '<= 10m since retrieval', sourceEvidence.detail));
  }

  const marketEvidence = evidence(i.marketAt, now, policy.maxMarketAgeMs);
  checks.push(check(
    'MARKET_EVIDENCE',
    'CRITICAL',
    finite(i.priceUsd) && i.priceUsd > 0 ? marketEvidence.status : 'UNKNOWN',
    i.priceUsd,
    `> 0 and <= ${policy.maxMarketAgeMs / 60_000}m old`,
    finite(i.priceUsd) && i.priceUsd > 0 ? marketEvidence.detail : 'price missing or not positive',
  ));

  const holderEvidence = evidence(i.holdersAt, now, policy.maxHoldersAgeMs);
  checks.push(check(
    'HOLDER_EVIDENCE',
    'CRITICAL',
    finite(i.holders) && finite(i.top10Pct) ? holderEvidence.status : 'UNKNOWN',
    i.holders,
    `holders and top10 present, <= ${policy.maxHoldersAgeMs / 60_000}m old`,
    finite(i.holders) && finite(i.top10Pct) ? holderEvidence.detail : 'holder count or top-10 share missing',
  ));

  const activeAuthority = i.riskFlags.find((f) => f === 'HONEYPOT' || f === 'RUGGED' || f === 'MINT_AUTHORITY_ACTIVE' || f === 'FREEZE_AUTHORITY_ACTIVE');
  const riskEvidence = evidence(i.riskAt, now, policy.maxRiskAgeMs);
  if (activeAuthority) {
    checks.push(check(activeAuthority, 'CRITICAL', 'BLOCK', true, 'must be false', 'the stored risk row reports an active control or honeypot'));
  } else {
    checks.push(check(
      'RISK_EVIDENCE',
      'CRITICAL',
      riskEvidence.status,
      i.riskAt ? iso(i.riskAt) : null,
      `<= ${policy.maxRiskAgeMs / 60_000}m old`,
      riskEvidence.detail ?? 'fresh risk row exists; its absence of an active-authority flag is not proof the authority was revoked',
    ));
    if (riskEvidence.status === 'PASS') {
      checks.push(check('AUTHORITY_NOT_PROVEN', 'WARN', 'WARN', null, 'raw authority booleans', 'the risk row exposes active flags only; absence is not proof of revocation'));
    }
  }

  if (!finite(i.top10Pct)) {
    checks.push(check('TOP10_CONCENTRATION', 'CRITICAL', 'UNKNOWN', null, `<= ${policy.maxTop10Pct}%`, 'top-10 share missing'));
  } else if (i.top10Pct >= policy.maxTop10Pct) {
    checks.push(check('TOP10_CONCENTRATION', 'CRITICAL', 'BLOCK', i.top10Pct, `< ${policy.maxTop10Pct}%`, 'reported top-10 concentration is too high'));
  } else {
    checks.push(check('TOP10_CONCENTRATION', 'CRITICAL', 'PASS', i.top10Pct, `< ${policy.maxTop10Pct}%`, 'reported top-10 share; LP treatment is a separate check'));
  }

  if (!finite(i.top10ExLpPct)) {
    checks.push(check('TOP10_EX_LP', 'CRITICAL', 'UNKNOWN', null, `< ${policy.maxTop10ExLpPct}%`, 'top-10 excluding pool/burn is not available'));
  } else if (i.top10ExLpPct >= policy.maxTop10ExLpPct) {
    checks.push(check('TOP10_EX_LP', 'CRITICAL', 'BLOCK', i.top10ExLpPct, `< ${policy.maxTop10ExLpPct}%`, 'top-10 excluding pool/burn is too concentrated'));
  } else {
    checks.push(check('TOP10_EX_LP', 'CRITICAL', 'PASS', i.top10ExLpPct, `< ${policy.maxTop10ExLpPct}%`));
  }

  const maxDev = policy.maxDevHoldingPct[i.profile];
  if (!finite(i.devHoldingPct)) {
    checks.push(check('DEV_HOLDING', 'CRITICAL', 'UNKNOWN', null, `<= ${maxDev}%`, 'developer holding is not available'));
  } else if (i.devHoldingPct > maxDev) {
    checks.push(check('DEV_HOLDING', 'CRITICAL', 'BLOCK', i.devHoldingPct, `<= ${maxDev}%`, 'developer holding is too high'));
  } else {
    checks.push(check('DEV_HOLDING', 'CRITICAL', 'PASS', i.devHoldingPct, `<= ${maxDev}%`));
  }

  if (i.lpBurnedPct == null && i.lpLocked == null) {
    checks.push(check('LP_CONTROL', 'CRITICAL', 'UNKNOWN', null, `burned >= ${policy.minLpBurnedPct}% or locked`, 'LP burn/lock evidence is not available'));
  } else if (i.lpLocked === false) {
    checks.push(check('LP_CONTROL', 'CRITICAL', 'BLOCK', false, `burned >= ${policy.minLpBurnedPct}% or locked`, 'LP is reported unlocked'));
  } else if (finite(i.lpBurnedPct) && i.lpBurnedPct < policy.minLpBurnedPct) {
    checks.push(check('LP_CONTROL', 'CRITICAL', 'BLOCK', i.lpBurnedPct, `burned >= ${policy.minLpBurnedPct}% or locked`, 'LP burn is below the minimum'));
  } else {
    checks.push(check('LP_CONTROL', 'CRITICAL', 'PASS', i.lpBurnedPct ?? (i.lpLocked ? 'locked' : null), `burned >= ${policy.minLpBurnedPct}% or locked`));
  }

  if (!finite(i.bundlePct) || !finite(i.sniperPct) || !finite(i.insiderPct)) {
    checks.push(check('BUNDLE_SNIPER_INSIDER', 'CRITICAL', 'UNKNOWN', null, `<= ${policy.maxBundleSniperInsiderPct}% combined`, 'bundle, sniper or insider supply evidence is not available'));
  } else {
    const combined = i.bundlePct + i.sniperPct + i.insiderPct;
    checks.push(check(
      'BUNDLE_SNIPER_INSIDER',
      'CRITICAL',
      combined > policy.maxBundleSniperInsiderPct ? 'BLOCK' : 'PASS',
      combined,
      `<= ${policy.maxBundleSniperInsiderPct}% combined`,
    ));
  }

  if (!finite(i.narrativeManipulationRisk)) {
    checks.push(check('ORGANIC_EVIDENCE', 'CRITICAL', 'UNKNOWN', null, `< ${policy.maxOrganicManipulationRisk}`, 'organic/manipulation evidence is not available'));
  } else if (i.narrativeManipulationRisk >= policy.maxOrganicManipulationRisk) {
    checks.push(check('ORGANIC_EVIDENCE', 'CRITICAL', 'BLOCK', i.narrativeManipulationRisk, `< ${policy.maxOrganicManipulationRisk}`, 'narrative/chatter looks manipulated'));
  } else {
    checks.push(check('ORGANIC_EVIDENCE', 'CRITICAL', 'PASS', i.narrativeManipulationRisk, `< ${policy.maxOrganicManipulationRisk}`));
  }

  const turnover = finite(i.volume24hUsd) && finite(i.marketCapUsd) && i.marketCapUsd > 0 ? i.volume24hUsd / i.marketCapUsd : null;
  if (turnover == null) {
    checks.push(check('WASH_VOLUME', 'CRITICAL', 'UNKNOWN', null, `<= ${policy.washTurnover}x cap`, 'volume or market cap missing'));
  } else if (turnover <= policy.washTurnover) {
    checks.push(check('WASH_VOLUME', 'CRITICAL', 'PASS', turnover, `<= ${policy.washTurnover}x cap`));
  } else if (!finite(i.uniqueBuyers24h)) {
    checks.push(check('WASH_VOLUME', 'CRITICAL', 'UNKNOWN', turnover, `<= ${policy.washTurnover}x cap`, 'high turnover without unique-buyer evidence cannot be distinguished from wash trading'));
  } else if (i.uniqueBuyers24h < policy.minWashUniqueBuyers24h) {
    checks.push(check('WASH_VOLUME', 'CRITICAL', 'BLOCK', `${turnover.toFixed(1)}x / ${i.uniqueBuyers24h} buyers`, `<= ${policy.washTurnover}x cap and >= ${policy.minWashUniqueBuyers24h} unique buyers`, 'high turnover is concentrated in too few buyers'));
  } else {
    checks.push(check('WASH_VOLUME', 'CRITICAL', 'PASS', turnover, `<= ${policy.washTurnover}x cap`, `${i.uniqueBuyers24h} unique buyers support the turnover`));
    checks.push(check('WASH_TURNOVER_HIGH', 'WARN', 'WARN', turnover, `<= ${policy.washTurnover}x cap`, 'turnover is high even with unique-buyer support'));
  }

  const quote=TradeabilityQuoteSchema.safeParse(i.tradeability);
  const quoteAge=evidence(i.tradeabilityAt??null,now,TRADEABILITY_MAX_AGE_MS);
  const quoteMatches=quote.success&&quote.data.mint===i.mint&&quote.data.priceImpactPct===i.priceImpactPct&&Date.parse(quote.data.sourceAt)===Number(i.tradeabilityAt);
  if (!quoteMatches||quoteAge.status!=='PASS') {
    checks.push(check('TRADEABILITY', 'CRITICAL', 'UNKNOWN', null, `<= ${policy.maxPriceImpactPct}%`, !quoteMatches?'validated 50 USDC buy quote provenance missing or mismatched':quoteAge.detail));
  } else if (!finite(i.priceImpactPct)) {
    checks.push(check('TRADEABILITY', 'CRITICAL', 'UNKNOWN', null, `<= ${policy.maxPriceImpactPct}%`, 'price impact for a small ticket is not available'));
  } else if (i.priceImpactPct > policy.maxPriceImpactPct) {
    checks.push(check('TRADEABILITY', 'CRITICAL', 'BLOCK', i.priceImpactPct, `<= ${policy.maxPriceImpactPct}%`, 'a small ticket would move the price too much'));
  } else {
    checks.push(check('TRADEABILITY', 'CRITICAL', 'PASS', i.priceImpactPct, `<= ${policy.maxPriceImpactPct}%`));
  }

  if (i.deployerPriorRugs == null) {
    checks.push(check('DEPLOYER_HISTORY', 'CRITICAL', 'WARN', null, '0 prior rugs', 'deployer history is not available'));
  } else if (i.deployerPriorRugs > 0) {
    checks.push(check('DEPLOYER_HISTORY', 'CRITICAL', 'BLOCK', i.deployerPriorRugs, '0 prior rugs', 'deployer has a prior rug'));
  } else {
    checks.push(check('DEPLOYER_HISTORY', 'CRITICAL', 'PASS', 0, '0 prior rugs'));
  }

  if (finite(i.priceGrowth1hPct) && i.priceGrowth1hPct >= policy.priceExtension1hPct) {
    checks.push(check('PRICE_ALREADY_EXTENDED', 'WARN', 'WARN', i.priceGrowth1hPct, `< ${policy.priceExtension1hPct}% in 1h`, 'price already ran before the call'));
  }
  if (finite(i.priceGrowth3hPct) && i.priceGrowth3hPct >= policy.priceExtension3hPct) {
    checks.push(check('PRICE_ALREADY_EXTENDED_3H', 'WARN', 'WARN', i.priceGrowth3hPct, `< ${policy.priceExtension3hPct}% in 3h`, 'price already ran before the call'));
  }

  const critical = checks.filter((c) => c.severity === 'CRITICAL');
  const blockers = critical.filter((c) => c.status === 'BLOCK').map((c) => c.code);
  const unknowns = critical.filter((c) => c.status === 'UNKNOWN').map((c) => c.code);
  const warnings = checks.filter((c) => c.status === 'WARN').map((c) => c.code);
  const status: RadarSafetyStatus = blockers.length ? 'BLOCK' : unknowns.length ? 'UNKNOWN' : 'PASS';

  return {
    policyVersion: policy.version,
    mode: 'shadow',
    status,
    wouldBlock: status !== 'PASS',
    blockers,
    unknowns,
    warnings,
    checks,
    facts: {
      tokenId: i.tokenId,
      mint: i.mint,
      profile: i.profile,
      route: i.route,
      matchKind: i.matchKind,
      tier: i.tier,
      score: i.score,
      metricId: i.metricId,
      holderMetricId: i.holderMetricId,
      riskMetricId: i.riskMetricId ?? null,
      marketAt: iso(i.marketAt),
      holdersAt: iso(i.holdersAt),
      riskAt: iso(i.riskAt),
      priceUsd: i.priceUsd,
      marketCapUsd: i.marketCapUsd,
      liquidityUsd: i.liquidityUsd,
      volume24hUsd: i.volume24hUsd,
      holders: i.holders,
      top10Pct: i.top10Pct,
      top10ExLpPct: i.top10ExLpPct ?? null,
      devHoldingPct: i.devHoldingPct,
      riskFlags: [...i.riskFlags],
      priceGrowth1hPct: i.priceGrowth1hPct,
      priceGrowth3hPct: i.priceGrowth3hPct,
      narrativeManipulationRisk: i.narrativeManipulationRisk,
      lpBurnedPct: i.lpBurnedPct ?? null,
      lpLocked: i.lpLocked ?? null,
      bundlePct: i.bundlePct ?? null,
      sniperPct: i.sniperPct ?? null,
      insiderPct: i.insiderPct ?? null,
      uniqueBuyers24h: i.uniqueBuyers24h ?? null,
      uniqueSellers24h: i.uniqueSellers24h ?? null,
      priceImpactPct: i.priceImpactPct ?? null,
      deployerPriorRugs: i.deployerPriorRugs ?? null,
      evidenceSource: i.evidenceSource ?? null,
      evidenceAt: iso(i.evidenceAt),
      tradeabilityAt: iso(i.tradeabilityAt),
      tradeability: quote.success?quote.data:null,
    },
    evaluatedAt: now.toISOString(),
  };
}

/** Human-readable summary for alert bodies and diagnostics. Never includes raw social text or secrets. */
export function radarSafetyLabel(snapshot: RadarSafetySnapshot): string {
  const codes = snapshot.status === 'BLOCK' ? snapshot.blockers : snapshot.status === 'UNKNOWN' ? snapshot.unknowns : [];
  const parts = [`Safety evidence: ${snapshot.status}${codes.length ? ` (${codes.join(', ')})` : ''}.`];
  if (snapshot.facts.top10ExLpPct != null) parts.push(`Top-10 excluding known pool/locker accounts ${snapshot.facts.top10ExLpPct.toFixed(1)}%.`);
  if (snapshot.warnings.length) parts.push(`Warnings: ${snapshot.warnings.join(', ')}.`);
  return parts.join(' ');
}
