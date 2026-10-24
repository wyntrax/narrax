import { Redis } from 'ioredis';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { acquireWorkerLock, WORKER_LOCK_KEY } from './workerLock';

// Only ever run against the isolated Redis named by the test environment, never the app instance.
const url = process.env.NARRA_TEST_REDIS_URL;
const redis = url ? new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null }) : null;
const available = redis
  ? await redis.connect().then(() => redis.ping()).then(() => true, () => false)
  : false;

describe.skipIf(!available)('single pipeline worker lock', () => {
  beforeEach(async () => { await redis!.del(WORKER_LOCK_KEY); });
  afterAll(() => { redis?.disconnect(); });

  it('lets exactly one owner claim the slot and release it for the next process', async () => {
    const first = await acquireWorkerLock(redis!, 'one');
    expect(first).not.toBeNull();
    expect(await acquireWorkerLock(redis!, 'two')).toBeNull();
    expect(await redis!.get(WORKER_LOCK_KEY)).toBe('one');
    await first!.release();
    const second = await acquireWorkerLock(redis!, 'two');
    expect(second).not.toBeNull();
    expect(await redis!.get(WORKER_LOCK_KEY)).toBe('two');
    await second!.release();
  });

  it('leaves a newer lease intact when an older owner shuts down late', async () => {
    const stale = await acquireWorkerLock(redis!, 'stale');
    await redis!.set(WORKER_LOCK_KEY, 'newer', 'PX', 60_000);
    await stale!.release();
    expect(await redis!.get(WORKER_LOCK_KEY)).toBe('newer');
  });

  it('reports a lease lost after a stall so the process can stop instead of running alongside a new one', async () => {
    let lost = 0;
    const held = await acquireWorkerLock(redis!, 'stalled', 1_200, () => lost++);
    await redis!.del(WORKER_LOCK_KEY);
    await new Promise((resolve) => setTimeout(resolve, 1_300)); // first renewal runs after ~1s
    expect(lost).toBe(1);
    await held!.release();
    expect(await redis!.get(WORKER_LOCK_KEY)).toBeNull();
  });
});
