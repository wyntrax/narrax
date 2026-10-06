import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma, PrismaClient } from '@narra/database';
import { GLOBAL_LIMITS, SYSTEM_LIMITS_KEY, resolveSystemLimits, validateSystemLimitsInput } from '@narra/risk';
import { sanitizeUntrusted } from '@narra/shared';
import { TRADING_PAUSE_KEY, parsePause } from '@narra/worker-pipeline';
import { makeRequireAdmin } from './admin';
import type { AccountDeps } from './account';
import { IdCursor, Limit, decodeCursor, encodeCursor } from './paging';

const Reason = z.string().min(1).max(1000);
const cleanReason = (s: string) => sanitizeUntrusted(s, 300);
const Mint = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const AuditCursor = z.tuple([z.string().datetime(), IdCursor]);
const ListCursor = z.tuple([IdCursor]);

/**
 * Admin controls that change how the system behaves, all audited with who, what changed (before and after) and why:
 * system risk limits, a global pause on new entries, and the token blacklist. The code defaults in packages/risk are the
 * absolute ceiling for limits: an admin can tighten, never loosen past them. Nothing here can trade, and none of it is
 * reachable by the chat agent.
 */
export function registerAdminOpsRoutes(app: FastifyInstance, deps: Pick<AccountDeps, 'db' | 'verifier' | 'now'>): void {
  const db: PrismaClient = deps.db;
  const now = deps.now ?? (() => new Date());
  const opts = { preHandler: makeRequireAdmin(deps), config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };
  const bad = (reply: { code(n: number): { send(b: unknown): unknown } }, extra: Record<string, unknown> = {}) => reply.code(400).send({ error: 'INVALID_INPUT', ...extra });
  const json = (v: unknown) => v as Prisma.InputJsonValue;

  // ---------- system limits ----------
  async function limitsView() {
    const row = await db.systemSetting.findUnique({ where: { key: SYSTEM_LIMITS_KEY } });
    const r = resolveSystemLimits(row?.value);
    const last = await db.auditLog.findFirst({ where: { action: { in: ['system_limits.changed', 'system_limits.reset'] } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    const d = (last?.detail ?? {}) as { reason?: string };
    return { effective: r.limits, overrides: r.overrides, ignoredInvalid: r.invalid, codeCeilings: GLOBAL_LIMITS, lastChange: last ? { at: last.createdAt, by: last.userId, action: last.action, reason: d.reason ?? null } : null };
  }

  app.get('/v1/admin/system-limits', opts, async () => limitsView());

  app.put('/v1/admin/system-limits', opts, async (req, reply) => {
    const body = z.object({ limits: z.record(z.unknown()), reason: Reason }).strict().safeParse(req.body);
    if (!body.success) return bad(reply);
    const checked = validateSystemLimitsInput(body.data.limits);
    if (!checked.ok) return bad(reply, { problems: checked.errors });
    const reason = cleanReason(body.data.reason);
    if (!reason) return bad(reply);
    const before = await db.systemSetting.findUnique({ where: { key: SYSTEM_LIMITS_KEY } });
    // The submission replaces the overrides: a limit left out goes back to the code default.
    await db.$transaction([
      db.systemSetting.upsert({ where: { key: SYSTEM_LIMITS_KEY }, create: { key: SYSTEM_LIMITS_KEY, value: json(checked.value) }, update: { value: json(checked.value) } }),
      db.auditLog.create({ data: { userId: req.userId!, action: 'system_limits.changed', detail: json({ before: resolveSystemLimits(before?.value).overrides, after: checked.value, reason }) } }),
    ]);
    return limitsView();
  });

  app.post('/v1/admin/system-limits/reset', opts, async (req, reply) => {
    const body = z.object({ reason: Reason }).strict().safeParse(req.body);
    if (!body.success) return bad(reply);
    const reason = cleanReason(body.data.reason);
    if (!reason) return bad(reply);
    const before = await db.systemSetting.findUnique({ where: { key: SYSTEM_LIMITS_KEY } });
    await db.$transaction([
      db.systemSetting.deleteMany({ where: { key: SYSTEM_LIMITS_KEY } }),
      db.auditLog.create({ data: { userId: req.userId!, action: 'system_limits.reset', detail: json({ before: resolveSystemLimits(before?.value).overrides, reason }) } }),
    ]);
    return limitsView();
  });

  // ---------- global pause on new entries ----------
  app.get('/v1/admin/trading-pause', opts, async () => parsePause((await db.systemSetting.findUnique({ where: { key: TRADING_PAUSE_KEY } }))?.value));

  app.put('/v1/admin/trading-pause', opts, async (req, reply) => {
    const body = z.object({ paused: z.boolean(), reason: Reason }).strict().safeParse(req.body);
    if (!body.success) return bad(reply);
    const reason = cleanReason(body.data.reason);
    if (!reason) return bad(reply);
    const value = { paused: body.data.paused, reason, at: now().toISOString(), by: req.userId! };
    await db.$transaction([
      db.systemSetting.upsert({ where: { key: TRADING_PAUSE_KEY }, create: { key: TRADING_PAUSE_KEY, value: json(value) }, update: { value: json(value) } }),
      db.auditLog.create({ data: { userId: req.userId!, action: body.data.paused ? 'system.trading_paused' : 'system.trading_resumed', detail: json({ reason }) } }),
    ]);
    return { ...value, note: 'New entries only. Exits, the monitor and alerts keep running.' };
  });

  // ---------- token blacklist ----------
  app.get('/v1/admin/blacklist', opts, async (req, reply) => {
    const q = z.object({ limit: Limit, cursor: z.string().max(300).optional() }).safeParse(req.query);
    if (!q.success) return bad(reply);
    let after: string | null = null;
    if (q.data.cursor) { const c = decodeCursor(q.data.cursor, ListCursor); if (!c) return bad(reply); after = c[0]; }
    const rows = await db.token.findMany({ where: { blacklisted: true, ...(after ? { id: { lt: after } } : {}) }, orderBy: { id: 'desc' }, take: q.data.limit + 1, select: { id: true, mint: true, symbol: true, blacklistReason: true, blacklistedAt: true, blacklistedBy: true } });
    const page = rows.slice(0, q.data.limit), last = page[page.length - 1];
    return {
      items: page.map((t) => ({ mint: t.mint, symbol: t.symbol /* untrusted text: render as plain text */, reason: t.blacklistReason, blacklistedAt: t.blacklistedAt, blacklistedBy: t.blacklistedBy })),
      nextCursor: rows.length > q.data.limit && last ? encodeCursor([last.id]) : null,
    };
  });

  app.put('/v1/admin/tokens/:mint/blacklist', opts, async (req, reply) => {
    const p = z.object({ mint: Mint }).safeParse(req.params);
    const body = z.object({ blacklisted: z.boolean(), reason: Reason }).strict().safeParse(req.body);
    if (!p.success || !body.success) return bad(reply);
    const reason = cleanReason(body.data.reason);
    if (!reason) return bad(reply);
    const token = await db.token.findUnique({ where: { mint: p.data.mint }, select: { id: true, mint: true, symbol: true, blacklisted: true } });
    if (!token) return reply.code(404).send({ error: 'NOT_FOUND' });
    const openPositions = await db.position.count({ where: { tokenId: token.id, status: 'OPEN' } });
    if (token.blacklisted === body.data.blacklisted) return { mint: token.mint, symbol: token.symbol, blacklisted: token.blacklisted, changed: false, openPositions };
    const at = now();
    await db.$transaction([
      db.token.update({ where: { id: token.id }, data: body.data.blacklisted ? { blacklisted: true, blacklistReason: reason, blacklistedAt: at, blacklistedBy: req.userId! } : { blacklisted: false, blacklistReason: null, blacklistedAt: null, blacklistedBy: null } }),
      db.auditLog.create({ data: { userId: req.userId!, action: body.data.blacklisted ? 'token.blacklisted' : 'token.unblacklisted', detail: json({ mint: token.mint, reason, openPositions }) } }),
    ]);
    // New entries in the token stop at once (the fan-out skips it and the Governor rejects it). Open positions are NOT sold:
    // exits stay allowed, and ending a position is a decision for the monitor, the user or an admin, not a side effect of a list.
    return { mint: token.mint, symbol: token.symbol, blacklisted: body.data.blacklisted, changed: true, openPositions };
  });

  // ---------- audit log ----------
  app.get('/v1/admin/audit', opts, async (req, reply) => {
    const q = z.object({ limit: Limit, cursor: z.string().max(300).optional(), action: z.string().regex(/^[a-z_.]{1,60}$/).optional(), userId: IdCursor.optional() }).safeParse(req.query);
    if (!q.success) return bad(reply);
    let cur: z.infer<typeof AuditCursor> | null = null;
    if (q.data.cursor) { cur = decodeCursor(q.data.cursor, AuditCursor); if (!cur) return bad(reply); }
    const rows = await db.auditLog.findMany({
      where: { ...(q.data.action ? { action: q.data.action } : {}), ...(q.data.userId ? { userId: q.data.userId } : {}), ...(cur ? { OR: [{ createdAt: { lt: new Date(cur[0]) } }, { createdAt: new Date(cur[0]), id: { lt: cur[1] } }] } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: q.data.limit + 1,
    });
    const page = rows.slice(0, q.data.limit), last = page[page.length - 1];
    return { items: page.map((r) => ({ id: r.id, at: r.createdAt, userId: r.userId, action: r.action, detail: r.detail })), nextCursor: rows.length > q.data.limit && last ? encodeCursor([last.createdAt.toISOString(), last.id]) : null };
  });
}
