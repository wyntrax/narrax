import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { isSolanaAddress } from '@narra/shared';

export const TRADE_EVIDENCE_QUEUE = 'trade-evidence-refresh';

/** On-demand priority refresh of market, holder, and risk evidence for a token opened in Trade. */
export const TradeEvidenceJobSchema = z.object({
  mint: z.string().max(44).refine(isSolanaAddress),
}).strict();

export type TradeEvidenceJob = z.infer<typeof TradeEvidenceJobSchema>;

/** 60-second single-flight dedupe bucket per mint (BullMQ jobIds cannot contain ':'). */
export function tradeEvidenceJobId(mint: string, nowMs = Date.now()): string {
  return `trade-ev-${mint}-${Math.floor(nowMs / 60_000)}`;
}

/** Fast-lane queue for user-opened Trade tokens that have stale or missing buy evidence. */
export function createTradeEvidenceQueue(connection: Redis) {
  const queue = new Queue(TRADE_EVIDENCE_QUEUE, { connection });
  return {
    queue,
    request: (mint: string, nowMs = Date.now()) => {
      const data = TradeEvidenceJobSchema.parse({ mint });
      return queue.add('refresh', data, {
        jobId: tradeEvidenceJobId(data.mint, nowMs),
        attempts: 2,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 100 },
      });
    },
  };
}
