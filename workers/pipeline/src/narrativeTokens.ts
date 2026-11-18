import type { PrismaClient } from '@narra/database';
import { SOCIAL_RULES, groupBuzzByNarrative } from '@narra/narrative';
import { WSOL_MINT } from '@narra/market-data';
import { matchScore, resolveCandidates, type Candidate } from '@narra/token-intel';
import { resolveUniqueCashtags } from './cashtagLookup';

export interface MentionTokenSummary {
  narrativesChecked: number;
  referencesQualified: number;
  tokensResolved: number;
  relationsCreated: number;
  relationsUpdated: number;
  unresolvedMints: number;
  ambiguousCashtags: number;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// Mentions are pruned after SOCIAL_RULES.retentionDays, so this is the widest window that can still link anything.
const LOOKBACK_HOURS = SOCIAL_RULES.retentionDays * 24;
// A mint address names exactly one token, so a post that carries it is direct evidence. A cashtag is weak: anyone can
// launch a token with any symbol, so it only counts when exactly one live token carries that symbol (the same rule the
// early-radar social scan uses). A weaker reference never overwrites a stronger existing relation for the same token.
const MINT_MATCH = 0.9;
const CASHTAG_MATCH = 0.6;
const CASHTAG_METRIC_WINDOW_MS = 24 * HOUR;
/**
 * Linking a token to a narrative is not a trade signal, so the bar is lower than the early-radar buzz rule but still
 * above one: a single account posting a mint is not evidence, two different accounts naming it in the same
 * conversation is. This only decides which references to consider; a cashtag still has to resolve to exactly one token.
 */
const ATTRIBUTION_RULES = { ...SOCIAL_RULES, minCreators: 2, minMentions: 2 } as const;

/**
 * Links a narrative to the tokens its own conversation names. Reads the stored token references (mints and $TICKERS)
 * attributed to that narrative's posts, resolves them to existing tokens, scores them the same way the name-matching
 * resolver does, and upserts the relation so the narrative detail page can show related tokens.
 *
 * Safety: research only. It reads and writes relations; it has no access to orders, positions or execution, and it
 * never creates a token row (the social scan does that, after a market source confirms a mint trades). It only adds
 * evidence a relation was missing; an existing relation with a stronger match score is left untouched.
 */
export async function attributeNarrativeMentions(db: PrismaClient, now: Date = new Date()): Promise<MentionTokenSummary> {
  const out: MentionTokenSummary = { narrativesChecked: 0, referencesQualified: 0, tokensResolved: 0, relationsCreated: 0, relationsUpdated: 0, unresolvedMints: 0, ambiguousCashtags: 0 };
  const since = new Date(now.getTime() - LOOKBACK_HOURS * HOUR);
  const cashtagSince = new Date(now.getTime() - CASHTAG_METRIC_WINDOW_MS);

  const narratives = await db.narrative.findMany({ where: { stage: { not: 'DEAD' } }, select: { id: true, name: true, firstDetectedAt: true } });
  if (!narratives.length) return out;
  const byId = new Map(narratives.map((n) => [n.id, n]));

  const [posts, mentions] = await Promise.all([
    db.narrativeMention.findMany({ where: { at: { gte: since, lte: now } }, select: { narrativeId: true, platform: true, externalId: true }, take: SOCIAL_RULES.maxRows }),
    db.tokenMention.findMany({ where: { at: { gte: since, lte: now } }, orderBy: { at: 'desc' }, take: SOCIAL_RULES.maxRows }),
  ]);
  const grouped = groupBuzzByNarrative(posts, mentions, ATTRIBUTION_RULES);
  for (const groups of grouped.values()) out.referencesQualified += groups.length;

  const allMints = new Set<string>();
  const allCashtags = new Set<string>();
  for (const [narrativeId, groups] of grouped) {
    if (!byId.has(narrativeId)) continue;
    for (const g of groups) {
      if (g.kind === 'MINT') { if (g.ref !== WSOL_MINT) allMints.add(g.ref); }
      else allCashtags.add(g.ref);
    }
  }
  const mintTokens = allMints.size
    ? await db.token.findMany({
        where: { mint: { in: [...allMints] } },
        select: { id: true, mint: true, symbol: true, name: true, createdOnChainAt: true, deployer: true, blacklisted: true, holders: { orderBy: { at: 'desc' }, take: 1, select: { top10Pct: true, devHoldingPct: true } } },
      })
    : [];
  const byMint = new Map(mintTokens.map((t) => [t.mint, t]));
  const cashtagMatches = await resolveUniqueCashtags(db, [...allCashtags], cashtagSince);
  const cashtagIds = [...new Set([...cashtagMatches.values()].flatMap((t) => (t ? [t.id] : [])))];
  const cashtagHolders = cashtagIds.length && typeof db.tokenHolderMetric?.findMany === 'function'
    ? await db.tokenHolderMetric.findMany({
        where: { tokenId: { in: cashtagIds } },
        distinct: ['tokenId'],
        orderBy: [{ tokenId: 'asc' }, { at: 'desc' }],
        select: { tokenId: true, top10Pct: true, devHoldingPct: true },
      })
    : [];
  const holderByTokenId = new Map(cashtagHolders.map((h) => [h.tokenId, h]));

  for (const [narrativeId, groups] of grouped) {
    const n = byId.get(narrativeId);
    if (!n) continue;
    out.narrativesChecked++;

    // Resolve each qualified reference to an existing token. A mint by its address; a cashtag only when it is unambiguous.
    // When a mint and a cashtag name the same token, the stronger (mint) evidence wins.
    type Resolved = { symbol: string; name: string; createdAt: Date | null; deployer: string | null; top10Pct: number | null; devHoldingPct: number | null; match: number };
    const tokens = new Map<string, Resolved>();
    const add = (id: string, t: Omit<Resolved, 'match'>, match: number) => {
      const existing = tokens.get(id);
      if (existing) existing.match = Math.max(existing.match, match);
      else tokens.set(id, { ...t, match });
    };
    for (const g of groups) {
      if (g.kind === 'MINT') {
        if (g.ref === WSOL_MINT) continue;
        const t = byMint.get(g.ref);
        if (!t || t.blacklisted) { out.unresolvedMints++; continue; }
        add(t.id, { symbol: t.symbol, name: t.name, createdAt: t.createdOnChainAt, deployer: t.deployer, top10Pct: t.holders[0]?.top10Pct ?? null, devHoldingPct: t.holders[0]?.devHoldingPct ?? null }, MINT_MATCH);
      } else {
        const t = cashtagMatches.get(g.ref.toUpperCase()) ?? null;
        if (!t) { out.ambiguousCashtags++; continue; }
        const h = holderByTokenId.get(t.id);
        add(t.id, { symbol: t.symbol, name: t.name, createdAt: t.createdOnChainAt, deployer: t.deployer, top10Pct: h?.top10Pct ?? null, devHoldingPct: h?.devHoldingPct ?? null }, CASHTAG_MATCH);
      }
    }
    if (!tokens.size) continue;
    out.tokensResolved += tokens.size;

    const candidates: Candidate[] = [];
    for (const [tokenId, t] of tokens) {
      let deployerRecent: number | null = null;
      if (t.deployer && t.createdAt) {
        deployerRecent = await db.token.count({ where: { deployer: t.deployer, id: { not: tokenId }, createdOnChainAt: { gte: new Date(t.createdAt.getTime() - 7 * DAY), lte: new Date(t.createdAt.getTime() + 7 * DAY) } } });
      }
      candidates.push({ id: tokenId, symbol: t.symbol, createdAt: t.createdAt, deployer: t.deployer, matchScore: t.match, top10Pct: t.top10Pct, devHoldingPct: t.devHoldingPct, deployerRecentTokens: deployerRecent });
    }
    const og = resolveCandidates({ firstDetectedAt: n.firstDetectedAt }, candidates);

    const existing = await db.narrativeTokenRelation.findMany({ where: { narrativeId, tokenId: { in: [...tokens.keys()] } }, select: { tokenId: true, matchScore: true } });
    const existingScore = new Map(existing.map((e) => [e.tokenId, e.matchScore]));

    for (const [tokenId, t] of tokens) {
      const r = og.get(tokenId)!;
      const score = Math.max(matchScore(n.name, { symbol: t.symbol, name: t.name }), t.match);
      const previous = existingScore.get(tokenId);
      if (previous != null && previous >= score) continue; // never downgrade a stronger relation another pass established
      const data = { relation: r.relation, ogScore: r.ogScore, confidence: r.confidence, matchScore: score };
      if (previous == null) {
        await db.narrativeTokenRelation.create({ data: { narrativeId, tokenId, ...data } });
        out.relationsCreated++;
      } else {
        await db.narrativeTokenRelation.update({ where: { narrativeId_tokenId: { narrativeId, tokenId } }, data });
        out.relationsUpdated++;
      }
    }
    // A narrative that now has a linked token no longer has "no token yet". Clear that stale watch alert.
    await db.alert.deleteMany({ where: { kind: 'NO_TOKEN_YET', refType: 'NARRATIVE', refId: narrativeId } });
  }
  return out;
}
