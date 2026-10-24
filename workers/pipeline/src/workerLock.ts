import type { Redis } from 'ioredis';

/** One pipeline process at a time. The key is also what an operator can inspect. */
export const WORKER_LOCK_KEY = 'narra:pipeline:worker';
export const WORKER_LOCK_TTL_MS = 90_000;

export interface WorkerLock {
  release(): Promise<void>;
}

const releaseScript = `if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end`;
const renewScript = `if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('pexpire',KEYS[1],ARGV[2]) else return 0 end`;

/**
 * Claims the single-pipeline-worker slot. Two pipeline processes double-consume every queue, and
 * Telegram delivery has no per-chat cursor lock, so a second process could send the same alert twice.
 * The claim carries a lease, so a crashed process never needs manual cleanup; a stalled process that
 * loses its lease is reported through `onLost` so it can stop instead of running beside a new one.
 */
export async function acquireWorkerLock(
  redis: Redis,
  owner: string,
  ttlMs = WORKER_LOCK_TTL_MS,
  onLost?: () => void,
): Promise<WorkerLock | null> {
  const claimed = await redis.set(WORKER_LOCK_KEY, owner, 'PX', ttlMs, 'NX');
  if (claimed !== 'OK') return null;
  let lost = false;
  const lose = () => {
    if (lost) return;
    lost = true;
    clearInterval(timer);
    onLost?.();
  };
  const timer = setInterval(() => {
    redis.eval(renewScript, 1, WORKER_LOCK_KEY, owner, String(ttlMs))
      .then((reply) => { if (Number(reply) !== 1) lose(); })
      // A network error is not proof of loss. Keep the lease flag and retry on the next tick.
      .catch(() => {});
  }, Math.max(1_000, Math.floor(ttlMs / 3)));
  timer.unref();
  return {
    async release() {
      lost = true;
      clearInterval(timer);
      // Only the owner may delete the key; a new worker's lease must survive a late shutdown.
      await redis.eval(releaseScript, 1, WORKER_LOCK_KEY, owner).catch(() => 0);
    },
  };
}
