import { TregError, TREG_ENDPOINTS, type SocialPlatform } from './tregClient';
import { TregNarrativeProvider, type TregTopic } from './tregProvider';
import { mergeTopics } from './topicPacks';

export interface TregConfig {
  topics: TregTopic[]; platforms: SocialPlatform[]; maxPages: number; pageSize: number;
  maxCostUsd: number; intervalMs: number;
}
/** Explicit enablement; a token alone never starts a repeating paid job. */
export function readTregConfig(env: Record<string, string | undefined>): TregConfig | null {
  if (!env.TREG_NARRATIVE_ENABLED || env.TREG_NARRATIVE_ENABLED === 'false') return null;
  if (env.TREG_NARRATIVE_ENABLED !== 'true') throw new TregError('INVALID_TREG_NARRATIVE_ENABLED');
  if (!env.TREG_TOKEN?.trim()) throw new TregError('TREG_TOKEN_REQUIRED');
  // Topics come from named packs (TREG_NARRATIVE_PACKS=trencher,holder), custom JSON (TREG_NARRATIVE_TOPICS), or both.
  const packs = (env.TREG_NARRATIVE_PACKS ?? '').split(',').map(v => v.trim()).filter(Boolean);
  let custom: TregTopic[] = [];
  if (env.TREG_NARRATIVE_TOPICS?.trim() || !packs.length) {
    let parsed: unknown;
    try { parsed = JSON.parse(env.TREG_NARRATIVE_TOPICS ?? ''); } catch { throw new TregError('INVALID_TREG_TOPICS_JSON'); }
    if (!Array.isArray(parsed) || parsed.some(t => !t || typeof t.name !== 'string' || typeof t.query !== 'string')) throw new TregError('INVALID_TREG_TOPICS');
    custom = parsed as TregTopic[];
  }
  let topics: TregTopic[];
  try { topics = mergeTopics(packs, custom); } catch (e) { throw new TregError((e as Error).message); }
  if (!topics.length) throw new TregError('INVALID_TREG_TOPICS');
  const platforms = (env.TREG_NARRATIVE_PLATFORMS ?? 'x,reddit,tiktok').split(',').map(v => v.trim()) as SocialPlatform[];
  if (!platforms.length || platforms.some(p => !Object.hasOwn(TREG_ENDPOINTS, p)) || new Set(platforms).size !== platforms.length) throw new TregError('INVALID_TREG_PLATFORMS');
  const config: TregConfig = { topics, platforms, maxPages: Number(env.TREG_NARRATIVE_MAX_PAGES ?? 1), pageSize: Number(env.TREG_NARRATIVE_PAGE_SIZE ?? 20), maxCostUsd: Number(env.TREG_MAX_COST_USD ?? .01), intervalMs: Number(env.TREG_NARRATIVE_INTERVAL_MS ?? 1_800_000) };
  if (!Number.isFinite(config.maxCostUsd) || config.maxCostUsd < .000001 || config.maxCostUsd > 1) throw new TregError('INVALID_TREG_MAX_COST');
  if (!Number.isInteger(config.intervalMs) || config.intervalMs < 300_000 || config.intervalMs > 86_400_000) throw new TregError('INVALID_TREG_INTERVAL');
  // Validate the complete configuration before a worker opens connections or makes any paid request.
  for (const platform of platforms) new TregNarrativeProvider({ ...config, platform, call: async () => { throw new Error('validation only'); } });
  return config;
}
