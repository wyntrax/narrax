import type { TokenRefKind } from './entities';
import type { MentionPoint } from './types';

/** Starting values for finding tokens from social chatter. None is validated against outcomes. */
export const SOCIAL_RULES = {
  lookbackHours: 48,
  /** Distinct accounts needed before a reference counts. One account posting ten times is not buzz. */
  minCreators: 3,
  minMentions: 4,
  /** New token rows created per run, so spam cannot flood the table. Each must also trade on a real market. */
  maxNewTokensPerRun: 10,
  maxCashtagLookupsPerRun: 30,
  maxRows: 50_000,
  retentionDays: 7,
} as const;

/** The tunable thresholds as plain numbers. `typeof SOCIAL_RULES` has literal types, which stops a caller or a test overriding one. */
export type SocialRules = { [K in keyof typeof SOCIAL_RULES]: number };

export interface BuzzRow {
  refKind: string; ref: string; platform: string; externalId: string; creatorId: string | null;
  creatorAgeDays: number | null; engagement: number; at: Date; simhash: string; textHash: string;
}
export interface BuzzGroup { kind: TokenRefKind; ref: string; points: MentionPoint[]; creators: number }

/** Groups stored rows by reference. Rows with an unknown kind are ignored, and a post counts once per reference. */
export function groupBuzz(rows: readonly BuzzRow[]): BuzzGroup[] {
  const map = new Map<string, { kind: TokenRefKind; ref: string; points: Map<string, MentionPoint> }>();
  for (const r of rows) {
    if (r.refKind !== 'MINT' && r.refKind !== 'CASHTAG') continue;
    const key = `${r.refKind}:${r.ref}`;
    const g = map.get(key) ?? { kind: r.refKind as TokenRefKind, ref: r.ref, points: new Map<string, MentionPoint>() };
    g.points.set(`${r.platform}:${r.externalId}`, { externalId: r.externalId, platform: r.platform, creator: r.creatorId ?? r.externalId, creatorAgeDays: r.creatorAgeDays, engagement: r.engagement, at: r.at, simhash: r.simhash, textHash: r.textHash });
    map.set(key, g);
  }
  return [...map.values()].map((g) => { const points = [...g.points.values()]; return { kind: g.kind, ref: g.ref, points, creators: new Set(points.map((p) => p.creator)).size }; });
}

/** Keeps references with enough distinct accounts and mentions, most creators first. Mints sort before cashtags on a tie. */
export function qualifiedBuzz(groups: readonly BuzzGroup[], rules: SocialRules = SOCIAL_RULES): BuzzGroup[] {
  return groups
    .filter((g) => g.creators >= rules.minCreators && g.points.length >= rules.minMentions)
    .sort((a, b) => b.creators - a.creators || (a.kind === b.kind ? 0 : a.kind === 'MINT' ? -1 : 1) || a.ref.localeCompare(b.ref));
}

/** A post that belongs to a narrative, so its token references can be attributed back to that narrative. */
export interface NarrativePostKey { narrativeId: string; platform: string; externalId: string }

/**
 * Groups each narrative's own token references, so a token people posted about in a narrative's conversation can be
 * linked to that narrative. A reference only counts when it clears `qualifiedBuzz` inside that one narrative: the
 * same accounts, the same thresholds. The same post can belong to two overlapping topics, and then it counts for both.
 * Pure: the caller supplies the stored mention rows. Nothing here reads the raw post text.
 */
export function groupBuzzByNarrative(narratives: readonly NarrativePostKey[], rows: readonly BuzzRow[], rules: SocialRules = SOCIAL_RULES): Map<string, BuzzGroup[]> {
  const postsToNarratives = new Map<string, Set<string>>();
  for (const n of narratives) {
    const key = `${n.platform}\u0000${n.externalId}`;
    const set = postsToNarratives.get(key) ?? new Set<string>();
    if (!postsToNarratives.has(key)) postsToNarratives.set(key, set);
    set.add(n.narrativeId);
  }
  const byNarrative = new Map<string, BuzzRow[]>();
  for (const r of rows) {
    const ids = postsToNarratives.get(`${r.platform}\u0000${r.externalId}`);
    if (!ids) continue;
    for (const id of ids) {
      const list = byNarrative.get(id) ?? [];
      if (!byNarrative.has(id)) byNarrative.set(id, list);
      list.push(r);
    }
  }
  const out = new Map<string, BuzzGroup[]>();
  for (const [id, list] of byNarrative) {
    const groups = qualifiedBuzz(groupBuzz(list), rules);
    if (groups.length) out.set(id, groups);
  }
  return out;
}
