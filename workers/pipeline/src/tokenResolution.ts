import type { PrismaClient } from '@narra/database';
import {
  MATCH_THRESHOLD, attentionPriceDivergence, matchScore, meetsFloors, opportunityScore, resolveCandidates, words,
  type Candidate,
} from '@narra/token-intel';

export interface ResolveSummary {
  narrativesChecked: number;
  candidates: number;
  newCandidates: number;
  opportunitiesWritten: number;
  noTokenYet: number;
  alerts: number;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const num = (v: { toString(): string } | null | undefined) => (v == null ? null : Number(v.toString()));

/**
 * Finds token candidates for each live narrative, scores how likely each is the original, and ranks the ones
 * that pass liquidity and holder floors. This job only reads market data and writes research rows and alerts.
 * It has no access to orders, positions or execution, so a matching ticker can never trigger a buy.
 */
export async function resolveTokens(db: PrismaClient, now: Date = new Date()): Promise<ResolveSummary> {
  const out: ResolveSummary = { narrativesChecked: 0, candidates: 0, newCandidates: 0, opportunitiesWritten: 0, noTokenYet: 0, alerts: 0 };
  const alert = async (data: { kind: string; priority: 'INFO' | 'WATCH' | 'IMPORTANT' | 'CRITICAL'; title: string; body: string; refType: string; refId: string }) => {
    await db.alert.create({ data: { ...data, createdAt: now } });
    out.alerts++;
  };

  const narratives = await db.narrative.findMany({
    where: { stage: { not: 'DEAD' } },
    select: { id: true, name: true, stage: true, score: true, velocity: true, firstDetectedAt: true, metrics: { orderBy: { at: 'desc' }, take: 1, select: { manipulationRisk: true } } },
  });

  for (const n of narratives) {
    const ws = words(n.name).filter((w) => w.length >= 4).slice(0, 5);
    if (!ws.length) continue;
    out.narrativesChecked++;

    const prefixes = [...new Set(ws.map((w) => w.slice(0, 4)))];
    const tokens = await db.token.findMany({
      where: { OR: prefixes.flatMap((p) => [{ symbol: { contains: p, mode: 'insensitive' as const } }, { name: { contains: p, mode: 'insensitive' as const } }]) },
      take: 300,
      include: { metrics: { orderBy: { at: 'desc' }, take: 1 }, holders: { orderBy: { at: 'desc' }, take: 1 }, consensus: { orderBy: { at: 'desc' }, take: 1 }, risk: { orderBy: { at: 'desc' }, take: 1 } },
    });
    const matched = tokens.map((t) => ({ t, match: matchScore(n.name, { symbol: t.symbol, name: t.name }) })).filter((x) => x.match >= MATCH_THRESHOLD);

    if (!matched.length) {
      // A narrative with no token yet is watched, not traded. One alert, and candidates are picked up as they appear.
      if (n.stage === 'EMERGING' || n.stage === 'ACCELERATING') {
        const seen = await db.alert.count({ where: { kind: 'NO_TOKEN_YET', refId: n.id } });
        if (!seen) await alert({ kind: 'NO_TOKEN_YET', priority: 'WATCH', title: `${n.name}: no token yet`, body: 'The narrative is gaining attention but no matching token exists. Watching for launches. Nothing will be bought on a ticker match alone.', refType: 'NARRATIVE', refId: n.id });
        out.noTokenYet++;
      }
      continue;
    }

    const candidates: Candidate[] = [];
    for (const { t, match } of matched) {
      let deployerRecent: number | null = null;
      if (t.deployer && t.createdOnChainAt) {
        deployerRecent = await db.token.count({ where: { deployer: t.deployer, id: { not: t.id }, createdOnChainAt: { gte: new Date(t.createdOnChainAt.getTime() - 7 * DAY), lte: new Date(t.createdOnChainAt.getTime() + 7 * DAY) } } });
      }
      candidates.push({ id: t.id, symbol: t.symbol, createdAt: t.createdOnChainAt, deployer: t.deployer, matchScore: match, top10Pct: t.holders[0]?.top10Pct ?? null, devHoldingPct: t.holders[0]?.devHoldingPct ?? null, deployerRecentTokens: deployerRecent });
    }
    const og = resolveCandidates({ firstDetectedAt: n.firstDetectedAt }, candidates);
    out.candidates += candidates.length;

    for (const { t, match } of matched) {
      const r = og.get(t.id)!;
      const existing = await db.narrativeTokenRelation.findUnique({ where: { narrativeId_tokenId: { narrativeId: n.id, tokenId: t.id } }, select: { id: true } });
      const data = { relation: r.relation, ogScore: r.ogScore, matchScore: match, confidence: r.confidence };
      await db.narrativeTokenRelation.upsert({ where: { narrativeId_tokenId: { narrativeId: n.id, tokenId: t.id } }, create: { narrativeId: n.id, tokenId: t.id, ...data }, update: data });
      if (!existing) {
        out.newCandidates++;
        await alert({
          kind: 'NEW_OG_TOKEN_CANDIDATE', refType: 'TOKEN', refId: t.id,
          priority: r.relation === 'OG' && r.confidence >= 0.75 ? 'IMPORTANT' : r.relation === 'SUSPICIOUS' ? 'WATCH' : 'INFO',
          title: `${t.symbol}: ${r.classification.toLowerCase()} for ${n.name}`,
          body: `OG score ${r.ogScore}, confidence ${Math.round(r.confidence * 100)}%${r.flags.length ? `, flags: ${r.flags.join(', ')}` : ''}. This is an estimate, not proof.`,
        });
      }

      // Ranking needs real liquidity and holders. Until then it stays a watched candidate.
      const m = t.metrics[0], h = t.holders[0];
      if (!m || !h || r.relation === 'SUSPICIOUS') continue;
      // A confirmed honeypot is never ranked, whatever its narrative score. Other risk flags only lower the score.
      if (t.risk[0]?.flags.includes('HONEYPOT')) continue;
      const liquidityUsd = num(m.liquidityUsd) ?? 0;
      if (!meetsFloors({ liquidityUsd, holders: h.holders, relation: r.relation })) continue;

      const price = num(m.priceUsd) ?? 0;
      const priceAt = async (hoursAgo: number) => {
        const row = await db.tokenMetric.findFirst({ where: { tokenId: t.id, at: { lte: new Date(now.getTime() - hoursAgo * HOUR) } }, orderBy: { at: 'desc' }, select: { priceUsd: true } });
        return num(row?.priceUsd);
      };
      const [p1, p3] = await Promise.all([priceAt(1), priceAt(3)]);
      const growth = (then: number | null) => (then && then > 0 ? (price / then - 1) * 100 : null);
      const growth1h = growth(p1), growth3h = growth(p3);

      const divergence = attentionPriceDivergence(n.velocity, growth3h);
      const sc = opportunityScore({
        narrativeScore: n.score, smartMoneyScore: t.consensus[0]?.score ?? 0, liquidityUsd, holders: h.holders, priceGrowth1hPct: growth1h, ogScore: r.ogScore,
        relation: r.relation, divergence: divergence.label, top10Pct: h.top10Pct, devHoldingPct: h.devHoldingPct ?? null,
        tokenAgeMinutes: t.createdOnChainAt ? (now.getTime() - t.createdOnChainAt.getTime()) / 60_000 : null, narrativeManipulationRisk: n.metrics[0]?.manipulationRisk ?? null,
      });

      // History without noise: write when nothing exists, or when it moved at least 2 points (or an hour passed).
      const last = await db.opportunity.findFirst({ where: { tokenId: t.id }, orderBy: { createdAt: 'desc' }, select: { score: true, createdAt: true } });
      const age = last ? now.getTime() - last.createdAt.getTime() : Infinity;
      if (!last || (age >= 15 * 60_000 && (Math.abs(last.score - sc.score) >= 2 || age >= HOUR))) {
        await db.opportunity.create({
          data: { tokenId: t.id, narrativeId: n.id, score: sc.score, narrativeScore: sc.narrative, smartMoneyScore: sc.smartMoney, liquidityScore: sc.liquidity, momentumScore: sc.momentum, ogScore: sc.og, riskScore: sc.risk, attentionGrowth: n.velocity, priceGrowth: growth3h, createdAt: now },
        });
        out.opportunitiesWritten++;
      }

      if (divergence.label === 'STRONG_POSITIVE') {
        const recent = await db.alert.count({ where: { kind: 'HIGH_ATTENTION_PRICE_DIVERGENCE', refId: t.id, createdAt: { gte: new Date(now.getTime() - 6 * HOUR) } } });
        if (!recent) await alert({ kind: 'HIGH_ATTENTION_PRICE_DIVERGENCE', priority: 'WATCH', title: `${t.symbol}: attention is outpacing price`, body: `${divergence.interpretation} Attention ${Math.round(divergence.attentionGrowthPct!)}%, price ${Math.round(divergence.priceGrowthPct!)}%.`, refType: 'TOKEN', refId: t.id });
      }
    }
  }
  return out;
}
