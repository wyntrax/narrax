import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@narra/database';
import { PersonalBriefsSchema, PRO_RESEARCH_LIMITS, ResearchMonitorInputSchema, ResearchMonitorsSchema } from '@narra/shared';
import { personalResearchLock } from '@narra/worker-pipeline';
import { makeAuthenticate, type AccountDeps } from './account';
import { entitlementTrace } from './entitlements/access';

export async function personalPermissions(db: AccountDeps['db'], userId: string, now: Date) {
  const trace = await entitlementTrace(db, userId, now);
  return { radar: trace.features['research.personal_radar'].allowed, thesis: trace.features['research.thesis_tracker'].allowed, briefing: trace.features['research.personal_briefing'].allowed };
}

export function registerPersonalResearchRoutes(app: FastifyInstance, deps: Pick<AccountDeps, 'db' | 'verifier' | 'now' | 'requestPersonalResearch'>) {
  const { db } = deps, clock = deps.now ?? (() => new Date());
  const opts = { preHandler: makeAuthenticate(deps), config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };
  const params = z.object({ id: z.string().min(1).max(128) });
  const requestCheck = async (userId: string) => {
    if (!deps.requestPersonalResearch) return false;
    await deps.requestPersonalResearch(userId);
    return true;
  };
  for (const [path, kind] of [['radars', 'RADAR'], ['theses', 'THESIS']] as const) {
    const base = `/v1/personal-research/${path}`;
    app.get(base, opts, async req => {
      const rows = await db.researchMonitor.findMany({ where: { userId: req.userId!, kind }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: PRO_RESEARCH_LIMITS.monitorsPerKind,
        include: { observations: { orderBy: [{ at: 'desc' }, { id: 'desc' }], take: 20 } } });
      return ResearchMonitorsSchema.parse({ items: rows.map(row => ({ ...row, updatedAt: row.updatedAt.toISOString(), observations: row.observations.filter(o => o.revision === row.revision).map(o => ({ ...o, at: o.at.toISOString() })) })) });
    });
    for (const method of ['post', 'put'] as const) app[method](method === 'post' ? base : `${base}/:id`, opts, async (req, reply) => {
      const input = ResearchMonitorInputSchema.safeParse(req.body), id = method === 'put' ? params.safeParse(req.params) : null;
      if (!input.success || (id && !id.success) || (kind === 'THESIS' && input.success && (!input.data.mint || !input.data.thesis.trim()))) return reply.code(400).send({ error: 'INVALID_INPUT' });
      const result = await db.$transaction(async tx => {
        await personalResearchLock(tx, req.userId!);
        const where = { userId: req.userId!, kind };
        const current = id?.success ? await tx.researchMonitor.findFirst({ where: { ...where, id: id.data.id } }) : null;
        if (method === 'put' && !current) return { error: 'NOT_FOUND', status: 404 };
        if (!current && await tx.researchMonitor.count({ where }) >= PRO_RESEARCH_LIMITS.monitorsPerKind) return { error: 'MONITOR_LIMIT', status: 409 };
        if (input.data.narrativeSlug && !await tx.narrative.count({ where: { slug: input.data.narrativeSlug } })) return { error: 'NARRATIVE_NOT_FOUND', status: 400 };
        const data = { ...input.data, rules: input.data.rules as Prisma.InputJsonValue, lastEvaluatedAt: null, lastRun: Prisma.DbNull };
        const changed = current && (current.name !== data.name || current.thesis !== data.thesis || current.mint !== data.mint || current.narrativeSlug !== data.narrativeSlug || JSON.stringify(ResearchMonitorInputSchema.shape.rules.parse(current.rules)) !== JSON.stringify(data.rules));
        const row = current ? await tx.researchMonitor.update({ where: { id: current.id }, data: { ...data, ...(changed ? { revision: { increment: 1 } } : {}) } }) : await tx.researchMonitor.create({ data: { ...data, ...where } });
        return { id: row.id };
      });
      if ('error' in result) return reply.code(result.status!).send({ error: result.error });
      return reply.code(method === 'post' ? 201 : 200).send(result);
    });
    app.delete(`${base}/:id`, opts, async (req, reply) => {
      const id = params.safeParse(req.params);
      if (!id.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
      const result = await db.$transaction(async tx => {
        await personalResearchLock(tx, req.userId!);
        return tx.researchMonitor.deleteMany({ where: { id: id.data.id, userId: req.userId!, kind } });
      });
      return result.count ? { ok: true } : reply.code(404).send({ error: 'NOT_FOUND' });
    });
    app.post(`${base}/refresh`, opts, async (req, reply) => await requestCheck(req.userId!) ? reply.code(202).send({ queued: true }) : reply.code(503).send({ error: 'RESEARCH_WORKER_UNAVAILABLE' }));
  }
  app.get('/v1/personal-research/briefings', opts, async req => {
    const access = await personalPermissions(db, req.userId!, clock());
    const rows = await db.personalBrief.findMany({ where: { userId: req.userId! }, orderBy: { day: 'desc' }, take: 7 });
    const result = PersonalBriefsSchema.parse({ items: rows.map(r => r.content) });
    // A retained digest cannot bypass a later feature-specific permission change.
    return { items: result.items.map(item => {
      const visible = item.items.filter(i => i.kind === 'RADAR' ? access.radar : access.thesis);
      return { ...item, radarMatches: access.radar ? item.radarMatches : 0, thesisChanges: access.thesis ? item.thesisChanges : 0, unknown: visible.filter(i => i.evaluation.status === 'UNKNOWN').length, items: visible };
    }) };
  });
  app.post('/v1/personal-research/briefings/refresh', opts, async (req, reply) => await requestCheck(req.userId!) ? reply.code(202).send({ queued: true }) : reply.code(503).send({ error: 'RESEARCH_WORKER_UNAVAILABLE' }));
}
