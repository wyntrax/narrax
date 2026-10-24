import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma, PrismaClient } from '@narra/database';
import type { LlmProvider } from '@narra/ai';
import { AGENT_LIMITS, TIGHTENABLE_FIELDS, describeTighten, runAgent, sanitizeUserText, validateTighten, type TightenableField } from '@narra/agent';
import { aiEnabled, loadAiConfig } from '@narra/worker-pipeline';
import { makeAuthenticate, type AccountDeps } from './account';
import { effectiveLimits, makeAgentPorts } from './chatPorts';
import { researchPorts } from './entitlements/chatAccess';

const Body = z.object({ conversationId: z.string().min(1).max(64).optional(), message: z.string().min(1).max(AGENT_LIMITS.maxUserMessageChars) }).strict();
const IdParams = z.object({ id: z.string().min(1).max(64) });
const ListQuery = z.object({ status: z.enum(['PENDING', 'ALL']).default('PENDING'), limit: z.coerce.number().int().min(1).max(50).default(20) });
const Page = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) });

const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export interface ChatDeps extends Pick<AccountDeps, 'db' | 'verifier' | 'now'> {
  /** Null when no model provider is configured: chat then answers 503 and nothing else changes. */
  llm: LlmProvider | null;
  /** Chat questions allowed per minute per client address. Tests raise it; production keeps the default. */
  questionsPerMinute?: number;
}

class ApplyError extends Error { constructor(readonly code: 'NOT_PENDING' | 'NO_LONGER_STRICTER') { super(code); } }

/**
 * Agent chat. The agent reads data and may suggest caution; it has no way to trade (see packages/agent). A suggestion becomes
 * real only when the signed-in user applies it with a separate request, and applying re-checks it against their current settings.
 */
export function registerChatRoutes(app: FastifyInstance, deps: ChatDeps): void {
  const db: PrismaClient = deps.db;
  const now = deps.now ?? (() => new Date());
  const ports = makeAgentPorts(db, now);
  const auth = makeAuthenticate(deps);
  const opts = { preHandler: auth, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };
  const chatOpts = { preHandler: auth, config: { rateLimit: { max: deps.questionsPerMinute ?? 20, timeWindow: '1 minute' } } };
  const busy = new Set<string>(); // one question at a time per user, per process
  const audit = (userId: string, action: string, detail: Prisma.InputJsonValue) => db.auditLog.create({ data: { userId, action, detail } });

  app.post('/v1/chat', chatOpts, async (req, reply) => {
    const body = Body.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const message = sanitizeUserText(body.data.message);
    if (!message) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const userId = req.userId!, at = now();
    if (!deps.llm || !(await aiEnabled(db))) return reply.code(503).send({ error: 'CHAT_UNAVAILABLE' });
    if (busy.has(userId)) return reply.code(429).send({ error: 'CHAT_BUSY' });
    busy.add(userId);
    try {
      const cfg = await loadAiConfig(db), since = startOfUtcDay(at);
      const sum = (a: { _sum: { inputTokens: number | null; outputTokens: number | null } }) => (a._sum.inputTokens ?? 0) + (a._sum.outputTokens ?? 0);
      const [all, mine, sent] = await Promise.all([
        db.chatMessage.aggregate({ where: { role: 'ASSISTANT', createdAt: { gte: since } }, _sum: { inputTokens: true, outputTokens: true } }),
        db.chatMessage.aggregate({ where: { userId, role: 'ASSISTANT', createdAt: { gte: since } }, _sum: { inputTokens: true, outputTokens: true } }),
        db.chatMessage.count({ where: { userId, role: 'USER', createdAt: { gte: since } } }),
      ]);
      if (sum(all) >= cfg.chatTokenBudget) return reply.code(429).send({ error: 'CHAT_BUDGET_EXHAUSTED' });
      if (sum(mine) >= cfg.chatTokensPerUserPerDay) return reply.code(429).send({ error: 'CHAT_USER_BUDGET_EXHAUSTED' });
      if (sent >= AGENT_LIMITS.maxUserMessagesPerDay) return reply.code(429).send({ error: 'CHAT_DAILY_LIMIT' });

      let conversationId = body.data.conversationId ?? null, history: { role: 'user' | 'assistant'; text: string }[] = [];
      if (conversationId) {
        const conv = await db.chatConversation.findFirst({ where: { id: conversationId, userId }, select: { id: true } });
        if (!conv) return reply.code(404).send({ error: 'NOT_FOUND' });
        if ((await db.chatMessage.count({ where: { conversationId } })) >= AGENT_LIMITS.maxMessagesPerConversation) return reply.code(409).send({ error: 'CONVERSATION_FULL' });
        const prior = await db.chatMessage.findMany({ where: { conversationId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: AGENT_LIMITS.historyMessages });
        history = prior.reverse().map((m) => ({ role: m.role === 'USER' ? 'user' : 'assistant', text: m.content }));
      } else conversationId = (await db.chatConversation.create({ data: { userId } })).id;

      await db.chatMessage.create({ data: { conversationId, userId, role: 'USER', content: message, createdAt: at } });
      const result = await runAgent({ llm: deps.llm, model: cfg.fastModel, temperature: cfg.temperature, maxTokens: cfg.maxTokensPerCall, ports: researchPorts(ports, db, userId, now, entry => req.log.info(entry, 'research access decision')), ctx: { userId, now: at, conversationId }, userMessage: message, history });
      // The user sees a fixed fallback. The operator needs the reason (bad key, wrong base URL, unknown model id), so it is logged here: fixed provider text only, never a body or key.
      if (result.llmError) req.log.warn({ llmError: result.llmError, model: cfg.fastModel }, 'chat model call failed');
      await db.$transaction([
        db.chatMessage.create({
          data: {
            conversationId, userId, role: 'ASSISTANT', content: result.text, inputTokens: result.inputTokens, outputTokens: result.outputTokens, model: cfg.fastModel, createdAt: new Date(now().getTime() + 1),
            meta: { toolsUsed: result.toolsUsed, refusedCalls: result.refusedCalls, stopReason: result.stopReason, ...(result.llmError ? { llmError: result.llmError } : {}), proposalIds: result.proposals.map((p) => p.id) } as Prisma.InputJsonValue,
          },
        }),
        db.chatConversation.update({ where: { id: conversationId }, data: { updatedAt: now() } }),
      ]);
      return {
        conversationId, reply: { text: result.text, format: 'text' as const }, toolsUsed: result.toolsUsed, stopReason: result.stopReason,
        proposals: result.proposals.map((p) => ({ id: p.id, kind: p.kind, field: p.field, fromValue: p.fromValue, value: p.value, summary: p.summary, reason: p.reason, expiresAt: p.expiresAt })),
      };
    } finally { busy.delete(userId); }
  });

  app.get('/v1/chat/conversations', opts, async (req, reply) => {
    const q = Page.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const rows = await db.chatConversation.findMany({ where: { userId: req.userId! }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: q.data.limit });
    return { items: rows.map((c) => ({ id: c.id, createdAt: c.createdAt, updatedAt: c.updatedAt })) };
  });

  app.get('/v1/chat/conversations/:id', opts, async (req, reply) => {
    const p = IdParams.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const conv = await db.chatConversation.findFirst({ where: { id: p.data.id, userId: req.userId! } });
    if (!conv) return reply.code(404).send({ error: 'NOT_FOUND' });
    const rows = await db.chatMessage.findMany({ where: { conversationId: conv.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: AGENT_LIMITS.maxMessagesPerConversation });
    return { id: conv.id, messages: rows.map((m) => ({ id: m.id, role: m.role, text: m.content, format: 'text' as const, createdAt: m.createdAt })) };
  });

  app.get('/v1/chat/proposals', opts, async (req, reply) => {
    const q = ListQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const at = now();
    const rows = await db.chatProposal.findMany({ where: { userId: req.userId!, ...(q.data.status === 'PENDING' ? { status: 'PENDING', expiresAt: { gt: at } } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: q.data.limit });
    return {
      items: rows.map((r) => ({
        id: r.id, kind: r.kind, field: r.field, fromValue: r.fromValue, value: r.value, reason: r.reason, expiresAt: r.expiresAt, createdAt: r.createdAt,
        status: r.status === 'PENDING' && r.expiresAt <= at ? 'EXPIRED' : r.status,
        summary: r.kind === 'PAUSE_AGENT' ? 'Pause the agent' : describeTighten(r.field as TightenableField, r.fromValue ?? 0, r.value ?? 0),
      })),
    };
  });

  app.post('/v1/chat/proposals/:id/apply', opts, async (req, reply) => {
    const p = IdParams.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const userId = req.userId!, at = now();
    const row = await db.chatProposal.findFirst({ where: { id: p.data.id, userId } });
    if (!row) return reply.code(404).send({ error: 'NOT_FOUND' });
    try {
      await db.$transaction(async (tx) => {
        // The claim is one conditional UPDATE: of any number of simultaneous applies exactly one matches, and none matches after expiry.
        const claim = await tx.chatProposal.updateMany({ where: { id: row.id, userId, status: 'PENDING', expiresAt: { gt: at } }, data: { status: 'APPLIED', resolvedAt: at } });
        if (claim.count === 0) throw new ApplyError('NOT_PENDING');
        if (row.kind === 'PAUSE_AGENT') {
          await tx.tradingPermission.upsert({ where: { userId }, create: { userId, agentPaused: true }, update: { agentPaused: true } });
        } else {
          const field = row.field;
          if (!field || !(TIGHTENABLE_FIELDS as string[]).includes(field)) throw new ApplyError('NO_LONGER_STRICTER');
          const profile = await tx.riskProfile.findUnique({ where: { userId } });
          const current = effectiveLimits(profile);
          // Checked again against what the settings are now, not what they were when the agent suggested it.
          if (!validateTighten(field, row.value, current[field as TightenableField]).ok) throw new ApplyError('NO_LONGER_STRICTER');
          const next = { ...current, [field]: row.value! };
          await tx.riskProfile.upsert({ where: { userId }, create: { userId, preset: 'CUSTOM', ...next }, update: { preset: 'CUSTOM', [field]: row.value! } });
        }
        await tx.auditLog.create({ data: { userId, action: 'chat_proposal.applied', detail: { proposalId: row.id, kind: row.kind, field: row.field, from: row.fromValue, to: row.value } as Prisma.InputJsonValue } });
      });
    } catch (e) {
      if (!(e instanceof ApplyError)) throw e;
      if (e.code === 'NO_LONGER_STRICTER') {
        await db.chatProposal.updateMany({ where: { id: row.id, userId, status: 'PENDING' }, data: { status: 'REJECTED', resolvedAt: at } });
        return reply.code(409).send({ error: 'NO_LONGER_STRICTER' });
      }
      const latest = await db.chatProposal.findFirst({ where: { id: row.id, userId } });
      return latest && latest.status === 'PENDING' && latest.expiresAt <= at ? reply.code(410).send({ error: 'EXPIRED' }) : reply.code(409).send({ error: 'NOT_PENDING', status: latest?.status });
    }
    return { id: row.id, status: 'APPLIED' };
  });

  app.post('/v1/chat/proposals/:id/reject', opts, async (req, reply) => {
    const p = IdParams.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const userId = req.userId!;
    const row = await db.chatProposal.findFirst({ where: { id: p.data.id, userId } });
    if (!row) return reply.code(404).send({ error: 'NOT_FOUND' });
    const done = await db.chatProposal.updateMany({ where: { id: row.id, userId, status: 'PENDING' }, data: { status: 'REJECTED', resolvedAt: now() } });
    if (done.count === 0) return reply.code(409).send({ error: 'NOT_PENDING', status: row.status });
    await audit(userId, 'chat_proposal.rejected', { proposalId: row.id });
    return { id: row.id, status: 'REJECTED' };
  });
}
