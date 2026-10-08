import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { sanitizeUntrusted } from '@narra/shared';
import { makeAuthenticate, type AccountDeps } from '../account';
import { AccessError, audit, requireAdminActor } from './common';
import { entitlementTrace } from './access';
import { localSettings, SETTING_SCHEMAS, updateLocalSettings } from './settings';
import { grantEarlyAccess, revokeLocalGrant } from './grants';
import { unlinkWallet } from './linking';
const Reason = z.string().trim().min(1).max(300).transform(s => sanitizeUntrusted(s, 300).trim()).refine(s => s.length > 0);
const Id = z.string().min(1).max(200);
export function registerEntitlementRoutes(app: FastifyInstance, deps: AccountDeps, enqueue?: () => Promise<unknown>) {
  const { db } = deps, now = deps.now ?? (() => new Date());
  const auth = makeAuthenticate(deps);
  const handle = (work: (r: FastifyRequest) => Promise<unknown>) => async (req: FastifyRequest, reply: FastifyReply) => {
    try { return await work(req); } catch (e) {
      const status = e instanceof AccessError ? e.status : e instanceof z.ZodError ? 400 : 503;
      return reply.code(status).send({ error: e instanceof AccessError ? e.code : status === 400 ? 'INVALID_INPUT' : 'ENTITLEMENTS_UNAVAILABLE', requestId: req.requestId });
    }
  };
  const opts = (admin = false, max = 30) => ({ bodyLimit: 16384, config: { rateLimit: { max, timeWindow: '1 minute' } }, preHandler: admin ? [auth, async (req: FastifyRequest, reply: FastifyReply) => {
    try { await requireAdminActor(db, req.userId!); } catch { return reply.code(403).send({ error: 'FORBIDDEN', requestId: req.requestId }); }
  }] : [auth] });
  const params = (r: FastifyRequest) => z.object({ userId: Id, id: Id.optional() }).parse(r.params);
  app.get('/v1/me/entitlements', opts(false, 60), handle(r => entitlementTrace(db, r.userId!, now())));
  app.post('/v1/me/early-access/join', opts(false, 5), handle(r => grantEarlyAccess(db, r.userId!, { tier: 'EARLY_ACCESS', validUntil: null, reason: 'Self join' }, null, now())));
  app.delete('/v1/me/early-access', opts(false, 5), handle(async r => {
    const grant = await db.accessGrant.findUnique({ where: { userId_source: { userId: r.userId!, source: 'EARLY_ACCESS' } } });
    if (grant) await revokeLocalGrant(db, r.userId!, grant.id, null, 'Self leave', now()); return { ok: true };
  }));
  app.get('/v1/admin/entitlements/settings', opts(true), handle(async () => ({ defaults: { 'entitlements.enforced': false, 'entitlements.shadow_log': true, 'early_access.enabled': false, 'early_access.seat_cap': 0, 'entitlements.features': {} }, items: await db.systemSetting.findMany({ where: { key: { in: Object.keys(SETTING_SCHEMAS) } } }) })));
  app.put('/v1/admin/entitlements/settings', opts(true), handle(async r => { const v = z.object({ settings: z.unknown(), reason: Reason }).strict().parse(r.body); await updateLocalSettings(db, r.userId!, v.settings, v.reason); return { ok: true }; }));
  app.get('/v1/admin/users/:userId/entitlements', opts(true), handle(r => entitlementTrace(db, params(r).userId, now())));
  app.post('/v1/admin/users/:userId/entitlements/grants', opts(true, 10), handle(r => {
    const v = z.object({ tier: z.literal('EARLY_ACCESS'), validUntil: z.string().datetime({ offset: true }).transform(s => new Date(s)), reason: Reason }).strict().parse(r.body);
    return grantEarlyAccess(db, params(r).userId, v, r.userId!, now());
  }));
  app.post('/v1/admin/users/:userId/entitlements/grants/:id/revoke', opts(true, 10), handle(async r => { const p = params(r); const v = z.object({ reason: Reason }).strict().parse(r.body); await revokeLocalGrant(db, p.userId, p.id!, r.userId!, v.reason, now()); return { ok: true }; }));
  app.delete('/v1/admin/users/:userId/linked-wallets/:id', opts(true, 10), handle(async r => { const p = params(r); const v = z.object({ reason: Reason }).strict().parse(r.body); await unlinkWallet(db, p.userId, p.id!, now(), { actorId: r.userId!, reason: v.reason }); return { ok: true }; }));
  app.post('/v1/admin/entitlements/reconcile', opts(true, 1), handle(async r => {
    const v = z.object({ reason: Reason }).strict().parse(r.body);
    if (!enqueue) throw new AccessError('WYNTRAX_UNAVAILABLE', 503);
    await db.$transaction(tx => audit(tx, r.userId!, 'entitlements.reconcile_requested', { reason: v.reason }));
    await enqueue(); return { ok: true };
  }));
  app.get('/v1/admin/early-access/stats', opts(true), handle(async () => {
    const at = now(), settings = await localSettings(db);
    const active = { tier: 'EARLY_ACCESS' as const, status: 'ACTIVE' as const, OR: [{ validUntil: null }, { validUntil: { gt: at } }] };
    const occupied = (await db.accessGrant.findMany({ where: active, distinct: ['userId'], select: { userId: true } })).length;
    return { occupied, available: Math.max(0, settings.cap - occupied), cap: settings.cap, active: await db.accessGrant.count({ where: active }), expired: await db.accessGrant.count({ where: { OR: [{ status: 'EXPIRED' }, { status: 'ACTIVE', validUntil: { lte: at } }] } }), revoked: await db.accessGrant.count({ where: { status: 'REVOKED' } }) };
  }));
}
