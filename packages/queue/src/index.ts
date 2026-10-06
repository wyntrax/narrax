import { Queue, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { z } from 'zod';
import { AgentDecisionSchema } from '@narra/shared';

export interface QueueCounts { waiting: number; active: number; failed: number; delayed: number; /** Workers connected to this queue right now. 0 with jobs waiting means nothing is consuming it. */ consumers?: number }

export const QUEUE_NAMES = {
  walletEvents: 'wallet-events',
  aiScreening: 'ai-screening',
  execution: 'execution',
  walletIntelligence: 'wallet-intelligence',
  narrativeIngestion: 'narrative-ingestion',
  tokenResolution: 'token-resolution',
  aiAnalysis: 'ai-analysis',
  marketData: 'market-data',
  walletSync: 'wallet-sync',
  walletFunding: 'wallet-funding',
  walletDiscovery: 'wallet-discovery',
  positionMonitor: 'position-monitor',
  entryFanOut: 'entry-fan-out',
  exitFanOut: 'exit-fan-out',
  portfolioSnapshots: 'portfolio-snapshots',
  outcomeTracking: 'outcome-tracking',
  notificationDispatch: 'notification-dispatch',
  realtimePublish: 'realtime-publish',
} as const;

/** A normalized on-chain swap by a wallet. Produced from provider payloads, never from raw text. */
export const SwapEventSchema = z.object({
  signature: z.string().min(32),
  wallet: z.string().min(32),
  mint: z.string().min(32),
  side: z.enum(['BUY', 'SELL']),
  amountSol: z.number().nonnegative(),
  /** Token units traded (decimals applied). Needed to compute cost basis and PnL. */
  tokenAmount: z.number().positive(),
  slot: z.number().int().nonnegative().optional(),
  at: z.string().datetime(),
});
export type SwapEvent = z.infer<typeof SwapEventSchema>;

export const AiScreeningJobSchema = z.object({
  mint: z.string().min(32),
  sourceSignature: z.string(),
  wallet: z.string(),
  reason: z.string().max(120),
});
export type AiScreeningJob = z.infer<typeof AiScreeningJobSchema>;

export const ExecutionJobSchema = z.object({
  userId: z.string().min(1),
  /** Also used as the BullMQ job id, so the same order can never be queued twice. */
  idempotencyKey: z.string().min(8).max(128),
  mint: z.string().min(32),
  /** The persisted AgentDecision an entry comes from. Absent for exits, which come from a position evaluation. */
  decisionId: z.string().min(1).optional(),
  /** The PositionEvaluation an exit acts on. */
  evaluationId: z.string().min(1).optional(),
  /** The open position an exit is for. */
  positionId: z.string().min(1).optional(),
  /** Set only by the confirm endpoint, after it has claimed a PendingConfirmation. Means the user said yes. */
  confirmationId: z.string().min(1).optional(),
  /** Untrusted until validated. Re-validated here so a bad producer cannot skip the schema. */
  decision: AgentDecisionSchema,
});
export type ExecutionJob = z.infer<typeof ExecutionJobSchema>;

/** BullMQ workers need maxRetriesPerRequest: null. */
export function createRedis(url = process.env.REDIS_URL ?? 'redis://localhost:6379'): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}

const RETAIN: Pick<JobsOptions, 'removeOnComplete' | 'removeOnFail'> = {
  removeOnComplete: { age: 3600, count: 5000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

/** For jobs that run every few seconds: keep little history so the queue does not fill Redis. */
const RETAIN_SHORT: Pick<JobsOptions, 'removeOnComplete' | 'removeOnFail'> = {
  removeOnComplete: { age: 300, count: 100 },
  removeOnFail: { age: 24 * 3600, count: 500 },
};

export function createQueues(connection: Redis) {
  const walletEvents = new Queue(QUEUE_NAMES.walletEvents, { connection });
  const aiScreening = new Queue(QUEUE_NAMES.aiScreening, { connection });
  const execution = new Queue(QUEUE_NAMES.execution, { connection });
  const walletIntelligence = new Queue(QUEUE_NAMES.walletIntelligence, { connection });
  const narrativeIngestion = new Queue(QUEUE_NAMES.narrativeIngestion, { connection });
  const tokenResolution = new Queue(QUEUE_NAMES.tokenResolution, { connection });
  const aiAnalysis = new Queue(QUEUE_NAMES.aiAnalysis, { connection });
  const marketData = new Queue(QUEUE_NAMES.marketData, { connection });
  const walletSync = new Queue(QUEUE_NAMES.walletSync, { connection });
  const walletFunding = new Queue(QUEUE_NAMES.walletFunding, { connection });
  const walletDiscovery = new Queue(QUEUE_NAMES.walletDiscovery, { connection });
  const positionMonitor = new Queue(QUEUE_NAMES.positionMonitor, { connection });
  const entryFanOut = new Queue(QUEUE_NAMES.entryFanOut, { connection });
  const exitFanOut = new Queue(QUEUE_NAMES.exitFanOut, { connection });
  const portfolioSnapshots = new Queue(QUEUE_NAMES.portfolioSnapshots, { connection });
  const outcomeTracking = new Queue(QUEUE_NAMES.outcomeTracking, { connection });
  const notificationDispatch = new Queue(QUEUE_NAMES.notificationDispatch, { connection });
  const realtimePublish = new Queue(QUEUE_NAMES.realtimePublish, { connection });

  return {
    walletEvents,
    aiScreening,
    execution,
    walletIntelligence,
    narrativeIngestion,
    tokenResolution,
    aiAnalysis,
    marketData,
    walletSync,
    walletFunding,
    walletDiscovery,
    positionMonitor,
    entryFanOut,
    exitFanOut,
    portfolioSnapshots,
    outcomeTracking,
    scheduleOutcomeTracking: (everyMs = 15 * 60_000) =>
      outcomeTracking.upsertJobScheduler('track', { every: everyMs }, { name: 'track', data: {}, opts: { attempts: 1, ...RETAIN } }),
    notificationDispatch,
    realtimePublish,
    scheduleEntryFanOut: (everyMs = 60_000) =>
      entryFanOut.upsertJobScheduler('fan-out', { every: everyMs }, { name: 'fan-out', data: {}, opts: { attempts: 1, ...RETAIN } }),
    scheduleExitFanOut: (everyMs = 60_000) =>
      exitFanOut.upsertJobScheduler('fan-out', { every: everyMs }, { name: 'fan-out', data: {}, opts: { attempts: 1, ...RETAIN } }),
    schedulePortfolioSnapshots: (everyMs = 5 * 60_000) =>
      portfolioSnapshots.upsertJobScheduler('snapshot', { every: everyMs }, { name: 'snapshot', data: {}, opts: { attempts: 1, ...RETAIN } }),
    /** Turns new alerts into per-user notifications. */
    scheduleNotificationDispatch: (everyMs = 5_000) =>
      notificationDispatch.upsertJobScheduler('dispatch', { every: everyMs }, { name: 'dispatch', data: {}, opts: { attempts: 1, ...RETAIN_SHORT } }),
    /** Appends new rows to the realtime event stream. */
    scheduleRealtimePublish: (everyMs = 2_000) =>
      realtimePublish.upsertJobScheduler('publish', { every: everyMs }, { name: 'publish', data: {}, opts: { attempts: 1, ...RETAIN_SHORT } }),
    scheduleWalletSync: (everyMs = 10 * 60_000) =>
      walletSync.upsertJobScheduler('sync', { every: everyMs }, { name: 'sync', data: {}, opts: { attempts: 1, ...RETAIN } }),
    /** Asks for a sync now. At most one request per minute is queued, so a burst of edits makes one sync. */
    requestWalletSync: async () =>
      walletSync.add('sync', {}, { jobId: `sync-now-${Math.floor(Date.now() / 60_000)}`, attempts: 1, ...RETAIN }),
    schedulePositionMonitor: (everyMs = 5 * 60_000) =>
      positionMonitor.upsertJobScheduler('monitor', { every: everyMs }, { name: 'monitor', data: {}, opts: { attempts: 1, ...RETAIN } }),
    scheduleWalletFunding: (everyMs = 30 * 60_000) =>
      walletFunding.upsertJobScheduler('funding', { every: everyMs }, { name: 'funding', data: {}, opts: { attempts: 1, ...RETAIN } }),
    scheduleWalletDiscovery: (everyMs = 15 * 60_000) =>
      walletDiscovery.upsertJobScheduler('discover', { every: everyMs }, { name: 'discover', data: {}, opts: { attempts: 1, ...RETAIN } }),
    scheduleMarketData: (everyMs = 5 * 60_000) =>
      marketData.upsertJobScheduler('refresh', { every: everyMs }, { name: 'refresh', data: {}, opts: { attempts: 1, ...RETAIN } }),
    scheduleAiAnalysis: (everyMs = 5 * 60_000) =>
      aiAnalysis.upsertJobScheduler('analyze', { every: everyMs }, { name: 'analyze', data: {}, opts: { attempts: 1, ...RETAIN } }),
    scheduleTokenResolution: (everyMs = 10 * 60_000) =>
      tokenResolution.upsertJobScheduler('resolve', { every: everyMs }, { name: 'resolve', data: {}, opts: { attempts: 1, ...RETAIN } }),
    scheduleNarrativeIngestion: (everyMs = 5 * 60_000) =>
      narrativeIngestion.upsertJobScheduler('ingest', { every: everyMs }, { name: 'ingest', data: {}, opts: { attempts: 1, ...RETAIN } }),
    /** Repeats the wallet-intelligence recompute on a timer. Safe to call on every start. */
    scheduleWalletIntelligence: (everyMs = 15 * 60_000) =>
      walletIntelligence.upsertJobScheduler('recompute', { every: everyMs }, { name: 'recompute', data: {}, opts: { attempts: 1, ...RETAIN } }),
    /** The transaction signature is the job id, so webhook redeliveries are ignored. */
    enqueueWalletEvent: async (event: SwapEvent) =>
      walletEvents.add('swap', SwapEventSchema.parse(event), {
        jobId: event.signature, attempts: 3, backoff: { type: 'exponential', delay: 1000 }, ...RETAIN,
      }),
    enqueueAiScreening: async (job: AiScreeningJob) =>
      aiScreening.add('screen', AiScreeningJobSchema.parse(job), {
        jobId: `${job.mint}:${job.sourceSignature}`, attempts: 2, backoff: { type: 'fixed', delay: 2000 }, ...RETAIN,
      }),
    /** attempts: 1 on purpose. A failed trade must never be retried automatically. */
    enqueueExecution: async (job: ExecutionJob) =>
      execution.add('execute', ExecutionJobSchema.parse(job), { jobId: job.idempotencyKey, attempts: 1, ...RETAIN }),
    /** Waiting, active, failed and delayed job counts for every queue, for the admin status view. */
    counts: async (): Promise<Record<string, QueueCounts>> => {
      const out: Record<string, QueueCounts> = {};
      for (const q of [walletEvents, aiScreening, execution, walletIntelligence, narrativeIngestion, tokenResolution, aiAnalysis, marketData, walletSync, walletFunding, walletDiscovery, positionMonitor, entryFanOut, exitFanOut, portfolioSnapshots, outcomeTracking, notificationDispatch, realtimePublish]) {
        const c = await q.getJobCounts('waiting', 'active', 'failed', 'delayed');
        let consumers: number | undefined;
        try { consumers = (await q.getWorkers()).length; } catch { consumers = undefined; } // unknown, not zero, when Redis will not say
        out[q.name] = { waiting: c.waiting ?? 0, active: c.active ?? 0, failed: c.failed ?? 0, delayed: c.delayed ?? 0, ...(consumers === undefined ? {} : { consumers }) };
      }
      return out;
    },
    close: async () => { await Promise.all([walletEvents.close(), aiScreening.close(), execution.close(), walletIntelligence.close(), narrativeIngestion.close(), tokenResolution.close(), aiAnalysis.close(), marketData.close(), walletSync.close(), walletFunding.close(), walletDiscovery.close(), positionMonitor.close(), entryFanOut.close(), exitFanOut.close(), portfolioSnapshots.close(), outcomeTracking.close(), notificationDispatch.close(), realtimePublish.close()]); },
  };
}
export type Queues = ReturnType<typeof createQueues>;
