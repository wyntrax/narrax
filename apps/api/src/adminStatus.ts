import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma, PrismaClient } from '@narra/database';
import type { QueueCounts } from '@narra/queue';
import { SYSTEM_LIMITS_KEY, resolveSystemLimits } from '@narra/risk';
import { sanitizeUntrusted } from '@narra/shared';
import { TRADING_PAUSE_KEY, aiEnabled, loadAiConfig, parsePause, tokensUsedToday } from '@narra/worker-pipeline';
import { makeRequireAdmin } from './admin';
import type { AccountDeps } from './account';

const DAY = 86_400_000;
/** SystemSetting key for the admin-entered model prices. Prices are never guessed or built in. */
export const AI_PRICING_KEY = 'ai.pricing';

/** How often each background job should produce something, in minutes, and the multiple of that after which the view calls it stale. */
const EXPECTED_MINUTES = { tokenMetric: 5, portfolioSnapshot: 5, outcomeTracking: 15, positionEvaluation: 60 } as const;
const STALE_AFTER_EXPECTED = 3;
const QUEUE_BACKLOG_WARN = 100;
const BUDGET_WARN_FRACTION = 0.8;

export interface OpsDeps {
  /** Answers whether Redis responds. Absent when the API was started without one. */
  redisPing?: () => Promise<boolean>;
  queueCounts?: () => Promise<Record<string, QueueCounts>>;
  /** Whether the market data job is meant to be running, so its staleness only counts then. */
  marketDataEnabled?: boolean;
}

const PriceSchema = z.object({ inputPer1MUsd: z.number().min(0).max(10_000), outputPer1MUsd: z.number().min(0).max(10_000) }).strict();
const PricesBody = z.object({ prices: z.record(z.string().min(1).max(100).regex(/^[A-Za-z0-9._:/-]+$/), PriceSchema), reason: z.string().min(1).max(1000) }).strict();
type Prices = Record<string, { inputPer1MUsd: number; outputPer1MUsd: number }>;

const num = (v: unknown) => (typeof v === 'bigint' ? Number(v) : typeof v === 'number' ? v : Number(v ?? 0));
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** Admin-only operations views: how the system is doing, and what the AI costs. Read-only except for the price table. */
export function registerAdminStatusRoutes(app: FastifyInstance, deps: Pick<AccountDeps, 'db' | 'verifier' | 'now'> & { ops?: OpsDeps }): void {
  const db: PrismaClient = deps.db;
  const now = deps.now ?? (() => new Date());
  const ops = deps.ops ?? {};
  const opts = { preHandler: makeRequireAdmin(deps), config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };
  const json = (v: unknown) => v as Prisma.InputJsonValue;

  async function timed(fn: () => Promise<unknown>): Promise<{ ok: boolean; latencyMs: number | null }> {
    const t = Date.now();
    try { await fn(); return { ok: true, latencyMs: Date.now() - t }; } catch { return { ok: false, latencyMs: null }; }
  }
  const loadPrices = async (): Promise<Prices> => {
    const v = (await db.systemSetting.findUnique({ where: { key: AI_PRICING_KEY } }))?.value as { prices?: unknown } | null | undefined;
    const parsed = z.record(PriceSchema).safeParse(v?.prices ?? {});
    return parsed.success ? parsed.data : {};
  };

  app.get('/v1/admin/status', opts, async () => {
    const at = now(), since = new Date(at.getTime() - DAY);
    const warnings: string[] = [];
    const dbHealth = await timed(() => db.$queryRaw`SELECT 1`);
    const redis = ops.redisPing ? await timed(async () => { if (!(await ops.redisPing!())) throw new Error('no'); }) : null;
    if (!dbHealth.ok) warnings.push('The database did not answer.');
    if (redis && !redis.ok) warnings.push('Redis did not answer.');

    let queues: Record<string, QueueCounts> | null = null;
    if (ops.queueCounts) {
      try { queues = await ops.queueCounts(); } catch { warnings.push('Queue counts could not be read.'); }
      for (const [name, c] of Object.entries(queues ?? {})) {
        if (c.failed > 0) warnings.push(`Queue ${name} has ${c.failed} failed job(s).`);
        if (c.waiting > QUEUE_BACKLOG_WARN) warnings.push(`Queue ${name} has a backlog of ${c.waiting}.`);
        if (c.waiting > 0 && c.consumers === 0) warnings.push(`Queue ${name} has ${c.waiting} job(s) waiting and no worker consuming it.${name === 'execution' ? ' Start the executor (npm run dev:executor): paper fills, confirmations and dry runs are processed there, not in the pipeline worker.' : ''}`);
      }
    }

    const [users, positions, pendingConfirmations, pendingProposals, blacklisted, adminCount] = await Promise.all([
      db.user.groupBy({ by: ['mode'], _count: { _all: true } }),
      db.position.groupBy({ by: ['simulated'], where: { status: 'OPEN' }, _count: { _all: true } }),
      db.pendingConfirmation.count({ where: { status: 'PENDING', expiresAt: { gt: at } } }),
      db.chatProposal.count({ where: { status: 'PENDING', expiresAt: { gt: at } } }),
      db.token.count({ where: { blacklisted: true } }),
      db.user.count({ where: { isAdmin: true } }),
    ]);
    const openPaper = positions.find((p) => p.simulated)?._count._all ?? 0, openReal = positions.find((p) => !p.simulated)?._count._all ?? 0;
    const paperUsers = users.find((u) => u.mode === 'PAPER')?._count._all ?? 0;

    const [metric, snapshot, evaluation, outcome, decision, oldDecisions] = await Promise.all([
      db.tokenMetric.findFirst({ orderBy: { at: 'desc' }, select: { at: true } }),
      db.portfolioSnapshot.findFirst({ orderBy: { at: 'desc' }, select: { at: true } }),
      db.positionEvaluation.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      db.decisionOutcome.findFirst({ orderBy: { measuredAt: 'desc' }, select: { measuredAt: true } }),
      db.agentDecision.findFirst({ where: { userId: null }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      db.agentDecision.count({ where: { userId: null, createdAt: { lt: new Date(at.getTime() - 3_600_000) } } }),
    ]);
    const fresh = (name: keyof typeof EXPECTED_MINUTES, last: Date | undefined, applicable: boolean, why: string) => {
      const ageSeconds = last ? Math.round((at.getTime() - last.getTime()) / 1000) : null;
      const stale = !applicable ? null : ageSeconds == null ? true : ageSeconds > EXPECTED_MINUTES[name] * STALE_AFTER_EXPECTED * 60;
      if (stale) warnings.push(`${name} looks stale (${ageSeconds == null ? 'never written' : `last ${Math.round(ageSeconds / 60)} min ago`}; expected about every ${EXPECTED_MINUTES[name]} min).`);
      return { lastAt: last ?? null, ageSeconds, expectedEveryMinutes: EXPECTED_MINUTES[name], applicable, stale, appliesWhen: why };
    };
    const freshness = {
      tokenMetric: fresh('tokenMetric', metric?.at, ops.marketDataEnabled !== false, 'market data is enabled'),
      portfolioSnapshot: fresh('portfolioSnapshot', snapshot?.at, paperUsers > 0 || openPaper > 0, 'there are paper users or open paper positions'),
      positionEvaluation: fresh('positionEvaluation', evaluation?.createdAt, openPaper + openReal > 0, 'there are open positions'),
      outcomeTracking: fresh('outcomeTracking', outcome?.measuredAt, oldDecisions > 0, 'there are decisions older than an hour'),
    };

    const [cfg, aiOn, settings, usedAnalysis, chatAgg] = await Promise.all([
      loadAiConfig(db), aiEnabled(db),
      db.systemSetting.findMany({ where: { key: { in: [SYSTEM_LIMITS_KEY, TRADING_PAUSE_KEY] } } }),
      tokensUsedToday(db, at),
      db.chatMessage.aggregate({ where: { role: 'ASSISTANT', createdAt: { gte: new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate())) } }, _sum: { inputTokens: true, outputTokens: true } }),
    ]);
    const get = (k: string) => settings.find((s) => s.key === k)?.value;
    const limits = resolveSystemLimits(get(SYSTEM_LIMITS_KEY)), pause = parsePause(get(TRADING_PAUSE_KEY));
    const usedChat = (chatAgg._sum.inputTokens ?? 0) + (chatAgg._sum.outputTokens ?? 0);
    if (pause.paused) warnings.push(`New entries are paused system-wide${pause.reason ? `: ${pause.reason}` : ''}.`);
    if (!aiOn) warnings.push('AI is switched off.');
    if (limits.invalid.length) warnings.push(`Ignored invalid system limit setting(s): ${limits.invalid.join(', ')}.`);
    if (cfg.tokenBudget > 0 && usedAnalysis >= cfg.tokenBudget * BUDGET_WARN_FRACTION) warnings.push(`Analysis token budget is at ${Math.round((usedAnalysis / cfg.tokenBudget) * 100)}% for today.`);
    if (cfg.chatTokenBudget > 0 && usedChat >= cfg.chatTokenBudget * BUDGET_WARN_FRACTION) warnings.push(`Chat token budget is at ${Math.round((usedChat / cfg.chatTokenBudget) * 100)}% for today.`);

    return {
      time: at, since,
      database: dbHealth, redis: redis ?? { ok: null, latencyMs: null, note: 'not checked' }, queues: queues ?? null, freshness,
      controls: { aiEnabled: aiOn, tradingPause: pause, systemLimitOverrides: limits.overrides, systemLimitsIgnored: limits.invalid },
      counts: { usersByMode: Object.fromEntries(users.map((u) => [u.mode, u._count._all])), openPositions: { paper: openPaper, real: openReal }, pendingConfirmations, pendingChatProposals: pendingProposals, blacklistedTokens: blacklisted, admins: adminCount },
      budgets: { analysis: { usedToday: usedAnalysis, budget: cfg.tokenBudget }, chat: { usedToday: usedChat, budget: cfg.chatTokenBudget, perUserPerDay: cfg.chatTokensPerUserPerDay } },
      warnings,
    };
  });

  app.get('/v1/admin/ai-pricing', opts, async () => ({ prices: await loadPrices() }));

  app.put('/v1/admin/ai-pricing', opts, async (req, reply) => {
    const body = PricesBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const reason = sanitizeUntrusted(body.data.reason, 300);
    if (!reason) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const before = await loadPrices();
    await db.$transaction([
      db.systemSetting.upsert({ where: { key: AI_PRICING_KEY }, create: { key: AI_PRICING_KEY, value: json({ prices: body.data.prices }) }, update: { value: json({ prices: body.data.prices }) } }),
      db.auditLog.create({ data: { userId: req.userId!, action: 'ai_pricing.changed', detail: json({ before, after: body.data.prices, reason }) } }),
    ]);
    return { prices: body.data.prices };
  });

  app.get('/v1/admin/costs', opts, async (req, reply) => {
    const q = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const at = now(), from = new Date(at.getTime() - q.data.days * DAY), prices = await loadPrices();
    const [analysis, review, chat, chatUsers, cfg] = await Promise.all([
      db.$queryRaw<{ day: Date; model: string; inp: bigint; outp: bigint; n: number }[]>`SELECT date_trunc('day', "createdAt") AS day, "model", COALESCE(SUM("inputTokens"),0)::bigint AS inp, COALESCE(SUM("outputTokens"),0)::bigint AS outp, COUNT(*)::int AS n FROM "AgentAnalysis" WHERE "createdAt" >= ${from} GROUP BY 1, 2 ORDER BY 1`,
      db.$queryRaw<{ day: Date; tokens: bigint; n: number }[]>`SELECT date_trunc('day', "createdAt") AS day, COALESCE(SUM("aiTokens"),0)::bigint AS tokens, (COUNT(*) FILTER (WHERE "aiTokens" > 0))::int AS n FROM "PositionEvaluation" WHERE "createdAt" >= ${from} GROUP BY 1 ORDER BY 1`,
      db.$queryRaw<{ day: Date; model: string; inp: bigint; outp: bigint; n: number }[]>`SELECT date_trunc('day', "createdAt") AS day, COALESCE("model", 'unknown') AS model, COALESCE(SUM("inputTokens"),0)::bigint AS inp, COALESCE(SUM("outputTokens"),0)::bigint AS outp, COUNT(*)::int AS n FROM "ChatMessage" WHERE "role" = 'ASSISTANT' AND "createdAt" >= ${from} GROUP BY 1, 2 ORDER BY 1`,
      db.$queryRaw<{ userId: string; tokens: bigint }[]>`SELECT "userId", (COALESCE(SUM("inputTokens"),0) + COALESCE(SUM("outputTokens"),0))::bigint AS tokens FROM "ChatMessage" WHERE "role" = 'ASSISTANT' AND "createdAt" >= ${from} GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
      loadAiConfig(db),
    ]);
    const unpriced = new Set<string>();
    const cost = (model: string, inp: number, outp: number): number | null => {
      const p = prices[model];
      if (!p) { unpriced.add(model); return null; }
      return (inp / 1e6) * p.inputPer1MUsd + (outp / 1e6) * p.outputPer1MUsd;
    };
    type Day = { day: string; analysis: { calls: number; inputTokens: number; outputTokens: number; costUsd: number | null }; reviews: { callsWithAi: number; tokens: number }; chat: { calls: number; inputTokens: number; outputTokens: number; costUsd: number | null } };
    const days = new Map<string, Day>();
    const row = (d: Date): Day => { const k = dayKey(d); let r = days.get(k); if (!r) { r = { day: k, analysis: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }, reviews: { callsWithAi: 0, tokens: 0 }, chat: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 } }; days.set(k, r); } return r; };
    const add = (acc: { costUsd: number | null }, c: number | null) => { acc.costUsd = acc.costUsd == null || c == null ? null : acc.costUsd + c; };
    for (const a of analysis) { const r = row(a.day); r.analysis.calls += a.n; r.analysis.inputTokens += num(a.inp); r.analysis.outputTokens += num(a.outp); add(r.analysis, cost(a.model, num(a.inp), num(a.outp))); }
    for (const v of review) { const r = row(v.day); r.reviews.callsWithAi += v.n; r.reviews.tokens += num(v.tokens); }
    for (const c of chat) { const r = row(c.day); r.chat.calls += c.n; r.chat.inputTokens += num(c.inp); r.chat.outputTokens += num(c.outp); add(r.chat, cost(c.model, num(c.inp), num(c.outp))); }

    const daily = [...days.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
    const sum = (f: (d: Day) => number) => daily.reduce((a, d) => a + f(d), 0);
    const priced = (f: (d: Day) => number | null) => (daily.some((d) => f(d) == null) ? null : sum((d) => f(d) as number));
    const [usedAnalysis, usedChat] = [await tokensUsedToday(db, at), (await db.chatMessage.aggregate({ where: { role: 'ASSISTANT', createdAt: { gte: new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate())) } }, _sum: { inputTokens: true, outputTokens: true } }))._sum];
    return {
      range: { from, to: at, days: q.data.days }, daily,
      totals: {
        analysisTokens: sum((d) => d.analysis.inputTokens + d.analysis.outputTokens), reviewTokens: sum((d) => d.reviews.tokens), chatTokens: sum((d) => d.chat.inputTokens + d.chat.outputTokens),
        analysisCostUsd: priced((d) => d.analysis.costUsd), chatCostUsd: priced((d) => d.chat.costUsd),
      },
      modelsWithoutPrice: [...unpriced].sort(),
      topChatUsers: chatUsers.map((u) => ({ userId: u.userId, tokens: num(u.tokens) })),
      budgets: { analysis: { usedToday: usedAnalysis, budget: cfg.tokenBudget }, chat: { usedToday: (usedChat.inputTokens ?? 0) + (usedChat.outputTokens ?? 0), budget: cfg.chatTokenBudget, perUserPerDay: cfg.chatTokensPerUserPerDay } },
      notes: [
        'Costs are estimates: tokens times the prices an admin entered (PUT /v1/admin/ai-pricing). A model with no price shows a null cost and is listed in modelsWithoutPrice. Prices are never guessed.',
        'Position reviews record one combined token count, so their cost cannot be estimated from input and output prices. Only tokens are shown.',
        'Chat messages written before the model was recorded show as model "unknown" and cannot be priced.',
        'Provider invoices are the source of truth. This is for watching trends and budgets.',
      ],
    };
  });
}
