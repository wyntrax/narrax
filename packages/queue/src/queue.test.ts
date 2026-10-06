import { Worker } from 'bullmq';
import { afterAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { QUEUE_NAMES, createQueues, createRedis, type SwapEvent } from './index';

const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
async function redisUp() {
  const r = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null });
  try { await r.connect(); await r.ping(); return true; } catch { return false; } finally { r.disconnect(); }
}
const up = await redisUp();

describe.skipIf(!up)('queues (needs Redis)', () => {
  const connection = createRedis(url);
  const queues = createQueues(connection);
  afterAll(async () => { await queues.close(); connection.disconnect(); });

  const ev = (sig: string): SwapEvent => ({ signature: sig.padEnd(64, '0'), wallet: 'W'.padEnd(40, '1'), mint: 'M'.padEnd(40, '1'), side: 'BUY', amountSol: 1, tokenAmount: 100, at: new Date().toISOString() });

  it('processes a redelivered webhook event only once', async () => {
    await queues.walletEvents.obliterate({ force: true });
    const seen: string[] = [];
    const worker = new Worker(QUEUE_NAMES.walletEvents, async (j) => { seen.push(j.id!); }, { connection: createRedis(url) });
    const e = ev(`dup${Date.now()}`);
    await queues.enqueueWalletEvent(e);
    await queues.enqueueWalletEvent(e);
    await new Promise((r) => setTimeout(r, 600));
    await worker.close();
    expect(seen).toHaveLength(1);
  });

  it('never retries a failed execution job', async () => {
    await queues.execution.obliterate({ force: true });
    let runs = 0;
    const worker = new Worker(QUEUE_NAMES.execution, async () => { runs++; throw new Error('boom'); }, { connection: createRedis(url) });
    await queues.enqueueExecution({
      userId: 'u', decisionId: 'd1', idempotencyKey: `exec-${Date.now()}-abc`, mint: 'M'.padEnd(40, '1'),
      decision: { action: 'BUY', confidence: 0.9, reasonCodes: [], positiveSignals: [], negativeSignals: [], risks: [], suggestedPositionSizePct: 1,
        entry: { maxSlippageBps: 100, maxPriceImpactPct: 1 }, exit: { stopLossPct: null, takeProfitPct: null, trailingStopPct: null }, invalidationConditions: [], summary: '' },
    });
    await new Promise((r) => setTimeout(r, 1500));
    await worker.close();
    expect(runs).toBe(1);
  });

  it('refuses an invalid execution job before it is queued', async () => {
    await expect(queues.enqueueExecution({ userId: 'u', idempotencyKey: 'short', mint: 'x', decision: {} } as never)).rejects.toThrow();
  });
});

describe.skipIf(!up)('wallet intelligence schedule (needs Redis)', () => {
  it('registers one repeating job and does not duplicate it when called again', async () => {
    const connection = createRedis(url);
    const queues = createQueues(connection);
    await queues.walletIntelligence.obliterate({ force: true });
    await queues.scheduleWalletIntelligence(60_000);
    await queues.scheduleWalletIntelligence(60_000);
    const schedulers = await queues.walletIntelligence.getJobSchedulers();
    expect(schedulers).toHaveLength(1);
    expect(schedulers[0]).toMatchObject({ key: 'recompute', every: 60_000 });
    await queues.walletIntelligence.obliterate({ force: true });
    await queues.narrativeIngestion.obliterate({ force: true });
    await queues.scheduleNarrativeIngestion(120_000);
    await queues.scheduleNarrativeIngestion(120_000);
    expect(await queues.narrativeIngestion.getJobSchedulers()).toMatchObject([{ key: 'ingest', every: 120_000 }]);
    await queues.narrativeIngestion.obliterate({ force: true });
    await queues.tokenResolution.obliterate({ force: true });
    await queues.scheduleTokenResolution(180_000);
    await queues.scheduleTokenResolution(180_000);
    expect(await queues.tokenResolution.getJobSchedulers()).toMatchObject([{ key: 'resolve', every: 180_000 }]);
    await queues.tokenResolution.obliterate({ force: true });
    await queues.aiAnalysis.obliterate({ force: true });
    await queues.scheduleAiAnalysis(240_000);
    await queues.scheduleAiAnalysis(240_000);
    expect(await queues.aiAnalysis.getJobSchedulers()).toMatchObject([{ key: 'analyze', every: 240_000 }]);
    await queues.aiAnalysis.obliterate({ force: true });
    await queues.close(); connection.disconnect();
  });
});
