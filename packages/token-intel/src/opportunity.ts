import type { DivergenceLabel } from './divergence';
import type { TokenRelation } from './og';

export interface OpportunityInputs {
  narrativeScore: number;
  /** Latest smart money consensus score, or 0 when no qualifying wallet has bought. */
  smartMoneyScore: number;
  /** False when no smart money consensus record exists yet so missing coverage is not scored as bearish (defaults true for legacy callers). */
  hasSmartMoneyConsensus?: boolean;
  liquidityUsd: number;
  holders: number;
  priceGrowth1hPct: number | null;
  ogScore: number;
  relation: TokenRelation;
  divergence: DivergenceLabel;
  top10Pct: number | null;
  /** Top-10 concentration excluding known LP pools; preferred over raw top10Pct when available. */
  top10ExLpPct?: number | null;
  devHoldingPct: number | null;
  tokenAgeMinutes: number | null;
  narrativeManipulationRisk: number | null;
  bundlePct?: number | null;
  sniperPct?: number | null;
  insiderPct?: number | null;
  drawdownFromPeakPct?: number | null;
}

export interface OpportunityScores {
  score: number;
  narrative: number;
  smartMoney: number;
  liquidity: number;
  momentum: number;
  og: number;
  /** 0 to 100, higher is worse. */
  risk: number;
  caps: string[];
}

export const MIN_LIQUIDITY_USD = 20_000;
export const MIN_HOLDERS = 50;

const clamp = (x: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, x));
const r1 = (x: number) => Math.round(x * 10) / 10;

/** Whether a token may be ranked at all. Below these floors it stays a watched candidate, never an opportunity. */
export function meetsFloors(i: Pick<OpportunityInputs, 'liquidityUsd' | 'holders' | 'relation'>): boolean {
  return i.relation !== 'SUSPICIOUS' && i.liquidityUsd >= MIN_LIQUIDITY_USD && i.holders >= MIN_HOLDERS;
}

/**
 * Opportunity score: narrative 30, smart money 25, liquidity 15, momentum 10, OG 10, low risk 10,
 * plus 5 for a strong positive attention-price gap. Hard caps keep weak setups from ranking high.
 */
export function opportunityScore(i: OpportunityInputs): OpportunityScores {
  const liquidity = clamp(((Math.log10(Math.max(i.liquidityUsd, 1)) - Math.log10(20_000)) / (Math.log10(1_000_000) - Math.log10(20_000))) * 100);
  const momentum = i.priceGrowth1hPct == null ? 50 : clamp(50 + clamp(i.priceGrowth1hPct, -30, 40) * 1.25);

  const effectiveTop10 = i.top10ExLpPct ?? i.top10Pct;
  const launchClusterPct = (i.bundlePct ?? 0) + (i.sniperPct ?? 0) + (i.insiderPct ?? 0);
  const launchPenalty = (i.bundlePct != null || i.sniperPct != null || i.insiderPct != null)
    ? clamp((launchClusterPct - 10) / 40, 0, 1) * 20
    : 0;
  const drawdownPenalty = i.drawdownFromPeakPct != null && i.drawdownFromPeakPct > 25
    ? clamp((i.drawdownFromPeakPct - 25) / 45, 0, 1) * 15
    : 0;

  const unknown = 0.5;
  const risk = clamp(100 * (
    0.25 * (effectiveTop10 == null ? unknown : clamp((effectiveTop10 - 20) / 50, 0, 1)) +
    0.20 * (i.devHoldingPct == null ? unknown : clamp(i.devHoldingPct / 20, 0, 1)) +
    0.20 * (1 - liquidity / 100) +
    0.15 * (i.narrativeManipulationRisk == null ? unknown : i.narrativeManipulationRisk / 100) +
    0.10 * (i.tokenAgeMinutes == null ? unknown : clamp(1 - i.tokenAgeMinutes / 60, 0, 1)) +
    0.10 * (i.relation === 'SUSPICIOUS' ? 1 : 0)
  ) + launchPenalty + drawdownPenalty);

  const hasConsensus = i.hasSmartMoneyConsensus ?? true;
  const baseWeightSum = 0.75; // 0.30 + 0.15 + 0.10 + 0.10 + 0.10
  let score = hasConsensus
    ? 0.30 * i.narrativeScore + 0.25 * i.smartMoneyScore + 0.15 * liquidity + 0.10 * momentum + 0.10 * i.ogScore + 0.10 * (100 - risk)
    : (0.30 * i.narrativeScore + 0.15 * liquidity + 0.10 * momentum + 0.10 * i.ogScore + 0.10 * (100 - risk)) / baseWeightSum;
  if (i.divergence === 'STRONG_POSITIVE') score += 5;

  const caps: string[] = [];
  const cap = (limit: number, why: string) => { if (score > limit) { score = limit; caps.push(why); } };
  if (i.relation === 'SUSPICIOUS') cap(40, 'SUSPICIOUS_TOKEN');
  if (i.liquidityUsd < MIN_LIQUIDITY_USD) cap(50, 'THIN_LIQUIDITY');
  if (risk >= 80) cap(55, 'HIGH_RISK');
  if (i.drawdownFromPeakPct != null && i.drawdownFromPeakPct >= 65) cap(55, 'EXTREME_DRAWDOWN');
  if (i.divergence === 'NEGATIVE_SATURATED') cap(60, 'PRICE_RAN_AHEAD');

  return { score: r1(clamp(score)), narrative: r1(i.narrativeScore), smartMoney: r1(hasConsensus ? i.smartMoneyScore : 0), liquidity: r1(liquidity), momentum: r1(momentum), og: r1(i.ogScore), risk: r1(risk), caps };
}
