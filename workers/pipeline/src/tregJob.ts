import type { Job } from 'bullmq';
import type { PrismaClient } from '@narra/database';
import { createTregClient, TregNarrativeProvider, TregError, type TregConfig } from '@narra/narrative';
import { ingestNarratives } from './narrativeIngestion';

export async function runTregJob(db: PrismaClient, config: TregConfig, job: Job) {
  // Scheduler jobs may be created before they run. Persist observation time for redelivery.
  const observedAt = typeof job.data.observedAt === 'number' && Number.isFinite(job.data.observedAt)
    ? job.data.observedAt : Date.now();
  if (job.data.observedAt !== observedAt) await job.updateData({ ...job.data, observedAt });
  const now = new Date(observedAt);
  const call = createTregClient({ token: process.env.TREG_TOKEN!, org: process.env.TREG_ORG, maxCostUsd: config.maxCostUsd,
    onReceipt: async receipt => {
      console.log(JSON.stringify({ msg: 'narrative_source_call', ...receipt }));
      await db.auditLog.create({ data: { action: 'NARRATIVE_SOURCE_CALL', detail: { ...receipt, jobId: job.id ?? null } } });
    } });
  const providers = config.platforms.map(platform => new TregNarrativeProvider({ ...config, platform, call, now, runId: job.id,
    onPage: stats => console.log(JSON.stringify({ msg: 'narrative_source_page', ...stats })) }));
  const result = await ingestNarratives(db, providers, now, {
    onProviderError: (provider, error) => console.warn(JSON.stringify({ msg: 'narrative_source_error', provider, code: error instanceof TregError ? error.code : 'SOURCE_FAILED' })),
  });
  console.log(JSON.stringify({ msg: 'narrative_ingestion_complete', jobId: job.id, ...result }));
  return JSON.stringify(result);
}
