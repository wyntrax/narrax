import type { PrismaClient } from '@narra/database';
import { OUTCOME_CONFIG, measureOutcome, sortSeries, type Point } from '@narra/analytics';

const MAX_PER_RUN = 200;
const num = (d: { toString(): string }) => Number(d.toString());

export interface TrackSummary { measured: number; finalized: number; stillPending: number; unknown: number }

/** Stored readings for a token between two times, as plain numbers. */
export async function loadSeries(db: PrismaClient, tokenId: string, from: Date, to: Date): Promise<Point[]> {
  const rows = await db.tokenMetric.findMany({ where: { tokenId, at: { gte: from, lte: to } }, orderBy: { at: 'asc' }, select: { at: true, priceUsd: true, liquidityUsd: true, volume24hUsd: true } });
  return sortSeries(rows.map((r) => ({ at: r.at, priceUsd: num(r.priceUsd), liquidityUsd: num(r.liquidityUsd), volume24hUsd: num(r.volume24hUsd) })));
}

/**
 * Writes one DecisionOutcome per global AgentDecision: what the price did over the next hour and 24 hours.
 * A decision is re-measured every run until its 24h window has closed (or its 24h price exists), then it is final and left alone.
 * It only reads stored prices. A decision with no price near it is UNKNOWN with a reason, never a zero.
 * Per-user decisions are not measured: the outcome of a decision does not depend on who acted on it.
 */
export async function trackOutcomes(db: PrismaClient, deps: { now?: () => Date; batch?: number; /** Limits a run to these decisions. For tests that share a database and for targeted re-runs. */ only?: string[] } = {}): Promise<TrackSummary> {
  const now = (deps.now ?? (() => new Date()))(), c = OUTCOME_CONFIG;
  const out: TrackSummary = { measured: 0, finalized: 0, stillPending: 0, unknown: 0 };
  const rows = await db.agentDecision.findMany({
    where: { userId: null, ...(deps.only ? { id: { in: deps.only } } : {}), createdAt: { lte: new Date(now.getTime() - c.shortHorizonMs) }, OR: [{ outcome: null }, { outcome: { isFinal: false } }] },
    orderBy: { createdAt: 'asc' }, take: deps.batch ?? MAX_PER_RUN,
    include: { analysis: { include: { opportunity: { select: { tokenId: true } } } } },
  });
  for (const d of rows) {
    const series = await loadSeries(db, d.analysis.opportunity.tokenId, new Date(d.createdAt.getTime() - c.entryToleranceMs), new Date(d.createdAt.getTime() + c.longHorizonMs + c.horizonToleranceMs));
    const o = measureOutcome({ decidedAt: d.createdAt, series, now });
    const data = {
      label: o.label, returnPct1h: o.return1hPct, returnPct24h: o.return24hPct, leadTimeSeconds: o.leadTimeSeconds, entryPriceUsd: o.entryPriceUsd,
      maxGainPct: o.maxGainPct, maxDrawdownPct: o.maxDrawdownPct, isFinal: o.status === 'FINAL', unknownReason: o.unknownReason, measuredAt: now,
    };
    await db.decisionOutcome.upsert({ where: { decisionId: d.id }, create: { decisionId: d.id, ...data }, update: data });
    out.measured++;
    if (o.status === 'FINAL') { out.finalized++; if (o.label === 'UNKNOWN') out.unknown++; } else out.stillPending++;
  }
  return out;
}
