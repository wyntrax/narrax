import type { Redis } from 'ioredis';
import { Channel, EVENT_DEFS, type EventType, type NewEvent, type StreamEvent, validateNewEvent } from './events';

/** One stream carries every event. The gateway filters by scope, user and channel. */
export const STREAM_KEY = process.env.REALTIME_STREAM_KEY || 'narra:events';
/** Approximate cap (MAXLEN ~). About an hour of busy traffic. Clients that were away longer are told to refetch. */
export const STREAM_MAX_LEN = 20_000;
/** A dedupe key lives this long, which must be longer than the publisher's overlap window. */
export const DEDUPE_TTL_SECONDS = 15 * 60;

// Atomic "publish unless this key was already published". Without the atomicity a crash between the two commands
// would either lose the event or publish it twice.
const PUBLISH_ONCE = `
if redis.call('SET', KEYS[2], '1', 'NX', 'EX', ARGV[1]) then
  return redis.call('XADD', KEYS[1], 'MAXLEN', '~', ARGV[2], '*', unpack(ARGV, 3))
end
return false
`;

function fieldsOf(e: NewEvent): string[] {
  const v = validateNewEvent(e);
  return ['t', e.type, 'c', v.channel, 's', v.scope, 'u', e.userId ?? '', 'a', e.at.toISOString(), 'd', JSON.stringify(v.data)];
}

type RawEntry = [string, string[]];

/** Parses one stream entry. Returns null for anything that does not match, so a bad row is skipped rather than crashing the gateway. */
export function parseEntry(id: string, fields: string[]): StreamEvent | null {
  const f: Record<string, string> = {};
  for (let i = 0; i + 1 < fields.length; i += 2) f[fields[i]!] = fields[i + 1]!;
  const type = f.t as EventType | undefined;
  const def = type ? EVENT_DEFS[type] : undefined;
  const channel = Channel.safeParse(f.c);
  if (!type || !def || !channel.success || (f.s !== 'global' && f.s !== 'user') || !f.a) return null;
  if (channel.data !== def.channel || f.s !== def.scope) return null;
  if (f.s === 'user' && !f.u) return null;
  let data: unknown;
  try { data = JSON.parse(f.d ?? 'null'); } catch { return null; }
  return { id, type, channel: channel.data, scope: f.s, userId: f.u ? f.u : null, at: f.a, data };
}

const parseAll = (entries: RawEntry[] | undefined): StreamEvent[] =>
  (entries ?? []).flatMap(([id, fields]) => { const e = parseEntry(id, fields); return e ? [e] : []; });

export const VALID_STREAM_ID = /^\d{1,16}-\d{1,16}$/;

/** Compares two stream ids numerically (ms first, then sequence). */
export function compareIds(a: string, b: string): number {
  const [am, as] = a.split('-').map(Number) as [number, number];
  const [bm, bs] = b.split('-').map(Number) as [number, number];
  return am !== bm ? (am < bm ? -1 : 1) : as === bs ? 0 : as < bs ? -1 : 1;
}

/**
 * The event stream on one Redis connection. Pass a connection of its own to readBlocking: XREAD BLOCK holds the
 * connection until it returns. The key is a parameter so tests can use a private stream.
 */
export function createEventStream(redis: Redis, key: string = STREAM_KEY) {
  const seenKey = (k: string) => `${key}:seen:${k}`;
  return {
    key,

    /** Appends an event. Returns the stream id. Always validates first. */
    async publish(e: NewEvent): Promise<string> {
      return (await redis.xadd(key, 'MAXLEN', '~', STREAM_MAX_LEN, '*', ...fieldsOf(e))) as string;
    },

    /**
     * Appends an event unless one with the same dedupe key was published in the last 15 minutes.
     * Returns the stream id, or null when it was a duplicate.
     */
    async publishOnce(dedupeKey: string, e: NewEvent): Promise<string | null> {
      const r = await redis.eval(PUBLISH_ONCE, 2, key, seenKey(dedupeKey), DEDUPE_TTL_SECONDS, STREAM_MAX_LEN, ...fieldsOf(e));
      return typeof r === 'string' ? r : null;
    },

    /** Entries with an id strictly after `afterId`, oldest first. */
    async readRange(afterId: string, count: number): Promise<StreamEvent[]> {
      return (await this.readRangePage(afterId, count)).events;
    },

    /**
     * Like readRange, and also reports how many raw entries came back and the id of the last one. A page can hold fewer valid
     * events than raw entries (a malformed entry is skipped), so only `rawCount < count` means the end of the stream was reached.
     */
    async readRangePage(afterId: string, count: number): Promise<{ events: StreamEvent[]; rawCount: number; lastId: string | null }> {
      const raw = (await redis.xrange(key, `(${afterId}`, '+', 'COUNT', count)) as RawEntry[];
      return { events: parseAll(raw), rawCount: raw.length, lastId: raw.length ? raw[raw.length - 1]![0] : null };
    },

    /** Blocks up to blockMs for entries after `lastId`. */
    async readBlocking(lastId: string, blockMs: number, count = 200): Promise<{ entries: StreamEvent[]; lastId: string }> {
      const res = (await redis.xread('COUNT', count, 'BLOCK', blockMs, 'STREAMS', key, lastId)) as [string, RawEntry[]][] | null;
      const raw = res?.[0]?.[1] ?? [];
      return { entries: parseAll(raw), lastId: raw.length ? raw[raw.length - 1]![0] : lastId };
    },

    /** The newest id in the stream, or '0-0' when it is empty. A new gateway starts here so it only forwards new events. */
    async newestId(): Promise<string> {
      const raw = (await redis.xrevrange(key, '+', '-', 'COUNT', 1)) as RawEntry[];
      return raw[0]?.[0] ?? '0-0';
    },

    /**
     * Whether a client that last saw `lastId` can be caught up from the stream, meaning nothing after that id was trimmed away.
     * Redis does not record trimmed ids (max-deleted-entry-id only tracks XDEL), so this is decided from counts:
     * if every entry ever added is still there, any id can resume. Otherwise the client can resume only if its id is not
     * older than the oldest entry still present. That errs on the safe side: a client sitting exactly on the last trimmed
     * id is asked to refetch, which costs one request and never loses an event.
     */
    async canResumeFrom(lastId: string): Promise<boolean> {
      let info: unknown[];
      try {
        info = (await redis.xinfo('STREAM', key)) as unknown[];
      } catch (e) {
        // The stream does not exist yet: nothing was ever trimmed, so any id can resume.
        return /no such key/i.test((e as Error).message);
      }
      const map: Record<string, unknown> = {};
      for (let i = 0; i + 1 < info.length; i += 2) map[String(info[i])] = info[i + 1];
      const added = Number(map['entries-added']); const length = Number(map['length']);
      if (Number.isFinite(added) && Number.isFinite(length) && added - length === 0) return true;
      const first = (await redis.xrange(key, '-', '+', 'COUNT', 1)) as RawEntry[];
      if (!first[0]) return false;
      return compareIds(lastId, first[0][0]) >= 0;
    },
  };
}
export type EventStream = ReturnType<typeof createEventStream>;
