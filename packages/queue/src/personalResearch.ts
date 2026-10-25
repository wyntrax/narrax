import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { z } from 'zod';
export const PERSONAL_RESEARCH_QUEUE = 'personal-research';
export const PersonalResearchJobSchema = z.object({ userId: z.string().min(1).max(128).optional() }).strict();
export function createPersonalResearchQueue(connection: Redis) {
  const queue = new Queue(PERSONAL_RESEARCH_QUEUE, { connection });
  return { queue, request: (userId: string, now = Date.now()) => queue.add('user', PersonalResearchJobSchema.parse({ userId }), {
    jobId: `personal-${userId}-${Math.floor(now / 60_000)}`, attempts: 1, removeOnComplete: { age: 300, count: 1000 }, removeOnFail: { age: 86400, count: 1000 },
  }) };
}
