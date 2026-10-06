import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma, PrismaClient } from '@narra/database';
import { AlertPriority, ALERT_PRIORITY_RANK } from '@narra/shared';
import { makeAuthenticate, type AccountDeps } from './account';
import { IdCursor, Limit } from './paging';

const Query = z.object({
  limit: Limit,
  cursor: IdCursor.optional(),
  unread: z.enum(['true', 'false']).optional(),
  /** Only alerts at or above this priority. */
  minPriority: AlertPriority.optional(),
  kind: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/).optional(),
  sort: z.enum(['recent', 'priority']).default('recent'),
});
const Params = z.object({ id: IdCursor });
const ReadAllBody = z.object({ minPriority: AlertPriority.optional(), kind: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/).optional() }).strict().default({});

const PRIORITIES = Object.keys(ALERT_PRIORITY_RANK) as AlertPriority[];
const atLeast = (p: AlertPriority) => PRIORITIES.filter((x) => ALERT_PRIORITY_RANK[x] >= ALERT_PRIORITY_RANK[p]);

/**
 * The signed-in user's notifications. Read state lives on the notification, not the alert, because one global alert is
 * shown to many users. Every query is scoped to the user, so another user's id is a plain 404.
 * Alert text was sanitized when it was stored. Clients must still render it as text.
 */
export function registerAlertRoutes(app: FastifyInstance, deps: Pick<AccountDeps, 'db' | 'verifier'>): void {
  const db: PrismaClient = deps.db;
  const opts = { preHandler: makeAuthenticate(deps), config: { rateLimit: { max: 120, timeWindow: '1 minute' } } };
  const bad = { error: 'INVALID_INPUT' } as const;
  const where = (userId: string, f: { unread?: boolean; minPriority?: AlertPriority; kind?: string }): Prisma.NotificationWhereInput => ({
    userId,
    ...(f.unread ? { readAt: null } : {}),
    ...(f.minPriority || f.kind ? { alert: { ...(f.minPriority ? { priority: { in: atLeast(f.minPriority) } } : {}), ...(f.kind ? { kind: f.kind } : {}) } } : {}),
  });

  app.get('/v1/alerts', opts, async (req, reply) => {
    const q = Query.safeParse(req.query);
    if (!q.success) return reply.code(400).send(bad);
    const userId = req.userId!;
    const filter = { unread: q.data.unread === 'true', minPriority: q.data.minPriority, kind: q.data.kind };
    const orderBy: Prisma.NotificationOrderByWithRelationInput[] = q.data.sort === 'priority'
      ? [{ alert: { priority: 'desc' } }, { createdAt: 'desc' }, { id: 'desc' }]
      : [{ createdAt: 'desc' }, { id: 'desc' }];
    // A cursor must be one of the caller's own rows. Prisma only needs the id to exist, so check it before using it as an anchor.
    if (q.data.cursor && !(await db.notification.count({ where: { id: q.data.cursor, userId } }))) return reply.code(400).send(bad);
    const rows = await db.notification.findMany({
      where: where(userId, filter), orderBy, take: q.data.limit + 1,
      ...(q.data.cursor ? { cursor: { id: q.data.cursor }, skip: 1 } : {}),
      include: { alert: { select: { id: true, kind: true, priority: true, title: true, body: true, refType: true, refId: true, createdAt: true } } },
    });
    const page = rows.slice(0, q.data.limit);
    return {
      items: page.map((n) => ({ id: n.id, alertId: n.alertId, readAt: n.readAt, createdAt: n.createdAt, kind: n.alert.kind, priority: n.alert.priority, title: n.alert.title, body: n.alert.body, refType: n.alert.refType, refId: n.alert.refId })),
      nextCursor: rows.length > q.data.limit ? page[page.length - 1]!.id : null,
      unreadCount: await db.notification.count({ where: { userId, readAt: null } }),
    };
  });

  // Cheap enough to poll for a badge.
  app.get('/v1/alerts/unread-count', opts, async (req) => {
    const rows = await db.notification.findMany({ where: { userId: req.userId!, readAt: null }, select: { alert: { select: { priority: true } } }, take: 1000 });
    const byPriority: Record<string, number> = { INFO: 0, WATCH: 0, IMPORTANT: 0, CRITICAL: 0 };
    for (const r of rows) byPriority[r.alert.priority]!++;
    // Counting is capped at 1000 rows so a user with a huge backlog cannot make this expensive. `capped` says when the cap was hit.
    return { unread: rows.length, capped: rows.length === 1000, byPriority };
  });

  app.post('/v1/alerts/:id/read', opts, async (req, reply) => {
    const p = Params.safeParse(req.params);
    if (!p.success) return reply.code(400).send(bad);
    const userId = req.userId!;
    const row = await db.notification.findFirst({ where: { id: p.data.id, userId }, select: { id: true, readAt: true } });
    if (!row) return reply.code(404).send({ error: 'NOT_FOUND' });
    // Idempotent: reading twice keeps the first time.
    if (!row.readAt) await db.notification.updateMany({ where: { id: row.id, userId, readAt: null }, data: { readAt: new Date() } });
    return { id: row.id, read: true };
  });

  app.post('/v1/alerts/read-all', opts, async (req, reply) => {
    const b = ReadAllBody.safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send(bad);
    const userId = req.userId!;
    const r = await db.notification.updateMany({ where: where(userId, { unread: true, minPriority: b.data.minPriority, kind: b.data.kind }), data: { readAt: new Date() } });
    return { marked: r.count };
  });
}
