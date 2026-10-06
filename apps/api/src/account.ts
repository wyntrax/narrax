import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Prisma, PrismaClient } from '@narra/database';
import { GLOBAL_LIMITS, PROFILES } from '@narra/risk';
import { TradingMode } from '@narra/shared';
import type { AuthVerifier } from './auth';

declare module 'fastify' {
  interface FastifyRequest { userId?: string }
}

export interface AccountDeps {
  verifier: AuthVerifier;
  db: PrismaClient;
  now?: () => Date;
}

const AUTOMATED = new Set(['SEMI_AUTO', 'AUTO']);
const ModeBody = z.object({ mode: TradingMode });
const AiAccessBody = z.object({ enabled: z.boolean() });
const RiskBody = z.object({
  preset: z.enum(['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE', 'CUSTOM']),
  maxPerTradeSol: z.number().positive().optional(),
  maxDailyAllocationSol: z.number().positive().optional(),
  maxTokenExposurePct: z.number().min(0).max(100).optional(),
  maxOpenPositions: z.number().int().positive().optional(),
  maxDailyLossPct: z.number().min(0).max(100).optional(),
  minConfidence: z.number().min(0).max(1).optional(),
});

/**
 * Finds the user for a verified Privy id, creating it on first sight. Database trouble throws, so an outage is a 500 and
 * does not look like a logout. Shared by the HTTP pre-handler and the WebSocket gateway.
 */
export async function resolveUserId(db: PrismaClient, privyUserId: string): Promise<string> {
  const find = () => db.user.findUnique({ where: { privyUserId }, select: { id: true } });
  let user = await find();
  if (!user) {
    try {
      user = await db.user.create({ data: { privyUserId }, select: { id: true } });
    } catch (e) {
      if ((e as { code?: string }).code !== 'P2002') throw e; // two first requests raced; the other one created it
      user = await find();
    }
  }
  return user!.id;
}

/** Pre-handler that verifies the bearer token and resolves (or creates) the user. Sets req.userId. */
export function makeAuthenticate(deps: Pick<AccountDeps, 'verifier' | 'db'>) {
  const { db, verifier } = deps;
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) return reply.code(401).send({ error: 'UNAUTHORIZED' });
    let privyUserId: string;
    try {
      ({ privyUserId } = await verifier.verify(token));
    } catch {
      return reply.code(401).send({ error: 'UNAUTHORIZED' });
    }
    req.userId = await resolveUserId(db, privyUserId);
  };
}

export function registerAccountRoutes(app: FastifyInstance, deps: AccountDeps): void {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());

  const authenticate = makeAuthenticate(deps);

  const audit = (userId: string, action: string, detail?: Prisma.InputJsonValue) =>
    db.auditLog.create({ data: { userId, action, detail } });

  const aiEnabled = (p: { aiTradingEnabled: boolean; revokedAt: Date | null; delegatedUntil: Date | null } | null) =>
    !!p && p.aiTradingEnabled && !p.revokedAt && (!p.delegatedUntil || p.delegatedUntil > now());

  const routeOpts = { preHandler: authenticate, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };

  app.get('/v1/me', routeOpts, async (req) => {
    const user = await db.user.findUniqueOrThrow({ where: { id: req.userId! }, include: { permission: true, riskProfile: true } });
    return { id: user.id, mode: user.mode, aiTradingEnabled: aiEnabled(user.permission), agentPaused: user.permission?.agentPaused ?? false, riskPreset: user.riskProfile?.preset ?? null };
  });

  app.put('/v1/mode', routeOpts, async (req, reply) => {
    const body = ModeBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const userId = req.userId!;
    const permission = await db.tradingPermission.findUnique({ where: { userId } });
    if (AUTOMATED.has(body.data.mode) && !aiEnabled(permission)) return reply.code(409).send({ error: 'AI_ACCESS_REQUIRED' });
    await db.$transaction([db.user.update({ where: { id: userId }, data: { mode: body.data.mode } }), audit(userId, 'mode.changed', { mode: body.data.mode })]);
    return { mode: body.data.mode };
  });

  app.put('/v1/ai-access', routeOpts, async (req, reply) => {
    const body = AiAccessBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const userId = req.userId!;
    const { enabled } = body.data;
    // Turning access off also drops automated modes, so the UI can never show Auto with access off.
    const ops = [
      db.tradingPermission.upsert({
        where: { userId },
        create: { userId, aiTradingEnabled: enabled, revokedAt: enabled ? null : now() },
        update: { aiTradingEnabled: enabled, revokedAt: enabled ? null : now() },
      }),
      ...(enabled ? [] : [db.user.updateMany({ where: { id: userId, mode: { in: ['SEMI_AUTO', 'AUTO'] } }, data: { mode: 'SHADOW' } })]),
      audit(userId, enabled ? 'ai_access.enabled' : 'ai_access.disabled'),
    ];
    await db.$transaction(ops);
    return { aiTradingEnabled: enabled };
  });

  // Emergency controls: deliberately simple, no preconditions, always available once signed in.
  app.post('/v1/ai-access/revoke', routeOpts, async (req) => {
    const userId = req.userId!;
    await db.$transaction([
      db.tradingPermission.upsert({ where: { userId }, create: { userId, aiTradingEnabled: false, revokedAt: now() }, update: { aiTradingEnabled: false, revokedAt: now() } }),
      db.user.update({ where: { id: userId }, data: { mode: 'SHADOW' } }),
      audit(userId, 'ai_access.revoked'),
    ]);
    return { aiTradingEnabled: false, mode: 'SHADOW' };
  });

  for (const [path, paused] of [['/v1/agent/pause', true], ['/v1/agent/resume', false]] as const) {
    app.post(path, routeOpts, async (req) => {
      const userId = req.userId!;
      await db.$transaction([
        db.tradingPermission.upsert({ where: { userId }, create: { userId, agentPaused: paused }, update: { agentPaused: paused } }),
        audit(userId, paused ? 'agent.paused' : 'agent.resumed'),
      ]);
      return { agentPaused: paused };
    });
  }

  app.put('/v1/risk-profile', routeOpts, async (req, reply) => {
    const body = RiskBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const b = body.data;
    let values;
    if (b.preset === 'CUSTOM') {
      const { maxPerTradeSol, maxDailyAllocationSol, maxTokenExposurePct, maxOpenPositions, maxDailyLossPct, minConfidence } = b;
      if ([maxPerTradeSol, maxDailyAllocationSol, maxTokenExposurePct, maxOpenPositions, maxDailyLossPct, minConfidence].some((v) => v === undefined)) {
        return reply.code(400).send({ error: 'CUSTOM_REQUIRES_ALL_LIMITS' });
      }
      const g = GLOBAL_LIMITS;
      const over = [
        maxPerTradeSol! > g.maxPerTradeSol && 'maxPerTradeSol', maxDailyAllocationSol! > g.maxDailyAllocationSol && 'maxDailyAllocationSol',
        maxTokenExposurePct! > g.maxTokenExposurePct && 'maxTokenExposurePct', maxOpenPositions! > g.maxOpenPositions && 'maxOpenPositions',
        maxDailyLossPct! > g.maxDailyLossPct && 'maxDailyLossPct', minConfidence! < g.minConfidence && 'minConfidence',
      ].filter(Boolean);
      if (over.length) return reply.code(400).send({ error: 'EXCEEDS_SYSTEM_LIMITS', fields: over });
      values = { maxPerTradeSol: maxPerTradeSol!, maxDailyAllocationSol: maxDailyAllocationSol!, maxTokenExposurePct: maxTokenExposurePct!, maxOpenPositions: maxOpenPositions!, maxDailyLossPct: maxDailyLossPct!, minConfidence: minConfidence! };
    } else {
      const p = PROFILES[b.preset];
      values = { maxPerTradeSol: p.maxPerTradeSol, maxDailyAllocationSol: p.maxDailyAllocationSol, maxTokenExposurePct: p.maxTokenExposurePct, maxOpenPositions: p.maxOpenPositions, maxDailyLossPct: p.maxDailyLossPct, minConfidence: p.minConfidence };
    }
    const userId = req.userId!;
    await db.$transaction([
      db.riskProfile.upsert({ where: { userId }, create: { userId, preset: b.preset, ...values }, update: { preset: b.preset, ...values } }),
      audit(userId, 'risk_profile.changed', { preset: b.preset }),
    ]);
    return { preset: b.preset, ...values };
  });
}
