import type { PrismaClient } from '@narra/database';
import { createEarlyRadarAlert } from './earlyRadarTracking';
import type { RadarSafetyEvidence, RadarSafetySource } from './radarSafetyEvidence';
import type { TradeabilityEvidence, TradeabilitySource } from './tradeabilityEvidence';
import { socialOpportunityEvidence } from './socialOpportunity';
import { saveResearchDiagnostics } from './researchDiagnostics';
import {holderGrowthBaseline} from './holderHistory';
import {
  EARLY_RULES, MATCH_THRESHOLD, attentionPriceDivergence, evaluateEarlyBoth, matchScore, meetsFloors, opportunityScore, resolveCandidates, words,
  type Candidate, isRadarEvidenceCandidate, radarEvidenceIssue, recordRadarEvidenceSkip, type RadarEvidenceSkips,
} from '@narra/token-intel';

export interface ResolveSummary {
  narrativesChecked: number;
  candidates: number;
  newCandidates: number;
  opportunitiesWritten: number;
  noTokenYet: number;
  alerts: number;
  /** Small tokens (under the early market cap ceiling) that passed an early-radar profile. Research only. */
  earlyCandidates: number;
  evidenceSkipped: RadarEvidenceSkips;
  radarAlerts: number;
  /** Safety shadow/enforcement outcomes. Counts one per evaluated candidate/profile. */
  safetyPass: number;
  safetyUnknown: number;
  safetyBlocked: number;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const num = (v: { toString(): string } | null | undefined) => (v == null ? null : Number(v.toString()));

/**
 * Finds token candidates for each live narrative, scores how likely each is the original, and ranks the ones
 * that pass liquidity and holder floors. This job only reads market data and writes research rows and alerts.
 * It has no access to orders, positions or execution, so a matching ticker can never trigger a buy.
 */
export async function resolveTokens(db: PrismaClient, at?: Date, deps: { safety?: RadarSafetySource | null; tradeability?: TradeabilitySource | null } = {}): Promise<ResolveSummary> {
  const now=at??new Date();
  deps.safety?.begin();
  deps.tradeability?.begin();
  const out: ResolveSummary = { narrativesChecked: 0, candidates: 0, newCandidates: 0, opportunitiesWritten: 0, noTokenYet: 0, alerts: 0, radarAlerts: 0, earlyCandidates: 0, evidenceSkipped: {}, safetyPass: 0, safetyUnknown: 0, safetyBlocked: 0 };
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

    // A related-token link alone is not opportunity evidence. Non-name matches
    // need independent, sufficiently sampled organic social attribution.
    const links = await db.narrativeTokenRelation.findMany({ where: { narrativeId: n.id }, select: { tokenId: true, matchScore: true } });
    const seen = new Set(matched.map((x) => x.t.id));
    const linkIds = links.map((l) => l.tokenId).filter((id) => !seen.has(id));
    if (linkIds.length) {
      const linked = await db.token.findMany({
        where: { id: { in: linkIds }, blacklisted: false },
        include: { metrics: { orderBy: { at: 'desc' }, take: 1 }, holders: { orderBy: { at: 'desc' }, take: 1 }, consensus: { orderBy: { at: 'desc' }, take: 1 }, risk: { orderBy: { at: 'desc' }, take: 1 } },
      });
      const score = new Map(links.map((l) => [l.tokenId, l.matchScore]));
      const social=await socialOpportunityEvidence(db,n.id,linked.filter(t=>matchScore(n.name,t)<MATCH_THRESHOLD),now);
      for (const t of linked) {
        if(matchScore(n.name,t)<MATCH_THRESHOLD&&!social.has(t.id))continue;
        matched.push({ t, match: score.get(t.id) ?? MATCH_THRESHOLD });
      }
    }

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
      const marketCapUsd = num(m?.marketCapUsd);
      // Count only tokens that actually reach the early-lane screen. A token with no
      // metric or above the ceiling is not a withheld radar call, and is reported elsewhere.
      const evidenceIssue = m != null && isRadarEvidenceCandidate(marketCapUsd, r.relation) ? radarEvidenceIssue({at:m.at,priceUsd:num(m.priceUsd)},h,now) : null;
      if (evidenceIssue) recordRadarEvidenceSkip(out.evidenceSkipped,evidenceIssue);
      if (!m || !h || r.relation === 'SUSPICIOUS') continue;
      // A confirmed honeypot is never ranked, whatever its narrative score. Other risk flags only lower the score.
      if (t.risk[0]?.flags.includes('HONEYPOT')) continue;
      const liquidityUsd = num(m.liquidityUsd) ?? 0;

      const price = num(m.priceUsd) ?? 0;
      const priceAt = async (hoursAgo: number) => {
        const row = await db.tokenMetric.findFirst({ where: { tokenId: t.id, at: { lte: new Date(now.getTime() - hoursAgo * HOUR) } }, orderBy: { at: 'desc' }, select: { priceUsd: true } });
        return num(row?.priceUsd);
      };
      const [p1, p3] = await Promise.all([priceAt(1), priceAt(3)]);
      const growth = (then: number | null) => (then && then > 0 ? (price / then - 1) * 100 : null);
      const growth1h = growth(p1), growth3h = growth(p3);

      const divergence = attentionPriceDivergence(n.velocity, growth3h);

      // Early radar lane (research only): small tokens under the market cap ceiling are judged on their own floors,
      // because the main opportunity floors (20K liquidity, 50 holders) would hide most of them. It writes alerts, never
      // opportunities, orders or decisions, so the trading path and its floors are unchanged.
      // marketCapUsd was computed above, before the evidence check, so the skip report and the lane agree on the ceiling.
      if (!evidenceIssue && marketCapUsd != null && marketCapUsd < EARLY_RULES.maxMarketCapUsd) {
        const holdersThen = await holderGrowthBaseline(db,t.id,h.id,new Date(now.getTime()-3*HOUR));
        const earlyInput = (devHoldingPct: number | null) => evaluateEarlyBoth({
          marketCapUsd, liquidityUsd, volume24hUsd: num(m.volume24hUsd) ?? NaN, holders: h.holders, holdersThen,
          top10Pct: h.top10Pct, devHoldingPct, smartWalletHolders: h.smartWalletHolders, tokenAgeMinutes: t.createdOnChainAt ? (now.getTime() - t.createdOnChainAt.getTime()) / 60_000 : null,
          relation: r.relation, ogScore: r.ogScore, narrativeScore: n.score, narrativeStage: n.stage, narrativeManipulationRisk: n.metrics[0]?.manipulationRisk ?? null,
          divergence: divergence.label, priceGrowth1hPct: growth1h, riskFlags: t.risk[0]?.flags ?? [],
        });
        const early = earlyInput(h.devHoldingPct ?? null);
        let safetyEvidence: RadarSafetyEvidence | null = null;
        let tradeability: TradeabilityEvidence | null = null;
        // Enrich publication candidates for the separate safety gate; preserve the attention score and its inputs.
        if ([early.trencher, early.holder].some(e => e.eligible && (e.tier === 'WATCH' || e.tier === 'STRONG'))) {
          if (deps.safety) safetyEvidence = await deps.safety.get(t.mint, at);
          if (deps.tradeability) tradeability = await deps.tradeability.get(t.mint, at);
        }
        const safetyContext = {
          priceGrowth1hPct: growth1h, priceGrowth3hPct: growth3h,
          narrativeManipulationRisk: n.metrics[0]?.manipulationRisk ?? null,
          ...(safetyEvidence ?? {}),
          ...(tradeability ? {priceImpactPct: tradeability.priceImpactPct, tradeabilityAt: tradeability.sourceAt,tradeability} : {}),
        };
        let counted = false;
        for (const profile of ['trencher', 'holder'] as const) {
          const e = early[profile];
          if (!e.eligible || (e.tier !== 'WATCH' && e.tier !== 'STRONG')) continue;
          counted = true;
          const kind = profile === 'trencher' ? 'EARLY_RADAR_TRENCHER' : 'EARLY_RADAR_HOLDER';
          const recent = await db.alert.count({ where: { kind, refId: t.id, createdAt: { gte: new Date(now.getTime() - 6 * HOUR) } } });
          if (recent) continue;
          const k = (v: number) => `$${Math.round(v / 1000)}K`;
          const created=await createEarlyRadarAlert(db,{
            tokenId:t.id,mint:t.mint,profile,tier:e.tier,route:'NARRATIVE',matchKind:'NAME',score:e.score,metricId:m.id,holderMetricId:h.id,
            safetyContext,
            title: `${t.symbol}: early ${profile} candidate for ${n.name} (${k(marketCapUsd)} cap)`,
            body: `${profile} score ${e.score} (${e.tier.toLowerCase()}). Market cap ${k(marketCapUsd)}, liquidity ${k(liquidityUsd)}, ${h.holders} holders, top 10 hold ${Math.round(h.top10Pct)}% (reported; may include the pool), narrative ${n.stage.toLowerCase()}${e.flags.length ? `. Cautions: ${e.flags.join(', ')}` : ''}. Research signal only, not a prediction or a recommendation to buy.`,
          },at);
          if(created.safety?.status==='PASS')out.safetyPass++;
          else if(created.safety?.status==='UNKNOWN')out.safetyUnknown++;
          else if(created.safety?.status==='BLOCK')out.safetyBlocked++;
          if(created.created){out.alerts++;out.radarAlerts++;}
          else if(created.reason!=='DUPLICATE'&&created.reason!=='SAFETY_BLOCKED')recordRadarEvidenceSkip(out.evidenceSkipped,created.reason);
        }
        if (counted) out.earlyCandidates++;
      }

      // Ranking needs real liquidity and holders. Until then it stays a watched candidate (or an early-radar alert above).
      if (!meetsFloors({ liquidityUsd, holders: h.holders, relation: r.relation })) continue;
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
  await saveResearchDiagnostics(db, 'narrative', now, out);
  return out;
}
