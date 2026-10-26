import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { z } from 'zod';

export const TOKEN_DISCOVERY_QUEUE = 'token-discovery';
export const TokenDiscoveryJobSchema = z.object({ mint: z.string().min(32).max(44) }).strict();

/** One bounded scan per token per five-minute bucket. Repeated clicks cannot multiply provider work. */
export function createTokenDiscoveryQueue(connection: Redis) {
  const queue = new Queue(TOKEN_DISCOVERY_QUEUE, { connection });
  return {
    queue,
    request: (mint: string, now = Date.now()) => queue.add('token', TokenDiscoveryJobSchema.parse({ mint }), {
      jobId: `token-${mint}-${Math.floor(now / 300_000)}`,
      attempts: 1,
      removeOnComplete: { age: 3_600, count: 500 },
      removeOnFail: { age: 86_400, count: 500 },
    }),
  };
}
