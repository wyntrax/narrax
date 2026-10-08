import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@narra/database';
import { audit, lock, TX_OPTIONS } from './common';
import { applyMembershipState } from './membershipStore';
import { partnerClient, type PartnerConfig } from './partner';
const KEY = 'entitlements.reconcile_state';
interface Progress { watermark?: string; fullAt?: string; lease?: { token: string; until: number }; run?: { start: string; since?: string; cursor?: string; last?: [string, string]; full: boolean } }
/** State/lease share a DB advisory lock; network requests never hold a database transaction. */
export async function reconcile(db: PrismaClient, config: PartnerConfig, now: () => Date = () => new Date()) {
  const client = partnerClient(config); if (!client) return { status: 'disabled' };
  const token = randomUUID(), start = now(), wallDeadline = Date.now() + 300000;
  const edit = <T>(fn: (s: Progress) => T) => db.$transaction(async tx => {
    await lock(tx, 'reconcile'); const row = await tx.systemSetting.findUnique({ where: { key: KEY } });
    const s = (row?.value ?? {}) as unknown as Progress; const result = fn(s);
    await tx.systemSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: s as unknown as Prisma.InputJsonValue }, update: { value: s as unknown as Prisma.InputJsonValue } }); return result;
  }, TX_OPTIONS);
  const run = await edit(s => {
    if (s.lease && s.lease.until > +start) return null;
    s.lease = { token, until: +start + 360000 };
    const full = !s.fullAt || +start - +new Date(s.fullAt) >= 86400000;
    s.run ??= { start: start.toISOString(), full, ...(!full && s.watermark ? { since: new Date(+new Date(s.watermark) - 300000).toISOString() } : {}) };
    return s.run;
  });
  if (!run) return { status: 'busy' };
  const owns = (s: Progress) => { if (s.lease?.token !== token || s.lease.until <= +now()) throw Error('RECONCILE_LEASE_LOST'); };
  let applied = 0;
  const seen = new Set<string>(); if (run.cursor) seen.add(run.cursor);
  try {
    for (let pages = 0; pages < 100 && Date.now() < wallDeadline; pages++) {
      await edit(s => { owns(s); });
      const page = await client.page(run.since, run.cursor);
      // Entire page has been schema-validated; order/cursor checks precede all state writes.
      if (page.nextCursor && seen.has(page.nextCursor)) throw Error('RECONCILE_CURSOR_LOOP');
      let last = run.last;
      for (const item of page.items) {
        const order: [string, string] = [item.sourceUpdatedAt.toISOString(), item.wyntraxUserId];
        if (last && (order[0] < last[0] || (order[0] === last[0] && order[1] <= last[1]))) throw Error('RECONCILE_ORDER'); last = order;
      }
      for (const item of page.items) {
        if (Date.now() >= wallDeadline) return { status: 'bounded', applied };
        if (await applyMembershipState(db, item, now()) === 'applied') applied++;
      }
      await edit(s => {
        owns(s);
        if (!page.nextCursor) { s.watermark = run.start; if (run.full) s.fullAt = run.start; delete s.run; }
        else { run.cursor = page.nextCursor; if (last) run.last = last; s.run = run; }
      });
      if (!page.nextCursor) { await sweepExpired(db, now()); return { status: 'complete', applied }; }
      seen.add(page.nextCursor);
    }
    return { status: 'bounded', applied };
  } catch {
    await db.$transaction(tx => audit(tx, null, 'entitlements.reconcile_failed', { code: 'PARTNER_OR_STORAGE_UNAVAILABLE' }));
    throw Error('WYNTRAX_RECONCILE_UNAVAILABLE');
  } finally { await edit(s => { if (s.lease?.token === token) delete s.lease; }); }
}
export async function sweepExpired(db: PrismaClient, now: Date) {
  return db.$transaction(async tx => {
    await lock(tx, 'seats');
    const grants = await tx.accessGrant.findMany({ where: { status: 'ACTIVE', validUntil: { lte: now } }, take: 500, orderBy: { id: 'asc' } });
    for (const grant of grants) {
      await tx.accessGrant.update({ where: { id: grant.id }, data: { status: 'EXPIRED' } });
      await audit(tx, null, 'entitlements.grant_expired', { grantId: grant.id, userId: grant.userId });
    }
    const cutoff = new Date(+now - 86400000);
    const challenges = await tx.walletLinkChallenge.findMany({ where: { OR: [{ expiresAt: { lt: cutoff } }, { consumedAt: { lt: cutoff } }] }, take: 500, select: { id: true } });
    await tx.walletLinkChallenge.deleteMany({ where: { id: { in: challenges.map(c => c.id) } } });
    return { expired: grants.length, challenges: challenges.length };
  }, TX_OPTIONS);
}
