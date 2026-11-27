import type { PrismaClient } from '@narra/database';
import { meetsFloors, opportunityScore } from '@narra/token-intel';
import { recentPriceDynamics } from './earlyRadarTracking';
import { readCachedTokenEvidence } from './tokenEvidenceCache';

export const SIGNAL_OPPORTUNITY_LIMITS = {
  /** Lookback window for recent Smart Money Flow and Early Radar catalysts. */
  lookbackMs: 2 * 3_600_000,
  /** Require a live (<15m) price observation so AI analysis and outcome tracking have a valid entry price. */
  marketMaxAgeMs: 15 * 60_000,
  /** Exclude mega-cap tokens and stablecoins from synthesized alpha opportunities. */
  maxMarketCapUsd: 100_000_000,
  /** Minimum liquidity and holder floors (matches narrative opportunity floors). */
  minLiquidityUsd: 20_000,
  minHolders: 50,
  /** Avoid writing duplicate Opportunity rows for the same token within 60m unless score jumps >= 5 pts. */
  dedupeWindowMs: 60 * 60_000,
  scoreJumpDelta: 5,
  maxCandidatesPerRun: 30,
} as const;

const EXCLUDED_MINTS = new Set([
  'So11111111111111111111111111111111111111112',  // WSOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
]);

const num = (v: { toString(): string } | null | undefined) => (v == null ? null : Number(v.toString()));

export interface SignalOpportunitySummary {
  flowCandidates: number;
  radarCandidates: number;
  evaluated: number;
  opportunitiesWritten: number;
  skippedLowLiquidity: number;
  skippedMegaCap: number;
  skippedStale: number;
  skippedDuplicate: number;
}

/**
 * Feeds qualified Smart Money Flow (`BUY`) tokens and non-blocked Early Radar candidates into the
 * shared `Opportunity` table so AI analysis and `/app/analytics` evaluate real, diverse on-chain
 * catalysts—not only Treg narrative matches.
 */
export async function synthesizeSignalOpportunities(
  db: PrismaClient,
  now: Date = new Date(),
): Promise<SignalOpportunitySummary> {
  const out: SignalOpportunitySummary = {
    flowCandidates: 0,
    radarCandidates: 0,
    evaluated: 0,
    opportunitiesWritten: 0,
    skippedLowLiquidity: 0,
    skippedMegaCap: 0,
    skippedStale: 0,
    skippedDuplicate: 0,
  };

  const since = new Date(now.getTime() - SIGNAL_OPPORTUNITY_LIMITS.lookbackMs);
  const [flowRows, radarRows] = await Promise.all([
    db.walletResearchSignal.findMany({
      where: { side: 'BUY', createdAt: { gte: since, lte: now }, token: { blacklisted: false } },
      orderBy: { createdAt: 'desc' },
      take: SIGNAL_OPPORTUNITY_LIMITS.maxCandidatesPerRun,
      select: { tokenId: true, walletCount: true, independentEntities: true, netFlowSol: true },
    }),
    db.earlyRadarOutcome.findMany({
      where: { alertedAt: { gte: since, lte: now } },
      orderBy: { score: 'desc' },
      take: SIGNAL_OPPORTUNITY_LIMITS.maxCandidatesPerRun,
      select: { tokenId: true, score: true },
    }),
  ]);

  const flowByToken = new Map<string, { walletCount: number; independentEntities: number; netFlowSol: number }>();
  for (const r of flowRows) {
    if (!flowByToken.has(r.tokenId)) {
      flowByToken.set(r.tokenId, {
        walletCount: r.walletCount,
        independentEntities: r.independentEntities,
        netFlowSol: num(r.netFlowSol) ?? 0,
      });
    }
  }
  const radarByToken = new Map<string, number>();
  for (const r of radarRows) {
    const prev = radarByToken.get(r.tokenId) ?? 0;
    if (r.score != null && r.score > prev) radarByToken.set(r.tokenId, r.score);
  }

  out.flowCandidates = flowByToken.size;
  out.radarCandidates = radarByToken.size;
  const candidateIds = [...new Set([...flowByToken.keys(), ...radarByToken.keys()])].slice(0, SIGNAL_OPPORTUNITY_LIMITS.maxCandidatesPerRun);
  if (!candidateIds.length) return out;

  const tokens = await db.token.findMany({
    where: { id: { in: candidateIds }, blacklisted: false },
    include: {
      metrics: { orderBy: { at: 'desc' }, take: 1 },
      holders: { orderBy: { at: 'desc' }, take: 1 },
      consensus: { orderBy: { at: 'desc' }, take: 1 },
      narratives: {
        where: { narrative: { stage: { not: 'DEAD' } }, relation: { notIn: ['UNRELATED', 'SUSPICIOUS'] } },
        orderBy: [{ ogScore: 'desc' }, { confidence: 'desc' }],
        take: 1,
        include: { narrative: { select: { id: true, score: true, velocity: true, metrics: { orderBy: { at: 'desc' }, take: 1, select: { manipulationRisk: true } } } } },
      },
    },
  });

  for (const t of tokens) {
    if (EXCLUDED_MINTS.has(t.mint)) continue;
    out.evaluated++;

    const m = t.metrics[0];
    const h = t.holders[0];
    if (!m || !h) { out.skippedStale++; continue; }

    const priceUsd = num(m.priceUsd);
    const liquidityUsd = num(m.liquidityUsd);
    const marketCapUsd = num(m.marketCapUsd);
    if (priceUsd == null || priceUsd <= 0 || m.at > now || now.getTime() - m.at.getTime() > SIGNAL_OPPORTUNITY_LIMITS.marketMaxAgeMs) {
      out.skippedStale++;
      continue;
    }
    if (liquidityUsd == null || liquidityUsd < SIGNAL_OPPORTUNITY_LIMITS.minLiquidityUsd || h.holders < SIGNAL_OPPORTUNITY_LIMITS.minHolders) {
      out.skippedLowLiquidity++;
      continue;
    }
    if (marketCapUsd != null && marketCapUsd > SIGNAL_OPPORTUNITY_LIMITS.maxMarketCapUsd) {
      out.skippedMegaCap++;
      continue;
    }

    const rel = t.narratives[0] ?? null;
    const relation = rel?.relation && rel.relation !== 'UNRELATED' ? rel.relation : 'PRIMARY';
    if (!meetsFloors({ liquidityUsd, holders: h.holders, relation })) {
      out.skippedLowLiquidity++;
      continue;
    }

    const flow = flowByToken.get(t.id);
    const radarScore = radarByToken.get(t.id) ?? null;
    const derivedFlowScore = flow
      ? Math.min(100, Math.round(45 + flow.independentEntities * 12 + Math.min(30, flow.netFlowSol * 2)))
      : 0;
    const smartMoneyScore = Math.max(t.consensus[0]?.score ?? 0, derivedFlowScore);
    const hasSmartMoneyConsensus = Boolean(t.consensus[0] || flow);
    const narrativeScore = rel?.narrative.score ?? (radarScore != null ? Math.min(85, Math.max(55, radarScore)) : 55);
    const ogScore = rel?.ogScore ?? 55;

    const [{ growth1h, growth3h, drawdownFromPeakPct }, cached] = await Promise.all([
      recentPriceDynamics(db, t.id, priceUsd, m.at),
      readCachedTokenEvidence(db, t.mint),
    ]);

    const sc = opportunityScore({
      narrativeScore,
      smartMoneyScore,
      hasSmartMoneyConsensus,
      liquidityUsd,
      holders: h.holders,
      priceGrowth1hPct: growth1h,
      ogScore,
      relation,
      divergence: 'NEUTRAL',
      top10Pct: h.top10Pct,
      top10ExLpPct: cached.safety?.top10ExLpPct ?? null,
      devHoldingPct: h.devHoldingPct ?? cached.safety?.devHoldingPct ?? null,
      tokenAgeMinutes: t.createdOnChainAt ? (now.getTime() - t.createdOnChainAt.getTime()) / 60_000 : null,
      narrativeManipulationRisk: rel?.narrative.metrics[0]?.manipulationRisk ?? null,
      bundlePct: cached.launch?.bundlePct ?? null,
      sniperPct: cached.launch?.sniperPct ?? null,
      insiderPct: cached.launch?.insiderPct ?? cached.safety?.insiderPct ?? null,
      drawdownFromPeakPct,
    });

    const last = await db.opportunity.findFirst({
      where: { tokenId: t.id },
      orderBy: { createdAt: 'desc' },
      select: { score: true, createdAt: true },
    });
    const age = last ? now.getTime() - last.createdAt.getTime() : Infinity;
    if (last && age < SIGNAL_OPPORTUNITY_LIMITS.dedupeWindowMs && Math.abs(last.score - sc.score) < SIGNAL_OPPORTUNITY_LIMITS.scoreJumpDelta) {
      out.skippedDuplicate++;
      continue;
    }

    await db.opportunity.create({
      data: {
        tokenId: t.id,
        narrativeId: rel?.narrative.id ?? null,
        score: sc.score,
        narrativeScore: sc.narrative,
        smartMoneyScore: sc.smartMoney,
        liquidityScore: sc.liquidity,
        momentumScore: sc.momentum,
        ogScore: sc.og,
        riskScore: sc.risk,
        attentionGrowth: rel?.narrative.velocity ?? null,
        priceGrowth: growth3h,
        createdAt: now,
      },
    });
    out.opportunitiesWritten++;
  }

  return out;
}
