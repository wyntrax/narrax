/** Registration only. No trading/job logic; implementation stays in the approved API boundary. */
import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import type { PrismaClient } from '@narra/database';
import { reconcile } from '../../../apps/api/src/entitlements/reconcile';
import type { PartnerConfig } from '../../../apps/api/src/entitlements/partner';
export const ENTITLEMENT_QUEUE = 'wyntrax-reconcile';
export const createEntitlementQueue = (connection: Redis) => new Queue(ENTITLEMENT_QUEUE, { connection });
export const requestReconcile = (queue: Queue, now = Date.now()) => queue.add('reconcile', {}, { jobId: `manual-${Math.floor(now / 60000)}`, attempts: 1, removeOnComplete: { age: 3600 }, removeOnFail: { age: 86400 } });
export const scheduleReconcile = (queue: Pick<Queue, 'upsertJobScheduler'>) => queue.upsertJobScheduler('wyntrax-reconcile-v1', { every: 900000 }, { name: 'reconcile', data: {}, opts: { attempts: 1, removeOnComplete: { age: 3600 }, removeOnFail: { age: 86400 } } });
export const createEntitlementWorker = (connection: Redis, db: PrismaClient, config: PartnerConfig) => new Worker(ENTITLEMENT_QUEUE, () => reconcile(db, config), { connection, concurrency: 1 });
