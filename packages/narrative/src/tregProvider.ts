import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { normalizeTopic } from './normalize';
import type { NarrativeProvider, RawMention, TrendingTopic } from './types';
import { TREG_ENDPOINTS, TregError, type SocialPlatform, type TregCall } from './tregClient';

export interface TregTopic { name: string; query: string; }
export interface TregPage {
  mentions: RawMention[]; nextCursor: string | null; received: number; invalid: number; outsideWindow: number;
}
const object = (value: unknown): Record<string, unknown> | null => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown, max: number) => typeof value === 'string' && value.trim().length > 0 && value.length <= max ? value : null;
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const DataSchema = z.object({ nextCursor: z.string().max(8000).nullish() });
const PageSchemas = {
  x: z.object({ output: z.object({ found: z.boolean().optional(), data: DataSchema.extend({ items: z.array(z.unknown()).max(1000) }) }) }),
  reddit: z.object({ output: z.object({ found: z.boolean().optional(), data: DataSchema.extend({ posts: z.array(z.unknown()).max(1000) }) }) }),
  tiktok: z.object({ output: z.object({ found: z.boolean().optional(), data: DataSchema.extend({ videos: z.array(z.unknown()).max(1000) }) }) }),
};

/** Provider-specific AnyAPI contracts, confirmed against Treg catalog examples. Unknown envelopes fail closed. */
export function parseTregPage(platform: SocialPlatform, value: unknown, since: Date, until: Date): TregPage {
  const parsed = PageSchemas[platform].safeParse(value);
  if (!parsed.success) throw new TregError('TREG_INVALID_RESPONSE');
  const output = parsed.data.output, data = object(output.data);
  const rows = data?.[platform === 'x' ? 'items' : platform === 'reddit' ? 'posts' : 'videos'];
  if (!Array.isArray(rows) || rows.length > 1000 || (output?.found !== undefined && typeof output.found !== 'boolean')) throw new TregError('TREG_INVALID_RESPONSE');
  if (data?.nextCursor != null && (typeof data.nextCursor !== 'string' || data.nextCursor.length > 8000)) throw new TregError('TREG_INVALID_CURSOR');
  const page: TregPage = { mentions: [], nextCursor: typeof data?.nextCursor === 'string' && data.nextCursor ? data.nextCursor : null, received: rows.length, invalid: 0, outsideWindow: 0 };
  const seen = new Set<string>();
  for (const value of rows) {
    const row = object(value);
    const id = text(row?.id, 128), author = text(row?.[platform === 'x' ? 'authorUsername' : 'author'], 64);
    const content = platform === 'reddit' ? text(row?.title, 2000) : text(row?.[platform === 'x' ? 'text' : 'caption'], 20000);
    const seconds = row?.createdUtc;
    const at = typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : null;
    const counters = platform === 'x' ? [row?.likeCount, row?.replyCount, row?.retweetCount, row?.quoteCount]
      : platform === 'tiktok' ? [row?.likes, row?.comments, row?.shares]
      : [typeof row?.score === 'number' && Number.isSafeInteger(row.score) ? Math.max(0, row.score) : null, row?.numComments];
    if (!id || !author || ['[deleted]', '[removed]'].includes(author) || !content || !at || !Number.isFinite(at.getTime()) || counters.some(v => count(v) === null)) { page.invalid++; continue; }
    if (at < since || at > until) { page.outsideWindow++; continue; }
    if (seen.has(id)) continue;
    seen.add(id);
    page.mentions.push({ externalId: id, platform, creatorHandle: author, creatorAgeDays: null,
      text: platform === 'reddit' ? `${content}\n${typeof row?.selftext === 'string' ? row.selftext.slice(0, 20000) : ''}` : content,
      engagement: Math.min(2147483647, (counters as number[]).reduce((a, b) => a + b, 0)), at });
  }
  // A nonempty response with no recognizable records is an integration failure, not evidence of no activity.
  if (rows.length && page.invalid === rows.length) throw new TregError('TREG_INVALID_RECORDS');
  return page;
}

export class TregNarrativeProvider implements NarrativeProvider {
  readonly name: string;
  private readonly topics: (TrendingTopic & { query: string })[];
  private readonly runId: string;
  constructor(private readonly opts: {
    platform: SocialPlatform; topics: TregTopic[]; call: TregCall; now?: Date; runId?: string;
    maxPages?: number; pageSize?: number;
    onPage?: (stats: { platform: SocialPlatform; topic: string; page: number; received: number; accepted: number; invalid: number; outsideWindow: number }) => void;
  }) {
    if (!Object.hasOwn(TREG_ENDPOINTS, opts.platform)) throw new TregError('INVALID_TREG_PLATFORM');
    if (!Number.isInteger(opts.maxPages ?? 1) || (opts.maxPages ?? 1) < 1 || (opts.maxPages ?? 1) > 3) throw new TregError('INVALID_TREG_MAX_PAGES');
    if (!Number.isInteger(opts.pageSize ?? 20) || (opts.pageSize ?? 20) < 1 || (opts.pageSize ?? 20) > 50) throw new TregError('INVALID_TREG_PAGE_SIZE');
    if (!opts.topics.length || opts.topics.length > 10) throw new TregError('INVALID_TREG_TOPICS');
    this.name = `treg:anyapi:${opts.platform}`;
    this.runId = opts.runId ?? randomUUID();
    this.topics = opts.topics.map(t => {
      const norm = normalizeTopic(t.name);
      if (!norm || !text(t.query, 300)) throw new TregError('INVALID_TREG_TOPIC');
      return { name: norm.name, externalId: norm.slug, query: t.query.trim() };
    });
    if (new Set(this.topics.map(t => t.externalId)).size !== this.topics.length) throw new TregError('DUPLICATE_TREG_TOPIC');
  }
  // The existing interface names these "trending"; here they are explicitly operator-selected watchlist topics.
  async getTrendingTopics(): Promise<TrendingTopic[]> { return this.topics.map(({ name, externalId }) => ({ name, externalId })); }
  async getTopicActivity(topic: TrendingTopic, since: Date): Promise<RawMention[]> {
    const config = this.topics.find(t => t.externalId === topic.externalId);
    if (!config) throw new TregError('UNKNOWN_TREG_TOPIC');
    const until = this.opts.now ?? new Date(), platform = this.opts.platform;
    if (!Number.isFinite(since.getTime()) || !Number.isFinite(until.getTime()) || since > until) throw new TregError('INVALID_TREG_WINDOW');
    const body: Record<string, unknown> = platform === 'x'
      ? { query: `(${config.query}) since:${since.toISOString().slice(0, 10)}`, queryType: 'Latest', limit: this.opts.pageSize ?? 20 }
      : platform === 'reddit' ? { query: config.query, sort: 'relevance', timeframe: 'all' }
      : { query: config.query, datePosted: 0, sortBy: 2 };
    const mentions: RawMention[] = [], seen = new Set<string>(), cursors = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; page < (this.opts.maxPages ?? 1); page++) {
      const request = { ...body, ...(cursor ? { cursor } : {}) };
      const key = createHash('sha256').update(JSON.stringify([this.runId, platform, topic.externalId, since.toISOString(), until.toISOString(), request])).digest('hex');
      const result = parseTregPage(platform, await this.opts.call(TREG_ENDPOINTS[platform], request, key), since, until);
      this.opts.onPage?.({ platform, topic: topic.externalId, page: page + 1, received: result.received, accepted: result.mentions.length, invalid: result.invalid, outsideWindow: result.outsideWindow });
      for (const m of result.mentions) if (!seen.has(m.externalId)) { seen.add(m.externalId); mentions.push(m); }
      cursor = result.nextCursor;
      if (!cursor || cursors.has(cursor)) break;
      cursors.add(cursor);
    }
    return mentions;
  }
}
