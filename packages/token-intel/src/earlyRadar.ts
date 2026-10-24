import type { DivergenceLabel } from './divergence';
import type { TokenRelation } from './og';

/**
 * Early radar: a research lane for tokens that are still small (market cap under $100K) and tied to a live narrative.
 * It ranks and explains. It never recommends a trade, and nothing here reaches an order (the trading path is
 * unchanged: the AI step still demotes anything under the main liquidity and holder floors).
 *
 * Two profiles read the same facts differently:
 *  - trencher: young, fast, tolerates thin structure, wants narrative momentum and room to run.
 *  - holder: wants a token that has survived its first day with a spread-out, growing holder base, small dev
 *    and top-holder share, and real liquidity behind its cap.
 *
 * Every number is a named starting value. None is validated against outcomes. "Community" is a proxy built from
 * holder count, holder growth, smart-wallet holders and how organic the narrative looks. It is not a measure of
 * a real community, and a high score is not a prediction that price will rise.
 */
export type EarlyProfile = 'trencher' | 'holder';

export const EARLY_RULES = {
  /** The ceiling the owner asked for. At or above this a token is out of the early lane. */
  maxMarketCapUsd: 100_000,
  /** Below this the cap is dust and the price data is too easy to distort to rank. */
  minMarketCapUsd: 2_000,
  /** Daily volume over this multiple of market cap is flagged as possible wash trading. */
  washTurnover: 30,
  trencher: { minLiquidityUsd: 3_000, minHolders: 30, maxTop10Pct: 70, maxDevPct: 15, minAgeMinutes: 10, maxAgeMinutes: 72 * 60, minLiquidityToCap: 0.05 },
  holder: { minLiquidityUsd: 8_000, minHolders: 150, maxTop10Pct: 45, maxDevPct: 5, minAgeMinutes: 12 * 60, maxAgeMinutes: 30 * 24 * 60, minLiquidityToCap: 0.08 },
  /** Weights per profile, each set sums to 100. */
  weights: {
    trencher: { narrative: 30, organic: 8, community: 12, roomToRun: 15, divergence: 10, momentum: 10, structure: 15 },
    holder: { narrative: 15, organic: 12, community: 28, roomToRun: 5, divergence: 5, momentum: 0, structure: 35 },
  },
  tiers: { strong: 70, watch: 55 },
  /**
   * The free market sources never report developer holding, so it is stored as unknown today. Excluding unknown would
   * leave the holder profile with nothing to show, so an unknown dev share is flagged and the holder score is capped
   * here (below the STRONG tier) until real dev-holding data exists.
   */
  holderUnknownDevCap: 60,
} as const;

/** Stage multiplier on the narrative score: early stages are worth most, crowded or fading ones little. */
const STAGE_FACTOR: Record<string, number> = { SEED: 0.7, EMERGING: 1, ACCELERATING: 1, MAINSTREAM: 0.6, SATURATED: 0.3, DECAYING: 0.2, DEAD: 0 };
const DIVERGENCE_VALUE: Record<DivergenceLabel, number> = { STRONG_POSITIVE: 1, POSITIVE: 0.75, NEUTRAL: 0.4, UNKNOWN: 0.4, NEGATIVE: 0.1, NEGATIVE_SATURATED: 0 };

export interface EarlyInputs {
  marketCapUsd: number;
  liquidityUsd: number;
  volume24hUsd: number;
  /** Null means the source did not say. It is never treated as zero. */
  holders: number | null;
  /** Holder count about three hours earlier, when a row that old exists. */
  holdersThen: number | null;
  top10Pct: number | null;
  devHoldingPct: number | null;
  smartWalletHolders: number;
  tokenAgeMinutes: number | null;
  /** 'UNKNOWN' for a token found through social chatter, where no narrative resolution has judged its origin. */
  relation: TokenRelation | 'UNKNOWN';
  /** Null when origin was not assessed. It then counts as neutral and is flagged, never as good. */
  ogScore: number | null;
  /** True when the token was matched from a $TICKER alone. Anyone can launch a copycat with the same symbol. */
  symbolOnlyMatch?: boolean;
  narrativeScore: number;
  narrativeStage: string;
  /** 0 to 100, higher is worse. Null when the narrative had too few mentions to judge. */
  narrativeManipulationRisk: number | null;
  divergence: DivergenceLabel;
  priceGrowth1hPct: number | null;
  /** Flags from the stored token risk row (for example HONEYPOT, MINT_AUTHORITY_ACTIVE). */
  riskFlags: readonly string[];
}

export type EarlyTier = 'STRONG' | 'WATCH' | 'LOW';
export interface EarlyResult {
  profile: EarlyProfile;
  /** False when any hard rule failed. A failed token has score 0 and the reasons say why. */
  eligible: boolean;
  score: number;
  tier: EarlyTier | 'EXCLUDED';
  /** Why a token was excluded. Empty when eligible. */
  reasons: string[];
  /** Cautions that lowered the score or deserve a look. They do not exclude. */
  flags: string[];
  components: Record<'narrative' | 'organic' | 'community' | 'roomToRun' | 'divergence' | 'momentum' | 'structure', number>;
}

const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const r1 = (x: number) => Math.round(x * 10) / 10;
const finite = (x: number | null): x is number => x != null && Number.isFinite(x);

export function evaluateEarly(profile: EarlyProfile, i: EarlyInputs, rules: typeof EARLY_RULES = EARLY_RULES): EarlyResult {
  const p = rules[profile];
  const reasons: string[] = [];
  const flags: string[] = [];
  const out = (score: number, components: EarlyResult['components']): EarlyResult => {
    const eligible = reasons.length === 0;
    const s = eligible ? r1(clamp(score, 0, 100)) : 0;
    return { profile, eligible, score: s, tier: !eligible ? 'EXCLUDED' : s >= rules.tiers.strong ? 'STRONG' : s >= rules.tiers.watch ? 'WATCH' : 'LOW', reasons, flags, components };
  };
  const zero = { narrative: 0, organic: 0, community: 0, roomToRun: 0, divergence: 0, momentum: 0, structure: 0 };

  // Hard rules. Missing facts fail closed: an unknown cap or liquidity cannot be ranked.
  if (!finite(i.marketCapUsd) || !finite(i.liquidityUsd) || !finite(i.volume24hUsd) || i.marketCapUsd <= 0) { reasons.push('MARKET_DATA_MISSING'); return out(0, zero); }
  if (i.marketCapUsd >= rules.maxMarketCapUsd) reasons.push('ABOVE_MARKET_CAP_CEILING');
  if (i.marketCapUsd < rules.minMarketCapUsd) reasons.push('BELOW_MARKET_CAP_FLOOR');
  if (i.riskFlags.includes('HONEYPOT')) reasons.push('HONEYPOT');
  if (i.riskFlags.includes('MINT_AUTHORITY_ACTIVE')) reasons.push('MINT_AUTHORITY_ACTIVE');
  if (i.riskFlags.includes('FREEZE_AUTHORITY_ACTIVE')) reasons.push('FREEZE_AUTHORITY_ACTIVE');
  if (i.relation === 'SUSPICIOUS') reasons.push('SUSPICIOUS_COPY');
  if (i.narrativeStage === 'DEAD') reasons.push('NARRATIVE_DEAD');
  if (i.liquidityUsd < p.minLiquidityUsd) reasons.push('LIQUIDITY_TOO_LOW');
  if (i.holders == null) reasons.push('HOLDERS_UNKNOWN');
  else if (i.holders < p.minHolders) reasons.push('TOO_FEW_HOLDERS');
  if (i.top10Pct == null) reasons.push('CONCENTRATION_UNKNOWN');
  else if (i.top10Pct > p.maxTop10Pct) reasons.push('TOP_HOLDERS_TOO_CONCENTRATED');
  if (i.devHoldingPct != null && i.devHoldingPct > p.maxDevPct) reasons.push('DEV_HOLDING_TOO_HIGH');
  if (i.tokenAgeMinutes == null) reasons.push('AGE_UNKNOWN');
  else if (i.tokenAgeMinutes < p.minAgeMinutes) reasons.push(profile === 'holder' ? 'TOO_YOUNG_FOR_HOLDER_PROFILE' : 'TOO_NEW');
  else if (i.tokenAgeMinutes > p.maxAgeMinutes) reasons.push('PAST_EARLY_WINDOW');
  if (i.liquidityUsd / i.marketCapUsd < p.minLiquidityToCap) reasons.push('LIQUIDITY_THIN_FOR_CAP');
  if (reasons.length) return out(0, zero);

  if (i.devHoldingPct == null) flags.push('DEV_HOLDING_UNKNOWN');
  if (i.volume24hUsd / i.marketCapUsd > rules.washTurnover) flags.push('POSSIBLE_WASH_VOLUME');
  if (i.narrativeManipulationRisk == null) flags.push('NARRATIVE_ORGANIC_UNKNOWN');
  else if (i.narrativeManipulationRisk >= 60) flags.push('NARRATIVE_LOOKS_MANIPULATED');
  if (i.divergence === 'NEGATIVE_SATURATED') flags.push('PRICE_RAN_AHEAD_OF_ATTENTION');
  if (i.relation === 'DERIVATIVE' || i.relation === 'MEME_EXPRESSION') flags.push('NOT_THE_OG');
  if (i.relation === 'UNKNOWN') flags.push('ORIGIN_UNVERIFIED');
  if (i.symbolOnlyMatch) flags.push('TICKER_MATCH_ONLY');

  // Components, each 0 to 1. Unknown inputs take a neutral 0.5 and are flagged above, never counted as good.
  const narrative = clamp(i.narrativeScore / 100) * (STAGE_FACTOR[i.narrativeStage] ?? 0.5);
  const organic = i.narrativeManipulationRisk == null ? 0.5 : clamp(1 - i.narrativeManipulationRisk / 100);
  const holderCount = clamp(Math.log10(Math.max(i.holders!, 1) / p.minHolders) / Math.log10(10)); // minimum to 10x the minimum
  const growth = finite(i.holdersThen) && i.holdersThen > 0 ? clamp(((i.holders! / i.holdersThen) - 1) / 0.5) : 0.4; // +50% in about 3h is full marks; unknown is below neutral on purpose
  const smart = clamp(i.smartWalletHolders / 3);
  const community = 0.45 * holderCount + 0.3 * growth + 0.25 * smart;
  const roomToRun = clamp((rules.maxMarketCapUsd - i.marketCapUsd) / (rules.maxMarketCapUsd - rules.minMarketCapUsd));
  const divergence = DIVERGENCE_VALUE[i.divergence];
  const momentum = i.priceGrowth1hPct == null ? 0.5 : clamp((clamp(i.priceGrowth1hPct, -30, 60) + 30) / 90);
  const structure = (
    0.35 * clamp((p.maxTop10Pct - i.top10Pct!) / (p.maxTop10Pct - 15)) +
    0.25 * (i.devHoldingPct == null ? 0.5 : clamp((p.maxDevPct - i.devHoldingPct) / p.maxDevPct)) +
    0.25 * clamp(i.liquidityUsd / i.marketCapUsd / 0.3) +
    0.15 * (i.ogScore == null ? 0.5 : clamp(i.ogScore / 100))
  );
  const components = { narrative, organic, community, roomToRun, divergence, momentum, structure };
  const w = rules.weights[profile];
  let score = 0;
  for (const k of Object.keys(w) as (keyof typeof w)[]) score += w[k] * components[k];

  // Caps keep a flagged token from ranking as a strong pick.
  if (flags.includes('POSSIBLE_WASH_VOLUME')) score = Math.min(score, 60);
  if (flags.includes('NARRATIVE_LOOKS_MANIPULATED')) score = Math.min(score, 55);
  if (flags.includes('PRICE_RAN_AHEAD_OF_ATTENTION')) score = Math.min(score, 60);
  if ((flags.includes('NOT_THE_OG') || flags.includes('ORIGIN_UNVERIFIED')) && profile === 'holder') score = Math.min(score, 65);
  if (flags.includes('TICKER_MATCH_ONLY')) score = Math.min(score, 60);
  if (profile === 'holder' && flags.includes('DEV_HOLDING_UNKNOWN')) score = Math.min(score, rules.holderUnknownDevCap);

  const rounded = Object.fromEntries(Object.entries(components).map(([k, v]) => [k, r1(v * 100)])) as EarlyResult['components'];
  return out(score, rounded);
}

/** Both profiles at once. A token can be a trencher candidate today and a holder candidate a week later. */
export function evaluateEarlyBoth(i: EarlyInputs): Record<EarlyProfile, EarlyResult> {
  return { trencher: evaluateEarly('trencher', i), holder: evaluateEarly('holder', i) };
}
