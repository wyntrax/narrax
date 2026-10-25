/** Personal research scheduling uses the API's authoritative entitlement resolver. */
import { Worker } from 'bullmq';
import { createPrisma } from '@narra/database';
import { createRedis, createPersonalResearchQueue, PERSONAL_RESEARCH_QUEUE, PersonalResearchJobSchema } from '@narra/queue';
import { PRO_RESEARCH_LIMITS } from '@narra/shared';
import { evaluatePersonalWorkspace } from '@narra/worker-pipeline';
import { personalPermissions } from './personalResearch';

async function main() {
  const db = createPrisma(), connection = createRedis();
  const { queue } = createPersonalResearchQueue(connection);
  await queue.upsertJobScheduler('evaluate', { every: PRO_RESEARCH_LIMITS.intervalMs }, { name: 'evaluate', data: {}, opts: { attempts: 1, removeOnComplete: 100, removeOnFail: 100 } });
  const worker = new Worker(PERSONAL_RESEARCH_QUEUE, async job => {
    const input = PersonalResearchJobSchema.parse(job.data);
    if (input.userId) return evaluatePersonalWorkspace(db, input.userId, () => personalPermissions(db, input.userId!, new Date()));
    // Oldest first, including never evaluated. Ineligible users advance their cursor too.
    const rows = await db.researchMonitor.findMany({ where: { active: true }, orderBy: [{ lastEvaluatedAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }], distinct: ['userId'], take: 50, select: { userId: true } });
    let completed = 0, failed = 0;
    for (const { userId } of rows) {
      try { await evaluatePersonalWorkspace(db, userId, () => personalPermissions(db, userId, new Date())); completed++; }
      catch { failed++; }
    }
    if (failed) console.error(JSON.stringify({ event: 'personal_research_user_failures', failed }));
    return { completed, failed, batchFull: rows.length === 50 };
  }, { connection, concurrency: 1 });
  worker.on('failed', () => console.error('personal research job failed'));
  const shutdown = async () => { await worker.close(); await queue.close(); connection.disconnect(); await db.$disconnect(); };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
  console.log('personal research worker started');
}
main().catch(() => { console.error('personal research worker startup failed'); process.exitCode = 1; });
