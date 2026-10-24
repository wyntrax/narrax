import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma, PrismaClient } from '@narra/database';
import { sanitizeUntrusted } from '@narra/shared';
import { makeRequireAdmin } from './admin';
import type { AccountDeps } from './account';
import { walletQualifications } from '@narra/worker-pipeline';

const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const Address = z.string().regex(BASE58_ADDRESS);
const Label = z.string().max(120).transform((s) => sanitizeUntrusted(s, 60)).nullable();
const Paging = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().max(64).optional() });
const AddBody = z.object({ address: Address, label: Label.optional() }).strict();
const ImportBody = z.object({ wallets: z.array(z.object({ address: z.string().max(80), label: z.string().max(120).nullish() }).strict()).min(1).max(500) }).strict();
const PatchBody = z.object({ label: Label.optional(), active: z.boolean().optional() }).strict().refine((b) => b.label !== undefined || b.active !== undefined, 'nothing to change');
const ApproveBody = z.object({ label: Label.optional(), reason: z.string().trim().min(1).max(300).transform(s=>sanitizeUntrusted(s,300)).optional() }).strict();
const isUnique = (e: unknown) => (e as { code?: string } | null)?.code === 'P2002';

export interface WalletAdminDeps extends Pick<AccountDeps, 'db' | 'verifier'> {
  /** Queue a webhook sync. Absent when Helius is not configured. */
  requestSync?: () => Promise<unknown>;
}

/**
 * Admin-only management of the tracked wallet set. The set is global: every user's intelligence reads it and it
 * uses Helius capacity, so ordinary users cannot change it. Wallets are deactivated, never deleted, so trade history
 * stays. Nothing here signs, sends or holds funds.
 */
export function registerWalletAdminRoutes(app: FastifyInstance, deps: WalletAdminDeps): void {
  const db: PrismaClient = deps.db;
  const requireAdmin = makeRequireAdmin(deps);
  const opts = { preHandler: requireAdmin, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };
  const bad = (issues?: z.ZodIssue[]) => ({ error: 'INVALID_INPUT', ...(issues ? { fields: [...new Set(issues.map((i) => i.path.join('.')))] } : {}) });
  const audit = (userId: string, action: string, detail: Prisma.InputJsonValue) => db.auditLog.create({ data: { userId, action, detail } });
  /** A failed sync request never fails the change itself. The scheduled sync catches up. */
  const sync = async () => { if (!deps.requestSync) return false; try { await deps.requestSync(); return true; } catch { return false; } };

  app.get('/v1/admin/wallets', opts, async (req, reply) => {
    const q = Paging.extend({ source: z.enum(['MANUAL', 'IMPORT', 'DISCOVERED']).optional(), active: z.enum(['true', 'false']).optional() }).safeParse(req.query);
    if (!q.success) return reply.code(400).send(bad());
    const rows = await db.trackedWallet.findMany({
      where: { ...(q.data.source ? { source: q.data.source } : {}), ...(q.data.active ? { active: q.data.active === 'true' } : {}) },
      orderBy: { id: 'asc' }, take: q.data.limit + 1, ...(q.data.cursor ? { cursor: { id: q.data.cursor }, skip: 1 } : {}),
      include: { profile: { select: { score: true } }, cluster: { select: { id: true, label: true, confidence: true } }, funding: { select: { status: true, funder: true, fundedAt: true } } },
    });
    const page = rows.slice(0, q.data.limit);
    const qualifications = await walletQualifications(db,page,new Date());
    return {
      items: page.map((w) => ({ address: w.address, label: w.label, source: w.source, active: w.active, createdAt: w.createdAt, score: w.profile?.score ?? null, cluster: w.cluster, funding: w.funding, researchReview: w.researchReview, researchReviewReason: w.researchReviewReason, qualification: qualifications.get(w.id) })),
      nextCursor: rows.length > q.data.limit ? page[page.length - 1]!.id : null,
    };
  });

  app.post('/v1/admin/wallets', opts, async (req, reply) => {
    const body = AddBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send(bad(body.error.issues));
    const { address, label } = body.data;
    const existing = await db.trackedWallet.findUnique({ where: { address }, select: { id: true, active: true } });
    if (existing?.active) return reply.code(409).send({ error: 'ALREADY_TRACKED' });
    try {
      const wallet = existing
        ? await db.trackedWallet.update({ where: { id: existing.id }, data: { active: true, ...(label !== undefined ? { label } : {}) } })
        : await db.trackedWallet.create({ data: { address, label: label ?? null, source: 'MANUAL' } });
      await audit(req.userId!, existing ? 'wallet.reactivated' : 'wallet.added', { address });
      return reply.code(existing ? 200 : 201).send({ wallet: { address: wallet.address, label: wallet.label, source: wallet.source, active: wallet.active }, syncRequested: await sync() });
    } catch (e) {
      if (isUnique(e)) return reply.code(409).send({ error: 'ALREADY_TRACKED' });
      throw e;
    }
  });

  app.post('/v1/admin/wallets/import', { ...opts, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = ImportBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send(bad(body.error.issues));
    const invalid: { index: number; reason: string }[] = [];
    const wanted = new Map<string, string | null>();
    body.data.wallets.forEach((w, index) => {
      const a = w.address.trim();
      if (!BASE58_ADDRESS.test(a)) invalid.push({ index, reason: 'not a valid address' });
      else if (!wanted.has(a)) wanted.set(a, w.label ? sanitizeUntrusted(w.label, 60) || null : null);
    });
    const existing = await db.trackedWallet.findMany({ where: { address: { in: [...wanted.keys()] } }, select: { id: true, address: true, active: true } });
    const known = new Map(existing.map((e) => [e.address, e]));
    const fresh = [...wanted].filter(([a]) => !known.has(a));
    const revive = existing.filter((e) => !e.active);
    await db.$transaction([
      db.trackedWallet.createMany({ skipDuplicates: true, data: fresh.map(([address, label]) => ({ address, label, source: 'IMPORT' })) }),
      ...(revive.length ? [db.trackedWallet.updateMany({ where: { id: { in: revive.map((r) => r.id) } }, data: { active: true } })] : []),
    ]);
    const result = { added: fresh.length, reactivated: revive.length, alreadyTracked: existing.length - revive.length, invalid };
    await audit(req.userId!, 'wallet.imported', { added: result.added, reactivated: result.reactivated, alreadyTracked: result.alreadyTracked, invalid: invalid.length });
    return { ...result, syncRequested: result.added + result.reactivated > 0 ? await sync() : false };
  });

  app.patch('/v1/admin/wallets/:address', opts, async (req, reply) => {
    const { address } = req.params as { address: string };
    const body = PatchBody.safeParse(req.body);
    if (!body.success || !BASE58_ADDRESS.test(address)) return reply.code(400).send(bad(body.success ? undefined : body.error.issues));
    const w = await db.trackedWallet.findUnique({ where: { address }, select: { id: true, active: true } });
    if (!w) return reply.code(404).send({ error: 'NOT_FOUND' });
    const updated = await db.trackedWallet.update({ where: { id: w.id }, data: { ...(body.data.label !== undefined ? { label: body.data.label } : {}), ...(body.data.active !== undefined ? { active: body.data.active } : {}) } });
    await audit(req.userId!, 'wallet.updated', { address, ...(body.data.label !== undefined ? { label: body.data.label } : {}), ...(body.data.active !== undefined ? { active: body.data.active } : {}) });
    const syncRequested = body.data.active !== undefined && body.data.active !== w.active ? await sync() : false;
    return { wallet: { address: updated.address, label: updated.label, source: updated.source, active: updated.active }, syncRequested };
  });

  app.get('/v1/admin/wallets/sync-status', opts, async () => {
    const [active, row] = await Promise.all([db.trackedWallet.count({ where: { active: true } }), db.systemSetting.findUnique({ where: { key: 'wallets.syncStatus' } })]);
    return { activeWallets: active, configured: !!deps.requestSync, lastSync: row?.value ?? null };
  });

  app.post('/v1/admin/wallets/sync', { ...opts, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (_req, reply) => {
    if (!deps.requestSync) return reply.code(503).send({ error: 'SYNC_NOT_CONFIGURED' });
    return reply.code(202).send({ requested: await sync() });
  });

  app.get('/v1/admin/wallet-candidates', opts, async (req, reply) => {
    const q = Paging.extend({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).default('PENDING') }).safeParse(req.query);
    if (!q.success) return reply.code(400).send(bad());
    if(q.data.cursor&&!await db.walletCandidate.count({where:{id:q.data.cursor,status:q.data.status}}))return reply.code(400).send(bad());
    const rows = await db.walletCandidate.findMany({ where: { status: q.data.status }, orderBy: [{ score: 'desc' }, { id: 'asc' }], take: q.data.limit+1, ...(q.data.cursor?{cursor:{id:q.data.cursor},skip:1}:{}) });
    const page=rows.slice(0,q.data.limit);
    return { nextCursor:rows.length>page.length?page.at(-1)!.id:null,items: page.map((c) => ({ address: c.address, score: c.score, winnerTokens: c.winnerTokens, status: c.status, evidence: c.evidence, createdAt: c.createdAt, reviewedAt: c.reviewedAt })) };
  });

  const review = async (req: { params: unknown; userId?: string }, status: 'APPROVED' | 'REJECTED', label?: string | null, reason?: string) => {
    const { address } = req.params as { address: string };
    if (!BASE58_ADDRESS.test(address)) return { code: 400 as const };
    return db.$transaction(async (tx) => {
      const c = await tx.walletCandidate.findUnique({ where: { address } });
      if (!c) return { code: 404 as const };
      if (c.status !== 'PENDING') return { code: 409 as const };
      // The status check is part of the update, so two admins cannot both approve the same candidate.
      const claimed = await tx.walletCandidate.updateMany({ where: { id: c.id, status: 'PENDING' }, data: { status, reviewedAt: new Date(), reviewedBy: req.userId! } });
      if (claimed.count === 0) return { code: 409 as const };
      if (status === 'APPROVED') {
        const w = await tx.trackedWallet.findUnique({ where: { address }, select: { id: true } });
        if (w) await tx.trackedWallet.update({ where: { id: w.id }, data: { active: true } });
        else await tx.trackedWallet.create({ data: { address, label: label ?? null, source: 'DISCOVERED' } });
      }
      await tx.auditLog.create({ data: { userId: req.userId!, action: status === 'APPROVED' ? 'wallet_candidate.approved' : 'wallet_candidate.rejected', detail: { address, score: c.score, reason: reason ?? null, evidence: c.evidence } } });
      return { code: 200 as const, address };
    });
  };

  app.post('/v1/admin/wallet-candidates/:address/approve', opts, async (req, reply) => {
    const body = ApproveBody.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send(bad(body.error.issues));
    const r = await review(req, 'APPROVED', body.data.label, body.data.reason);
    if (r.code !== 200) return reply.code(r.code).send({ error: r.code === 404 ? 'NOT_FOUND' : r.code === 409 ? 'ALREADY_REVIEWED' : 'INVALID_INPUT' });
    return { approved: r.address, syncRequested: await sync() };
  });

  app.post('/v1/admin/wallet-candidates/:address/reject', opts, async (req, reply) => {
    const body=ApproveBody.safeParse(req.body??{});
    if(!body.success)return reply.code(400).send(bad(body.error.issues));
    const r = await review(req, 'REJECTED',undefined,body.data.reason);
    if (r.code !== 200) return reply.code(r.code).send({ error: r.code === 404 ? 'NOT_FOUND' : r.code === 409 ? 'ALREADY_REVIEWED' : 'INVALID_INPUT' });
    return { rejected: r.address };
  });
}
