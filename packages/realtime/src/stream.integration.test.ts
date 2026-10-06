import { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import { compareIds, createEventStream, parseEntry } from './stream';
import { startStreamReader } from './reader';
import { validateNewEvent, type StreamEvent } from './events';

const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
async function redisUp() {
  const r = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null });
  try { await r.connect(); await r.ping(); return true; } catch { return false; } finally { r.disconnect(); }
}
const up = await redisUp();

describe('event validation and ids (pure)', () => {
  it('rejects a user event without a user and a global event with one', () => {
    const base = { at: new Date(), data: { positionId: 'p', evaluationId: 'e', action: 'SELL', fractionPct: 100, pnlPct: -3, blind: false } };
    expect(() => validateNewEvent({ type: 'position.evaluated', ...base })).toThrow(/userId/);
    expect(() => validateNewEvent({ type: 'market.sol', userId: 'u', at: new Date(), data: { priceUsd: 150 } })).toThrow(/global/);
    expect(validateNewEvent({ type: 'position.evaluated', userId: 'u', ...base }).channel).toBe('me');
  });
  it('rejects data that does not match the event type', () => {
    expect(() => validateNewEvent({ type: 'market.sol', at: new Date(), data: { priceUsd: 'free' } as never })).toThrow();
  });
  it('compares stream ids numerically, not as strings', () => {
    expect(compareIds('9-0', '10-0')).toBe(-1);
    expect(compareIds('10-1', '10-0')).toBe(1);
    expect(compareIds('5-5', '5-5')).toBe(0);
  });
  it('skips a malformed entry instead of throwing', () => {
    expect(parseEntry('1-0', ['t', 'market.sol'])).toBeNull();
    expect(parseEntry('1-0', ['t', 'market.sol', 'c', 'me', 's', 'global', 'u', '', 'a', 'x', 'd', '{}'])).toBeNull(); // channel does not match the type
    expect(parseEntry('1-0', ['t', 'nope', 'c', 'market', 's', 'global', 'u', '', 'a', 'x', 'd', '{}'])).toBeNull();
  });
});

describe.skipIf(!up)('event stream (needs Redis)', () => {
  const key = `test:events:${Date.now()}`;
  const conn = new Redis(url);
  const stream = createEventStream(conn, key);
  afterAll(async () => { await conn.del(key); conn.disconnect(); });

  const sol = (priceUsd: number) => ({ type: 'market.sol' as const, at: new Date(), data: { priceUsd } });

  it('publishes, reads a range after an id, and reports the newest id', async () => {
    expect(await stream.newestId()).toBe('0-0');
    const a = await stream.publish(sol(100)); const b = await stream.publish(sol(101));
    const after = await stream.readRange(a, 10);
    expect(after.map((e) => e.id)).toEqual([b]);
    expect(await stream.newestId()).toBe(b);
    expect((after[0] as StreamEvent).data).toEqual({ priceUsd: 101 });
  });

  it('publishes a dedupe key only once, even when attempted concurrently', async () => {
    const before = (await stream.readRange('0-0', 1000)).length;
    const results = await Promise.all(Array.from({ length: 6 }, () => stream.publishOnce('once-a', sol(150))));
    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect(await stream.publishOnce('once-a', sol(150))).toBeNull();
    expect(await stream.publishOnce('once-b', sol(150))).not.toBeNull();
    expect((await stream.readRange('0-0', 1000)).length).toBe(before + 2);
  });

  it('refuses to publish an invalid event and writes nothing', async () => {
    const before = await stream.newestId();
    await expect(stream.publish({ type: 'trade.created', at: new Date(), data: {} as never })).rejects.toThrow();
    expect(await stream.newestId()).toBe(before);
  });

  it('can resume from an id that was never trimmed, and cannot once entries after it were trimmed away', async () => {
    const k2 = `${key}:trim`;
    const s2 = createEventStream(conn, k2);
    expect(await s2.canResumeFrom('0-0')).toBe(true); // no stream yet
    const first = await s2.publish(sol(1));
    expect(await s2.canResumeFrom(first)).toBe(true);
    const junk = (await conn.xadd(k2, 'MAXLEN', '=', 1, '*', 't', 'x')) as string; // trims `first`
    expect(await s2.canResumeFrom('0-0')).toBe(false);
    expect(await s2.canResumeFrom(first)).toBe(false); // older than the oldest entry kept, so something may be missing
    expect(await s2.canResumeFrom(junk)).toBe(true);
    await conn.del(k2);
  });

  it('the reader forwards only events published after it started', async () => {
    await stream.publish(sol(200)); // before start, must not be seen
    const blocking = new Redis(url);
    const seen: number[] = [];
    const reader = startStreamReader({ stream: createEventStream(blocking, key), blockMs: 200, onEvents: (es) => es.forEach((e) => seen.push((e.data as { priceUsd: number }).priceUsd)) });
    await new Promise((r) => setTimeout(r, 300));
    await stream.publish(sol(201)); await stream.publish(sol(202));
    await new Promise((r) => setTimeout(r, 600));
    await reader.stop(); blocking.disconnect();
    expect(seen).toEqual([201, 202]);
  });
});
