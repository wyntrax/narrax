import { Queue, Worker } from 'bullmq';
import { createPrisma } from '@narra/database';
import { createRedis, QUEUE_NAMES } from '@narra/queue';
import { estimateCycleCostUsd, readTregConfig } from '@narra/narrative';
import { runTregJob } from './tregJob';

async function main() {
  if (!process.env.DATABASE_URL || !process.env.REDIS_URL) throw new Error('DATABASE_URL and REDIS_URL are required');
  const config = readTregConfig(process.env);
  if (!config) throw new Error('Set TREG_NARRATIVE_ENABLED=true and load your Treg configuration');
  const db = createPrisma(), connection = createRedis();
  const queue = new Queue(QUEUE_NAMES.narrativeIngestion, { connection });
  let worker: Worker | undefined;
  const close = async () => { await worker?.close(); await queue.close(); connection.disconnect(); await db.$disconnect(); };
  try {
    await db.$connect();
    await queue.waitUntilReady();
    if ((await queue.getWorkers()).length) throw new Error('Narrative consumer already running');
    worker = new Worker(QUEUE_NAMES.narrativeIngestion, job => runTregJob(db, config, job), { connection, concurrency: 1 });
    worker.on('failed', job => console.error(JSON.stringify({ msg: 'narrative_job_failed', jobId: job?.id })));
    worker.on('error', () => console.error('Narrative worker connection error'));
    connection.on('error', () => console.error('Narrative Redis connection error'));
    await worker.waitUntilReady();
    await queue.upsertJobScheduler('ingest', { every: config.intervalMs }, { name: 'ingest', data: {}, opts: {
      attempts: 1, removeOnComplete: { age: 3600, count: 100 }, removeOnFail: { age: 7 * 86400 },
    } });
    console.log(JSON.stringify({ msg: 'narrative_worker_ready', platforms: config.platforms, topics: config.topics.map(t => t.name), intervalMs: config.intervalMs, maxCostUsd: config.maxCostUsd,
      estimatedCycleCostUsd: estimateCycleCostUsd(config.topics.length, config.platforms, config.maxPages) }));
    let stopping = false;
    const stop = () => { if (stopping) return; stopping = true; void close().then(() => process.exit(0), () => process.exit(1)); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
  } catch (error) { await close(); throw error; }
}
main().catch(() => { console.error('Narrative worker startup failed. Check the loaded database, Redis and Treg configuration.'); process.exitCode = 1; });
