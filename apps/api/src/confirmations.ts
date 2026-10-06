import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma, PrismaClient } from '@narra/database';
import { ExecutionJobSchema, type ExecutionJob } from '@narra/queue';
import { confirmKey, effectiveStatus } from '@narra/trading';
import { makeAuthenticate, type AccountDeps } from './account';

const Query = z.object({ status: z.enum(['PENDING', 'ALL']).default('ALL'), limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/).optional() });
const Params = z.object({ id: z.string().min(1).max(64) });
const num = (v: { toString(): string }) => Number(v.toString());

export interface ConfirmationDeps extends Pick<AccountDeps, 'db' | 'verifier' | 'now'> {
  /** Puts a confirmed job on the execution queue, using its idempotency key as the job id. */
  enqueueExecution?: (job: ExecutionJob) => Promise<unknown>;
}

/**
 * Semi-auto confirmations. Every query is scoped to the signed-in user, so another user's id is a plain 404.
 * Confirming does NOT trade. It claims the confirmation once, atomically, and queues a job. The execution worker then
 * re-runs the Risk Governor with a fresh quote and fresh state, and only then could an Executor act (none exists yet).
 */
export function registerConfirmationRoutes(app: FastifyInstance, deps: ConfirmationDeps): void {
  const db: PrismaClient = deps.db;
  const now = deps.now ?? (() => new Date());
  const opts = { preHandler: makeAuthenticate(deps), config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };
  const audit = (userId: string, action: string, detail: Prisma.InputJsonValue) => db.auditLog.create({ data: { userId, action, detail } });

  app.get('/v1/confirmations', opts, async (req, reply) => {
    const q = Query.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const at = now();
    // A cursor must be one of the caller's own rows.
    if (q.data.cursor && !(await db.pendingConfirmation.count({ where: { id: q.data.cursor, userId: req.userId! } }))) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const found = await db.pendingConfirmation.findMany({
      where: { userId: req.userId!, ...(q.data.status === 'PENDING' ? { status: 'PENDING', expiresAt: { gt: at } } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: q.data.limit + 1,
      ...(q.data.cursor ? { cursor: { id: q.data.cursor }, skip: 1 } : {}),
    });
    const rows = found.slice(0, q.data.limit);
    const tokens = await db.token.findMany({ where: { mint: { in: [...new Set(rows.map((r) => r.mint))] } }, select: { mint: true, symbol: true } });
    const symbol = new Map(tokens.map((t) => [t.mint, t.symbol]));
    return {
      nextCursor: found.length > q.data.limit ? rows[rows.length - 1]!.id : null,
      items: rows.map((r) => {
        const quote = r.quote as { priceImpactPct?: number; slippageBps?: number };
        return {
          id: r.id, kind: r.kind, status: effectiveStatus(r, at), result: r.result, mint: r.mint, symbol: symbol.get(r.mint) ?? null,
          sizeSol: num(r.sizeSol), exitFraction: r.exitFraction, priceImpactPct: quote.priceImpactPct ?? null, slippageBps: quote.slippageBps ?? null,
          createdAt: r.createdAt, expiresAt: r.expiresAt,
        };
      }),
    };
  });

  app.post('/v1/confirmations/:id/confirm', opts, async (req, reply) => {
    const p = Params.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    if (!deps.enqueueExecution) return reply.code(503).send({ error: 'EXECUTION_QUEUE_UNAVAILABLE' });
    const userId = req.userId!;
    const at = now();

    // The claim is one conditional UPDATE. Of any number of simultaneous confirms exactly one matches, and nothing
    // matches once the confirmation is expired, so a late or repeated confirm cannot queue a second job.
    const claimed = await db.pendingConfirmation.updateMany({ where: { id: p.data.id, userId, status: 'PENDING', expiresAt: { gt: at } }, data: { status: 'CLAIMED', claimedAt: at } });
    if (claimed.count === 0) {
      const row = await db.pendingConfirmation.findFirst({ where: { id: p.data.id, userId } });
      if (!row) return reply.code(404).send({ error: 'NOT_FOUND' });
      const status = effectiveStatus(row, at);
      return status === 'EXPIRED' ? reply.code(410).send({ error: 'EXPIRED' }) : reply.code(409).send({ error: 'NOT_PENDING', status });
    }

    const row = await db.pendingConfirmation.findFirstOrThrow({ where: { id: p.data.id, userId } });
    const job = ExecutionJobSchema.safeParse({ ...(row.job as object), idempotencyKey: confirmKey(row.id), confirmationId: row.id });
    const release = () => db.pendingConfirmation.updateMany({ where: { id: row.id, userId, status: 'CLAIMED', result: null }, data: { status: 'PENDING', claimedAt: null } });
    if (!job.success || job.data.userId !== userId) {
      await release();
      return reply.code(500).send({ error: 'CONFIRMATION_CORRUPT' });
    }
    try {
      await deps.enqueueExecution(job.data);
    } catch {
      // Nothing was queued, so put it back. If the queue did take the job, a retry reuses the same job id and is ignored.
      await release();
      return reply.code(503).send({ error: 'EXECUTION_QUEUE_UNAVAILABLE' });
    }
    await audit(userId, 'confirmation.confirmed', { confirmationId: row.id, kind: row.kind });
    return reply.code(202).send({ id: row.id, status: 'CLAIMED' });
  });

  app.post('/v1/confirmations/:id/reject', opts, async (req, reply) => {
    const p = Params.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const userId = req.userId!;
    const at = now();
    const row = await db.pendingConfirmation.findFirst({ where: { id: p.data.id, userId } });
    if (!row) return reply.code(404).send({ error: 'NOT_FOUND' });
    const claimed = await db.pendingConfirmation.updateMany({ where: { id: row.id, userId, status: 'PENDING' }, data: { status: 'REJECTED', resolvedAt: at } });
    if (claimed.count === 0) return reply.code(409).send({ error: 'NOT_PENDING', status: effectiveStatus(row, at) });
    // A user's "no" on an exit is final for that evaluation: 'rejected_by_user' is not retried, unlike a Governor rejection.
    if (row.evaluationId) await db.positionExit.updateMany({ where: { evaluationId: row.evaluationId, outcome: 'awaiting_confirmation' }, data: { outcome: 'rejected_by_user' } });
    await audit(userId, 'confirmation.rejected', { confirmationId: row.id, kind: row.kind });
    return { id: row.id, status: 'REJECTED' };
  });
}
