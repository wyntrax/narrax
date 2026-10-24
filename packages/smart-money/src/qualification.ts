import type { TradeRow, WalletStats } from './stats';

/** Research admission rules, not a profitability guarantee or a change to walletScore.
 * Starting values require forward validation. Costs/transfers outside parsed swaps remain unknown. */
export const RESEARCH_QUALIFICATION = {
  version: 1, minClosedLegs: 20, minClosedTokens: 5, minObservedDays: 7,
  minScore: 70, maxProfileAgeMs: 45 * 60_000, maxHistoryAgeMs: 24 * 3_600_000,
  maxTradeAgeMs: 24 * 3_600_000,
} as const;

export interface ResearchSample {
  checkedAt: string; closedTrades: number; closedTokens: number; observedDays: number;
  unmatchedSells: number; excessSellUnits: number; score: number | null;
  pnlSol: number | null; medianRoi: number | null; lastTradeAt: string | null;
}
export interface ResearchHistory {
  checkedAt: string; capped: boolean; skipped: number; windowDays: number;
  /** Explicit coverage boundaries distinguish a completed scan from legacy CLI metadata. */
  coveredFrom: string; coveredTo: string;
}

export function researchSample(trades: TradeRow[], stats: WalletStats, score: number | null, now: Date): ResearchSample {
  const ordered = [...trades].sort((a,b) => +a.at - +b.at);
  const inventory = new Map<string, number>();
  let excessSellUnits = 0;
  for (const t of ordered) {
    const held = inventory.get(t.token) ?? 0;
    if (t.side === 'SELL' && t.qty > held + Math.max(1e-9, held * 1e-9)) excessSellUnits++;
    inventory.set(t.token, t.side === 'BUY' ? held + t.qty : Math.max(0, held - t.qty));
  }
  return { checkedAt: now.toISOString(), closedTrades: stats.legs.length, closedTokens: new Set(stats.legs.map(l => l.token)).size,
    observedDays: ordered.length ? (+ordered.at(-1)!.at - +ordered[0]!.at) / 86_400_000 : 0,
    unmatchedSells: stats.unmatchedSells, excessSellUnits, score, pnlSol: stats.legs.length ? stats.pnlSol : null,
    medianRoi: stats.medianRoi, lastTradeAt: ordered.at(-1)?.at.toISOString() ?? null };
}
const obj = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const fresh = (v: unknown, now: Date, maxAge: number) => typeof v === 'string' && Number.isFinite(Date.parse(v)) && +now >= Date.parse(v) && +now - Date.parse(v) <= maxAge;

/** Recomputed at read/publication time: a recent recompute cannot make old trades fresh. */
export function qualifyWallet(review: string, active: boolean, sampleValue: unknown, historyValue: unknown, now: Date) {
  const s = obj(sampleValue), h = obj(historyValue), L = RESEARCH_QUALIFICATION;
  const reasons: string[] = [];
  if (!active) reasons.push('INACTIVE');
  if (review !== 'APPROVED') reasons.push(review === 'REJECTED' ? 'REJECTED' : 'REVIEW_REQUIRED');
  if (!fresh(s.checkedAt, now, L.maxProfileAgeMs)) reasons.push('PROFILE_STALE_OR_MISSING');
  if (!finite(s.closedTrades) || s.closedTrades < L.minClosedLegs) reasons.push('TOO_FEW_CLOSES');
  if (!finite(s.closedTokens) || s.closedTokens < L.minClosedTokens) reasons.push('TOO_FEW_TOKENS');
  if (!finite(s.observedDays) || s.observedDays < L.minObservedDays) reasons.push('SHORT_SAMPLE');
  if (s.unmatchedSells !== 0 || s.excessSellUnits !== 0) reasons.push('INCOMPLETE_COST_BASIS');
  if (!finite(s.score) || s.score < L.minScore) reasons.push('SCORE_BELOW_MINIMUM');
  if (!finite(s.pnlSol) || s.pnlSol <= 0 || !finite(s.medianRoi) || s.medianRoi <= 0) reasons.push('POSITIVE_RESULTS_REQUIRED');
  if (!fresh(s.lastTradeAt, now, L.maxTradeAgeMs)) reasons.push('ACTIVITY_STALE_OR_MISSING');
  if (!fresh(h.checkedAt, now, L.maxHistoryAgeMs) || h.capped !== false || h.skipped !== 0 || h.windowDays !== 30 ||
      !fresh(h.coveredTo, now, L.maxHistoryAgeMs) || typeof h.coveredFrom !== 'string' || typeof h.coveredTo !== 'string' ||
      !Number.isFinite(Date.parse(h.coveredFrom)) || Date.parse(h.coveredTo) - Date.parse(h.coveredFrom) < 30 * 86_400_000) reasons.push('HISTORY_INCOMPLETE_OR_STALE');
  return { status: reasons.length ? review === 'REJECTED' ? 'REJECTED' : 'PROVISIONAL' : 'QUALIFIED', eligible: reasons.length === 0, reasons, rulesVersion: L.version };
}
