import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { sanitizeUntrusted } from '@narra/shared';
import { makeAuthenticate, makeRequireAdmin, type AccountDeps } from '../account';
import { AccessError } from './common';
import { accessSettings, entitlementTrace } from './access';
import { localSettings, SETTING_SCHEMAS, tierRequirements, updateLocalSettings } from './settings';
import { DEFAULT_TIER_REQUIREMENTS, DEFAULT_TOKEN_SYMBOL, FEATURE_TIERS, activeTier, earlyAccessClosed, type AccessTier } from '@narra/shared';
import { grantEarlyAccess, revokeLocalGrant } from './grants';
import { unlinkWallet } from './linking';
import { marketTokenImages } from '../marketEvidence';
const Reason = z.string().trim().min(1).max(300).transform(s => sanitizeUntrusted(s, 300).trim()).refine(s => s.length > 0);
const Id = z.string().min(1).max(200);
export function registerEntitlementRoutes(app: FastifyInstance, deps: AccountDeps) {
  const { db } = deps, now = deps.now ?? (() => new Date());
  const auth = makeAuthenticate(deps);
  const handle = (work: (r: FastifyRequest) => Promise<unknown>) => async (req: FastifyRequest, reply: FastifyReply) => {
    try { return await work(req); } catch (e) {
      const status = e instanceof AccessError ? e.status : e instanceof z.ZodError ? 400 : 503;
      return reply.code(status).send({ error: e instanceof AccessError ? e.code : status === 400 ? 'INVALID_INPUT' : 'ENTITLEMENTS_UNAVAILABLE', requestId: req.requestId });
    }
  };
  // Admin routes authenticate and then check the ADMIN_* allowlist in one step. `requireAdminActor` stays the
  // transaction-level backstop used by the entitlement services themselves.
  const opts = (admin = false, max = 30) => ({ bodyLimit: 16384, config: { rateLimit: { max, timeWindow: '1 minute' } }, preHandler: admin ? makeRequireAdmin(deps) : auth });
  const params = (r: FastifyRequest) => z.object({ userId: Id, id: Id.optional() }).parse(r.params);
  // Public availability only. Thirty-second per-process cache; admission still rechecks atomically.
  type PublicStatus = { enabled: boolean; seatsLeft: number | null; inviteRequired: boolean };
  let publicCache: { until: number; value: PublicStatus } | undefined;
  let publicPending: Promise<PublicStatus> | undefined;
  app.get('/v1/early-access/status', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    try {
      const at = now();
      if (!publicCache || publicCache.until <= +at) {
        publicPending ??= db.$transaction(async tx => {
          const settings = await localSettings(tx);
          // An ended time window reads as closed: the same state as disabled, so the existing screens need no new shape.
          settings.enabled = settings.enabled && !earlyAccessClosed(settings.closesAt, at);
          const occupied = settings.enabled ? (await tx.accessGrant.findMany({ where: { tier: 'EARLY_ACCESS', status: 'ACTIVE', OR: [{ validUntil: null }, { validUntil: { gt: at } }] }, distinct: ['userId'], select: { userId: true } })).length : 0;
          return { enabled: settings.enabled, seatsLeft: settings.enabled ? Math.max(0, settings.cap - occupied) : null, inviteRequired: settings.inviteRequired };
        }, { isolationLevel: 'RepeatableRead' }).then(value => { publicCache = { until: +now() + 30_000, value }; return value; }).finally(() => { publicPending = undefined; });
        await publicPending;
      }
      // The application cache is authoritative; avoid stacking another thirty seconds at an edge.
      reply.header('cache-control', 'no-store');
      return publicCache!.value;
    } catch {
      return reply.code(503).header('cache-control', 'no-store').send({ error: 'ENTITLEMENTS_UNAVAILABLE', requestId: req.requestId });
    }
  });
  // Public tier requirements: how many $Wyntrax each paid tier asks for, and the early-access window. No secrets, no per-user data.
  type PublicRequirements = { tokenSymbol: string; tokenMint: string | null; tokenImageUrl: string | null; tiers: { MEMBER: number; PRO: number }; featureTiers: Record<string, AccessTier>; earlyAccess: { closesAt: string | null; accessDays: number | null } };
  let reqCache: { until: number; value: PublicRequirements } | undefined;
  // A change to settings or seats must reach the public pages at once, not after the thirty-second cache window.
  const invalidatePublic = () => { publicCache = undefined; reqCache = undefined; };
  app.get('/v1/access/requirements', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    try {
      const at = now();
      if (!reqCache || reqCache.until <= +at) {
        const value = await db.$transaction(async tx => {
          const { tiers, tokenSymbol, tokenMint } = await tierRequirements(tx), settings = await localSettings(tx);
          const access = await accessSettings(tx as typeof db);
          const featureTiers = Object.fromEntries(Object.entries(FEATURE_TIERS).map(([key, base]) => [key, activeTier(access.overrides[key]?.requiredTier ?? base)]));
          const token=tokenMint?await tx.token.findUnique({where:{mint:tokenMint},select:{id:true,mint:true}}):null;
          const images=await marketTokenImages(tx,token?[token]:[]);
          return { tokenSymbol, tokenMint, tokenImageUrl:token?images.get(token.id)??null:null, tiers, featureTiers, earlyAccess: { closesAt: settings.closesAt?.toISOString() ?? null, accessDays: settings.accessDays } };
        }, { isolationLevel: 'RepeatableRead' });
        reqCache = { until: +now() + 30_000, value };
      }
      reply.header('cache-control', 'no-store');
      return reqCache.value;
    } catch {
      return reply.code(503).header('cache-control', 'no-store').send({ error: 'ENTITLEMENTS_UNAVAILABLE', requestId: req.requestId });
    }
  });
  app.get('/v1/me/entitlements', opts(false, 60), handle(r => entitlementTrace(db, r.userId!, now())));
  // Best-effort request from the verified-wallet screen. It never blocks early access; the worker owns the check.
  app.post('/v1/me/membership/refresh', opts(false, 5), handle(async r => { if (deps.requestMembershipSync) await deps.requestMembershipSync(r.userId!); return { ok: true }; }));
  app.post('/v1/me/early-access/join', opts(false, 5), handle(async r => { const result = await grantEarlyAccess(db, r.userId!, { tier: 'EARLY_ACCESS', validUntil: null, reason: 'Self join' }, null, now()); invalidatePublic(); return result; }));
  app.delete('/v1/me/early-access', opts(false, 5), handle(async r => {
    const grant = await db.accessGrant.findUnique({ where: { userId_source: { userId: r.userId!, source: 'EARLY_ACCESS' } } });
    if (grant) await revokeLocalGrant(db, r.userId!, grant.id, null, 'Self leave', now()); invalidatePublic(); return { ok: true };
  }));
  app.get('/v1/admin/entitlements/settings', opts(true), handle(async () => ({ defaults: { 'entitlements.enforced': false, 'entitlements.shadow_log': true, 'early_access.enabled': false, 'early_access.seat_cap': 0, 'early_access.closes_at': null, 'early_access.access_days': null, 'access.tier_requirements': DEFAULT_TIER_REQUIREMENTS, 'access.token_symbol': DEFAULT_TOKEN_SYMBOL, 'access.token_mint': null, 'entitlements.features': {} }, items: await db.systemSetting.findMany({ where: { key: { in: Object.keys(SETTING_SCHEMAS) } } }) })));
  app.put('/v1/admin/entitlements/settings', opts(true), handle(async r => { const v = z.object({ settings: z.unknown(), reason: Reason, overridePrivyCheck: z.boolean().optional() }).strict().parse(r.body); await updateLocalSettings(db, r.userId!, v.settings, v.reason, { overridePrivyCheck: v.overridePrivyCheck }); invalidatePublic(); return { ok: true }; }));
  app.get('/v1/admin/users/:userId/entitlements', opts(true), handle(r => entitlementTrace(db, params(r).userId, now())));
  app.post('/v1/admin/users/:userId/entitlements/grants', opts(true, 10), handle(async r => {
    const v = z.object({ tier: z.literal('EARLY_ACCESS'), validUntil: z.string().datetime({ offset: true }).transform(s => new Date(s)), reason: Reason }).strict().parse(r.body);
    const result = await grantEarlyAccess(db, params(r).userId, v, r.userId!, now());
    invalidatePublic();
    return result;
  }));
  app.post('/v1/admin/users/:userId/entitlements/grants/:id/revoke', opts(true, 10), handle(async r => { const p = params(r); const v = z.object({ reason: Reason }).strict().parse(r.body); await revokeLocalGrant(db, p.userId, p.id!, r.userId!, v.reason, now()); invalidatePublic(); return { ok: true }; }));
  app.delete('/v1/admin/users/:userId/linked-wallets/:id', opts(true, 10), handle(async r => { const p = params(r); const v = z.object({ reason: Reason }).strict().parse(r.body); await unlinkWallet(db, p.userId, p.id!, now(), { actorId: r.userId!, reason: v.reason }); return { ok: true }; }));
  // Admin lookup: a wallet address, user id or Privy user id to the user, so someone can be whitelisted without a database query.
  app.get('/v1/admin/users/lookup', opts(true), handle(async r => {
    const { q } = z.object({ q: z.string().trim().min(1).max(100) }).strict().parse(r.query);
    const users = await db.user.findMany({
      where: { OR: [{ id: q }, { privyUserId: q }, { linkedWallets: { some: { address: q } } }] },
      take: 5, orderBy: { createdAt: 'desc' },
      select: { id: true, createdAt: true, isAdmin: true, linkedWallets: { select: { id: true, address: true, verifiedAt: true }, orderBy: { verifiedAt: 'asc' } } },
    });
    return { items: users.map(u => ({ id: u.id, createdAt: u.createdAt.toISOString(), isAdmin: u.isAdmin, wallets: u.linkedWallets.map(w => ({ id: w.id, address: w.address, verifiedAt: w.verifiedAt.toISOString() })) })) };
  }));
  // Who holds (or held) a local early-access grant, newest first. Self-joined and admin-granted rows are both listed.
  app.get('/v1/admin/early-access/grants', opts(true), handle(async () => {
    const rows = await db.accessGrant.findMany({
      orderBy: { createdAt: 'desc' }, take: 100,
      select: { id: true, userId: true, source: true, status: true, validUntil: true, reason: true, createdAt: true, user: { select: { linkedWallets: { select: { address: true }, take: 3 } } } },
    });
    return { items: rows.map(g => ({ id: g.id, userId: g.userId, source: g.source, status: g.status, validUntil: g.validUntil?.toISOString() ?? null, reason: g.reason, createdAt: g.createdAt.toISOString(), wallets: g.user.linkedWallets.map(w => w.address) })) };
  }));
  app.get('/v1/admin/early-access/stats', opts(true), handle(async () => {
    const at = now(), settings = await localSettings(db);
    const active = { tier: 'EARLY_ACCESS' as const, status: 'ACTIVE' as const, OR: [{ validUntil: null }, { validUntil: { gt: at } }] };
    const occupied = (await db.accessGrant.findMany({ where: active, distinct: ['userId'], select: { userId: true } })).length;
    return { occupied, available: Math.max(0, settings.cap - occupied), cap: settings.cap, active: await db.accessGrant.count({ where: active }), expired: await db.accessGrant.count({ where: { OR: [{ status: 'EXPIRED' }, { status: 'ACTIVE', validUntil: { lte: at } }] } }), revoked: await db.accessGrant.count({ where: { status: 'REVOKED' } }) };
  }));
}
