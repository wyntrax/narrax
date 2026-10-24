import type { PrismaClient } from '@narra/database';
import { sanitizeUntrusted } from '@narra/shared';
import { SOCIAL_RULES, computeNarrativeMetrics, groupBuzz, qualifiedBuzz, type BuzzGroup } from '@narra/narrative';
import { EARLY_RULES, RADAR_EVIDENCE_LIMITS, attentionPriceDivergence, evaluateEarlyBoth, isRadarEvidenceCandidate, radarEvidenceIssue, recordRadarEvidenceSkip, type RadarEvidenceSkips } from '@narra/token-intel';
import { WSOL_MINT, type MarketQuoteSource } from '@narra/market-data';
import { createEarlyRadarAlert } from './earlyRadarTracking';
import type { RadarSafetyEvidence, RadarSafetySource } from './radarSafetyEvidence';
import type { TradeabilityEvidence, TradeabilitySource } from './tradeabilityEvidence';
import { storeMarketSnapshot } from './marketSnapshot';
import { COVERAGE_LIMITS, saveSocialPriority, saveResearchDiagnostics } from './researchDiagnostics';

export interface SocialScanSummary {
  rowsRead: number;
  groupsQualified: number;
  tokensCreated: number;
  metricsWritten: number;
  /** Mints people posted that no market source knows (new, no pool, or a pool address). Nothing is created for these. */
  mintsUnverified: number;
  cashtagsResolved: number;
  /** Cashtags with zero or several matching tokens. Left out on purpose: a symbol alone cannot name one token. */
  cashtagsAmbiguous: number;
  tokensEvaluated: number;
  tokensResolved: number;
  holderPriorityCandidates: number;
  holderPriorityOmitted: number;
  earlyCandidates: number;
  evidenceSkipped: RadarEvidenceSkips;
  alerts: number;
  safetyPass: number;
  safetyUnknown: number;
  safetyBlocked: number;
  pruned: number;
  errors: string[];
}

const HOUR = 3_600_000;
/** Bound for the per-scan quote top-up. The market job's 150-token rotation also serves launches, discovery and narratives. */
const MAX_EVIDENCE_QUOTES_PER_RUN = 60;
const QUOTE_BATCH = 30;
const num = (v: { toString(): string } | null | undefined) => (v == null ? null : Number(v.toString()));

/**
 * Finds small tokens from social chatter instead of from a narrative's name. Reads the stored token references
 * (mints and $TICKERS counted by ingestion), keeps those posted by enough distinct accounts, resolves them to
 * tokens, and runs the early radar on them with the chatter's own attention score.
 *
 * Safety: research only. It writes token rows, alerts and prunes old mentions. It has no access to orders,
 * positions or execution. Social text is attacker-controlled, so a new token row is created only when a real
 * market source confirms the mint trades and is under the early market cap ceiling, at most a few per run.
 * A cashtag resolves only when exactly one known token carries that symbol. Anything else is skipped, not guessed.
 */
export async function scanSocialTokens(db: PrismaClient, deps: { quotes: MarketQuoteSource | null; safety?: RadarSafetySource | null; tradeability?: TradeabilitySource | null }, at?: Date): Promise<SocialScanSummary> {
  const now=at??new Date();
  deps.safety?.begin();
  deps.tradeability?.begin();
  const R = SOCIAL_RULES;
  const out: SocialScanSummary = { rowsRead: 0, groupsQualified: 0, tokensCreated: 0, metricsWritten: 0, mintsUnverified: 0, cashtagsResolved: 0, cashtagsAmbiguous: 0, tokensEvaluated: 0, tokensResolved: 0, holderPriorityCandidates: 0, holderPriorityOmitted: 0, earlyCandidates: 0, evidenceSkipped: {}, alerts: 0, safetyPass: 0, safetyUnknown: 0, safetyBlocked: 0, pruned: 0, errors: [] };
  const priorityIds: string[] = [];
  const finish = async () => {
    out.holderPriorityCandidates = Math.min(priorityIds.length, COVERAGE_LIMITS.maxCandidates);
    out.holderPriorityOmitted = Math.max(0, priorityIds.length - COVERAGE_LIMITS.maxCandidates);
    await saveSocialPriority(db, priorityIds, now);
    await saveResearchDiagnostics(db, 'social', now, out);
    return out;
  };

  out.pruned = (await db.tokenMention.deleteMany({ where: { at: { lt: new Date(now.getTime() - R.retentionDays * 24 * HOUR) } } })).count;

  const since = new Date(now.getTime() - R.lookbackHours * HOUR);
  const rows = await db.tokenMention.findMany({ where: { at: { gte: since, lte: now } }, orderBy: { at: 'desc' }, take: R.maxRows });
  out.rowsRead = rows.length;
  const groups = qualifiedBuzz(groupBuzz(rows), R);
  out.groupsQualified = groups.length;
  if (!groups.length) return finish();

  // 1. Resolve each qualified reference to a token id. A mint wins over a cashtag for the same token.
  const resolved = new Map<string, { group: BuzzGroup; via: 'MINT' | 'CASHTAG' }>();
  const unknownMints: BuzzGroup[] = [];
  let cashtagLookups = 0;
  for (const g of groups) {
    if (g.kind === 'MINT') {
      if (g.ref === WSOL_MINT) continue;
      const t = await db.token.findUnique({ where: { mint: g.ref }, select: { id: true, blacklisted: true } });
      if (t?.blacklisted) continue;
      if (t) resolved.set(t.id, { group: g, via: 'MINT' }); else unknownMints.push(g);
    } else {
      if (cashtagLookups++ >= R.maxCashtagLookupsPerRun) continue;
      const matches = await db.token.findMany({
        where: { symbol: { equals: g.ref, mode: 'insensitive' }, blacklisted: false, metrics: { some: { at: { gte: new Date(now.getTime() - 24 * HOUR) } } } },
        select: { id: true }, take: 2,
      });
      if (matches.length !== 1) { out.cashtagsAmbiguous++; continue; }
      out.cashtagsResolved++;
      if (!resolved.has(matches[0]!.id)) resolved.set(matches[0]!.id, { group: g, via: 'CASHTAG' });
    }
  }

  // 1b. A mentioned token can be older than the 15-minute publication gate when the market job's
  // rotating 150-token set did not reach it. Refresh only the exact price rows this scan is about
  // to evaluate, from the same quote source and within a fixed bound. Holders are still collected
  // by the paced info loop, and the evidence gate below remains the only thing that decides.
  if (deps.quotes && resolved.size) {
    const ids = [...resolved.keys()];
    const latest = await db.tokenMetric.findMany({
      where: { tokenId: { in: ids } },
      orderBy: [{ tokenId: 'asc' }, { at: 'desc' }],
      distinct: ['tokenId'],
      select: { tokenId: true, at: true, marketCapUsd: true },
    });
    const latestBy = new Map(latest.map((m) => [m.tokenId, m]));
    const cutoff = now.getTime() - RADAR_EVIDENCE_LIMITS.marketMaxAgeMs;
    const stale = ids.filter((id) => {
      const m = latestBy.get(id);
      if (m && +m.at >= cutoff) return false;
      const cap = num(m?.marketCapUsd);
      return cap == null || cap < EARLY_RULES.maxMarketCapUsd;
    }).slice(0, MAX_EVIDENCE_QUOTES_PER_RUN);
    if (stale.length) {
      const tokens = await db.token.findMany({ where: { id: { in: stale } }, select: { id: true, mint: true } });
      for (let i = 0; i < tokens.length; i += QUOTE_BATCH) {
        const batch = tokens.slice(i, i + QUOTE_BATCH);
        let snaps: Awaited<ReturnType<MarketQuoteSource['getSnapshots']>>;
        try { snaps = await deps.quotes.getSnapshots(batch.map((t) => t.mint)); }
        catch (e) { out.errors.push(`evidence quotes: ${(e as Error).message}`.slice(0, 200)); break; }
        for (const token of batch) {
          const s = snaps.get(token.mint);
          if (!s || s.mint !== token.mint) continue;
          await db.$transaction((tx) => storeMarketSnapshot(tx, token.id, s, deps.quotes!.name, now));
          out.metricsWritten++;
        }
      }
    }
  }

  // 2. Unknown mints become tokens only after a market source confirms they trade and are small enough to matter here.
  if (unknownMints.length && deps.quotes) {
    const wanted = unknownMints.slice(0, R.maxNewTokensPerRun * 3);
    let snaps: Awaited<ReturnType<MarketQuoteSource['getSnapshots']>> = new Map();
    try { snaps = await deps.quotes.getSnapshots(wanted.map((g) => g.ref)); } catch (e) { out.errors.push(`quotes: ${(e as Error).message}`.slice(0, 200)); }
    for (const g of wanted) {
      const s = snaps.get(g.ref);
      if (!s || s.mint !== g.ref || !(s.marketCapUsd < EARLY_RULES.maxMarketCapUsd)) { out.mintsUnverified++; continue; }
      if (out.tokensCreated >= R.maxNewTokensPerRun) break;
      try {
        const symbol = sanitizeUntrusted(s.symbol, 32), name = sanitizeUntrusted(s.name, 64);
        // Retain the quote that verified this mint. Without it a named token with no
        // narrative/wallet link never entered the normal active-price refresh set.
        const t = await db.$transaction(async tx => {
          const token = await tx.token.create({ data: { mint: g.ref, symbol: symbol || 'UNKNOWN', name: name || 'Unknown', createdOnChainAt: s.pairCreatedAt }, select: { id: true } });
          await storeMarketSnapshot(tx, token.id, s, deps.quotes!.name, now);
          return token;
        });
        out.tokensCreated++;
        out.metricsWritten++;
        resolved.set(t.id, { group: g, via: 'MINT' });
      } catch (e) { out.errors.push(`create ${g.ref.slice(0, 6)}: ${(e as Error).message}`.slice(0, 200)); }
    }
  } else out.mintsUnverified += unknownMints.length;

  // 3. Score each resolved token. A token without a stored price or holder row is skipped until market data fills it in.
  out.tokensResolved = resolved.size;
  for (const [tokenId, { group, via }] of resolved) {
    const t = await db.token.findUnique({
      where: { id: tokenId },
      include: { metrics: { orderBy: { at: 'desc' }, take: 1 }, holders: { orderBy: { at: 'desc' }, take: 1 }, risk: { orderBy: { at: 'desc' }, take: 1 } },
    });
    const m = t?.metrics[0], h = t?.holders[0];
    if (!t || t.blacklisted) continue;
    const marketCapUsd = num(m?.marketCapUsd);
    // Qualified buzz + a recorded small-token quote schedules a lookup, never an alert.
    // Stale/missing holders must reach collection even when the evidence gate skips scoring.
    if (m && +m.at <= +now && isRadarEvidenceCandidate(marketCapUsd, 'UNKNOWN')) priorityIds.push(tokenId);
    // Only a token under the early ceiling is a withheld radar call; larger tokens
    // never reach this lane and a missing price is reported by the market job.
    const issue = m != null && isRadarEvidenceCandidate(marketCapUsd, 'UNKNOWN') ? radarEvidenceIssue({at:m.at,priceUsd:num(m.priceUsd)},h,now) : null;
    if (issue) { recordRadarEvidenceSkip(out.evidenceSkipped,issue); continue; }
    if (!m || !h) continue;
    if (marketCapUsd == null || marketCapUsd >= EARLY_RULES.maxMarketCapUsd) continue;
    out.tokensEvaluated++;

    const liquidityUsd = num(m.liquidityUsd) ?? NaN;
    const price = num(m.priceUsd) ?? 0;
    const priceAt = async (hoursAgo: number) => num((await db.tokenMetric.findFirst({ where: { tokenId, at: { lte: new Date(now.getTime() - hoursAgo * HOUR) } }, orderBy: { at: 'desc' }, select: { priceUsd: true } }))?.priceUsd);
    const [p1, p3] = await Promise.all([priceAt(1), priceAt(3)]);
    const growth = (then: number | null) => (then && then > 0 ? (price / then - 1) * 100 : null);
    const growth1h = growth(p1), growth3h = growth(p3);
    const thenRow = await db.tokenHolderMetric.findFirst({ where: { tokenId, at: { lte: new Date(now.getTime() - 3 * HOUR) } }, orderBy: { at: 'desc' }, select: { holders: true } });

    // The chatter about this one token is scored like a narrative: velocity, organic quality (copy-paste and burst checks) and stage.
    const c = computeNarrativeMetrics(group.points, now);
    const divergence = attentionPriceDivergence(c.mentionVelocity, growth3h);
    const earlyInput = (devHoldingPct: number | null) => evaluateEarlyBoth({
      marketCapUsd, liquidityUsd, volume24hUsd: num(m.volume24hUsd) ?? NaN, holders: h.holders, holdersThen: thenRow?.holders ?? null,
      top10Pct: h.top10Pct, devHoldingPct, smartWalletHolders: h.smartWalletHolders,
      tokenAgeMinutes: t.createdOnChainAt ? (now.getTime() - t.createdOnChainAt.getTime()) / 60_000 : null,
      relation: 'UNKNOWN', ogScore: null, symbolOnlyMatch: via === 'CASHTAG', narrativeScore: c.score, narrativeStage: c.stage,
      narrativeManipulationRisk: c.organicKnown ? c.manipulationRisk : null, divergence: divergence.label, priceGrowth1hPct: growth1h,
      riskFlags: t.risk[0]?.flags ?? [],
    });
    const early = earlyInput(h.devHoldingPct ?? null);
    let safetyEvidence: RadarSafetyEvidence | null = null;
    let tradeability: TradeabilityEvidence | null = null;
    // Preserve scoring inputs; enrichment is used only by the separate safety gate.
    if ([early.trencher, early.holder].some(e => e.eligible && (e.tier === 'WATCH' || e.tier === 'STRONG'))) {
      if (deps.safety) safetyEvidence = await deps.safety.get(t.mint, at);
      if (deps.tradeability) tradeability = await deps.tradeability.get(t.mint, at);
    }
    const safetyContext = {
      priceGrowth1hPct: growth1h, priceGrowth3hPct: growth3h,
      narrativeManipulationRisk: c.organicKnown ? c.manipulationRisk : null,
      ...(safetyEvidence ?? {}),
      ...(tradeability ? {priceImpactPct: tradeability.priceImpactPct, tradeabilityAt: tradeability.sourceAt,tradeability} : {}),
    };

    let counted = false;
    for (const profile of ['trencher', 'holder'] as const) {
      const e = early[profile];
      if (!e.eligible || (e.tier !== 'WATCH' && e.tier !== 'STRONG')) continue;
      counted = true;
      const kind = profile === 'trencher' ? 'EARLY_RADAR_TRENCHER' : 'EARLY_RADAR_HOLDER';
      // Shared with the narrative path: one alert per token per profile per 6 hours, whichever route found it.
      if (await db.alert.count({ where: { kind, refId: tokenId, createdAt: { gte: new Date(now.getTime() - 6 * HOUR) } } })) continue;
      const k = (v: number) => `$${Math.round(v / 1000)}K`;
      const created=await createEarlyRadarAlert(db,{
        tokenId,mint:t.mint,profile,tier:e.tier,route:'SOCIAL',matchKind:via==='MINT'?'MINT':'TICKER_ONLY',score:e.score,metricId:m.id,holderMetricId:h.id,
        safetyContext,
        title: `${t.symbol}: early ${profile} candidate from social buzz (${k(marketCapUsd)} cap)`,
        body: `${profile} score ${e.score} (${e.tier.toLowerCase()}). ${group.creators} accounts, ${group.points.length} posts named it in ${R.lookbackHours}h, found by ${via === 'MINT' ? 'mint address' : 'ticker only, so a copycat is possible'}. Market cap ${k(marketCapUsd)}, liquidity ${k(liquidityUsd)}, ${h.holders} holders, top 10 hold ${Math.round(h.top10Pct)}% (reported; may include the pool)${e.flags.length ? `. Cautions: ${e.flags.join(', ')}` : ''}. Research signal only, not a prediction or a recommendation to buy.`,
      },at);
      if(created.safety?.status==='PASS')out.safetyPass++;
      else if(created.safety?.status==='UNKNOWN')out.safetyUnknown++;
      else if(created.safety?.status==='BLOCK')out.safetyBlocked++;
      if(created.created)out.alerts++;
      else if(created.reason!=='DUPLICATE'&&created.reason!=='SAFETY_BLOCKED')recordRadarEvidenceSkip(out.evidenceSkipped,created.reason);
    }
    if (counted) out.earlyCandidates++;
  }
  return finish();
}
