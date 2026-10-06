import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { PrismaClient } from '@narra/database';
import { AiConfigSchema } from '@narra/ai';
import { aiEnabled, loadAiConfig, saveAiConfig, setAiEnabled, tokensUsedToday } from '@narra/worker-pipeline';
import { KILL_SWITCH_KEY, KillSwitchValue, interpretKillSwitch } from '@narra/trading';
import { makeAuthenticate, type AccountDeps } from './account';
import { IdCursor, Limit } from './paging';

/** Pre-handler that requires a signed-in admin. Shared by every admin route. */
export function makeRequireAdmin(deps: Pick<AccountDeps, 'db' | 'verifier'>) {
  const authenticate = makeAuthenticate(deps);
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const denied = await authenticate(req, reply);
    if (denied || reply.sent) return denied;
    const u = await deps.db.user.findUnique({ where: { id: req.userId! }, select: { isAdmin: true } });
    if (!u?.isAdmin) return reply.code(403).send({ error: 'FORBIDDEN' });
  };
}

/** Admin-only settings. Model names and limits are editable. API keys are not settings and never pass through here. */
export interface ConnectionStatus {
  /** Provider name, for example helius or privy. */
  name: string;
  /** True when every setting the provider needs is present. The value of a setting is never part of this. */
  configured: boolean;
  /** What the provider is used for, in plain words. */
  purpose: string;
}

export function registerAdminRoutes(app: FastifyInstance, deps: Pick<AccountDeps, 'db' | 'verifier'> & { /** Reports which external providers are configured. */ connections?: () => ConnectionStatus[] }): void {
  const db: PrismaClient = deps.db;
  const requireAdmin = makeRequireAdmin(deps);
  const opts = { preHandler: requireAdmin, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };

  // Which external providers are set up, as yes or no. Keys and URLs are server-side secrets and are never returned, so there is
  // nothing here to leak and nothing to edit; this only answers "is it configured".
  app.get('/v1/admin/connections', opts, async () => ({ items: (deps.connections?.() ?? []).map((c) => ({ name: c.name, configured: c.configured === true, purpose: c.purpose })) }));

  // The executor reads this before every order. Turning it on stops all executor activity at the next order, entries and exits alike.
  // No row means it was never touched, and a row that cannot be read counts as ON (see interpretKillSwitch).
  app.get('/v1/admin/executor/kill-switch', opts, async () => {
    const row = await db.systemSetting.findUnique({ where: { key: KILL_SWITCH_KEY } });
    const state = interpretKillSwitch(row?.value);
    const v = KillSwitchValue.safeParse(row?.value);
    return { tripped: state.tripped, reason: state.reason, malformed: state.malformed, by: v.success ? v.data.by ?? null : null, at: v.success ? v.data.at ?? null : null };
  });

  app.put('/v1/admin/executor/kill-switch', opts, async (req, reply) => {
    const body = z.object({ enabled: z.boolean(), reason: z.string().trim().min(1).max(200).optional() }).strict().safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    // Switching it ON needs no justification beyond the click, but a reason is kept when given. Switching it OFF must say why.
    if (!body.data.enabled && !body.data.reason) return reply.code(400).send({ error: 'REASON_REQUIRED' });
    const value = { enabled: body.data.enabled, reason: body.data.reason ?? null, by: req.userId!, at: new Date().toISOString() };
    await db.$transaction([
      db.systemSetting.upsert({ where: { key: KILL_SWITCH_KEY }, create: { key: KILL_SWITCH_KEY, value }, update: { value } }),
      db.auditLog.create({ data: { userId: req.userId!, action: 'executor.kill_switch.changed', detail: { enabled: value.enabled, reason: value.reason } } }),
    ]);
    return { tripped: value.enabled, reason: value.reason, by: value.by, at: value.at };
  });

  // What the executor would have sent, and why it was accepted or refused. Read-only. This is what the owner reviews before B5b.
  app.get('/v1/admin/dry-runs', opts, async (req, reply) => {
    const q = z.object({ limit: Limit, cursor: IdCursor.optional(), outcome: z.enum(['ACCEPTED', 'REJECTED', 'ERROR']).optional(), userId: IdCursor.optional() }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    if (q.data.cursor && !(await db.dryRun.count({ where: { id: q.data.cursor } }))) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const rows = await db.dryRun.findMany({
      where: { ...(q.data.outcome ? { outcome: q.data.outcome } : {}), ...(q.data.userId ? { userId: q.data.userId } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: q.data.limit + 1, ...(q.data.cursor ? { cursor: { id: q.data.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, q.data.limit);
    return {
      items: page.map((r) => ({ id: r.id, createdAt: r.createdAt, userId: r.userId, side: r.side, mint: r.mint, sizeSol: r.sizeSol === null ? null : Number(r.sizeSol.toString()), outcome: r.outcome, reasons: r.reasons, summary: r.summary, simulation: r.simulation, messageHash: r.messageHash, confirmationId: r.confirmationId })),
      nextCursor: rows.length > q.data.limit ? page[page.length - 1]!.id : null,
    };
  });

  app.get('/v1/admin/ai-models', opts, async () => ({ config: await loadAiConfig(db), enabled: await aiEnabled(db), tokensUsedToday: await tokensUsedToday(db, new Date()) }));

  app.put('/v1/admin/ai-models', opts, async (req, reply) => {
    // strict: an unknown field such as apiKey is refused, not silently stored
    const body = AiConfigSchema.strict().safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'INVALID_INPUT', fields: [...new Set(body.error.issues.flatMap((i) => (i.path.length ? [i.path.join('.')] : (i as { keys?: string[] }).keys ?? [])))] });
    await saveAiConfig(db, body.data);
    await db.auditLog.create({ data: { userId: req.userId!, action: 'ai_config.changed', detail: { fastModel: body.data.fastModel, reasoningModel: body.data.reasoningModel, judgeModel: body.data.judgeModel } } });
    return { config: body.data };
  });

  app.put('/v1/admin/ai-enabled', opts, async (req, reply) => {
    const body = z.object({ enabled: z.boolean() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    await setAiEnabled(db, body.data.enabled);
    await db.auditLog.create({ data: { userId: req.userId!, action: body.data.enabled ? 'ai.enabled' : 'ai.disabled' } });
    return { enabled: body.data.enabled };
  });
}
