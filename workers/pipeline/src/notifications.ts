import type { PrismaClient } from '@narra/database';
import { DEFAULT_NOTIFICATION_PREFS, shouldDeliverGlobalAlert, type AlertPriority, type NotificationPrefs } from '@narra/shared';

/** Starting values, not tuned. */
export const DISPATCH_LIMITS = {
  /** Alerts claimed per transaction. Small, so one slow batch never holds many row locks. */
  alertBatch: 50,
  /** Batches per run. A burst bigger than this is finished on the next run. */
  maxBatches: 20,
  /** Users read per page while fanning a global alert out. */
  userPage: 1000,
} as const;

export interface DispatchSummary {
  alerts: number;
  global: number;
  personal: number;
  notifications: number;
  /** Global alert and user pairs that were not delivered because of the user's preferences. */
  heldByPreferences: number;
}

interface ClaimedAlert { id: string; userId: string | null; kind: string; priority: AlertPriority }

/**
 * Turns alerts into notifications, once each.
 *
 *  - An alert that belongs to a user always gets that user's notification. The writers normally create it in the same
 *    transaction, so this only fills a gap (skipDuplicates makes it a no-op otherwise).
 *  - A global alert (no owner) becomes a notification for every user whose preferences allow it.
 *
 * Alerts are claimed with FOR UPDATE SKIP LOCKED and marked dispatched in the same transaction as their notifications,
 * so two workers never handle the same alert and a crash leaves the alert undispatched (it is retried, and the unique
 * (userId, alertId) index makes a retry harmless). Nothing here can trade or touch a wallet.
 */
export async function dispatchAlerts(db: PrismaClient, now: Date = new Date()): Promise<DispatchSummary> {
  const out: DispatchSummary = { alerts: 0, global: 0, personal: 0, notifications: 0, heldByPreferences: 0 };
  for (let i = 0; i < DISPATCH_LIMITS.maxBatches; i++) {
    const handled = await db.$transaction(async (tx) => {
      const alerts = await tx.$queryRaw<ClaimedAlert[]>`
        SELECT "id", "userId", "kind", "priority"::text AS "priority" FROM "Alert"
        WHERE "dispatchedAt" IS NULL ORDER BY "createdAt", "id" LIMIT ${DISPATCH_LIMITS.alertBatch} FOR UPDATE SKIP LOCKED`;
      if (!alerts.length) return 0;

      const personal = alerts.filter((a) => a.userId);
      const global = alerts.filter((a) => !a.userId);
      if (personal.length) {
        const r = await tx.notification.createMany({ data: personal.map((a) => ({ userId: a.userId!, alertId: a.id, createdAt: now })), skipDuplicates: true });
        out.notifications += r.count; out.personal += personal.length;
      }
      if (global.length) {
        out.global += global.length;
        let cursor: string | undefined;
        for (;;) {
          const users = await tx.user.findMany({
            orderBy: { id: 'asc' }, take: DISPATCH_LIMITS.userPage, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            select: { id: true, settings: { select: { minAlertPriority: true, mutedAlertKinds: true } } },
          });
          if (!users.length) break;
          const rows: { userId: string; alertId: string; createdAt: Date }[] = [];
          for (const u of users) {
            const prefs: NotificationPrefs = u.settings ? { minPriority: u.settings.minAlertPriority, mutedKinds: u.settings.mutedAlertKinds } : DEFAULT_NOTIFICATION_PREFS;
            for (const a of global) {
              if (shouldDeliverGlobalAlert(prefs, a)) rows.push({ userId: u.id, alertId: a.id, createdAt: now });
              else out.heldByPreferences++;
            }
          }
          if (rows.length) out.notifications += (await tx.notification.createMany({ data: rows, skipDuplicates: true })).count;
          cursor = users[users.length - 1]!.id;
          if (users.length < DISPATCH_LIMITS.userPage) break;
        }
      }
      await tx.alert.updateMany({ where: { id: { in: alerts.map((a) => a.id) } }, data: { dispatchedAt: now } });
      return alerts.length;
    }, { timeout: 60_000, maxWait: 10_000 });
    out.alerts += handled;
    if (handled < DISPATCH_LIMITS.alertBatch) break;
  }
  return out;
}
