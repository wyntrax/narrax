import type { PrismaClient } from '@narra/database';
import { earlyAccessAdmission, sanitizeUntrusted } from '@narra/shared';
import { z } from 'zod';
import { AccessError, audit, lock, lockUser, requireAdminActor, TX_OPTIONS } from './common';
import { localSettings } from './settings';

const GrantInput = z.object({ tier: z.literal('EARLY_ACCESS'), validUntil: z.date().nullable(), reason: z.string().min(1).max(1000) }).strict();
const active = (now: Date) => ({ tier: 'EARLY_ACCESS' as const, status: 'ACTIVE' as const, OR: [{ validUntil: null }, { validUntil: { gt: now } }] });
/** A seat belongs to a USER, including users who also have a paid membership. Unlink never releases it. */
export async function grantEarlyAccess(db: PrismaClient, userId: string, input: unknown, actorId: string | null, now: Date) {
  const v = GrantInput.safeParse(input);
  if (!v.success || !Number.isFinite(now.getTime()) || (v.data.validUntil && v.data.validUntil <= now) || (actorId !== null && !v.data.validUntil)) throw new AccessError('INVALID_INPUT', 400);
  const reason = sanitizeUntrusted(v.data.reason, 300).trim();
  if (!reason) throw new AccessError('INVALID_INPUT', 400);
  return db.$transaction(async tx => {
    if (actorId !== null) await requireAdminActor(tx, actorId);
    await lock(tx, 'seats');
    await lockUser(tx, userId);
    const settings = await localSettings(tx);
    const users = await tx.accessGrant.findMany({ where: active(now), distinct: ['userId'], select: { userId: true } });
    const denied = earlyAccessAdmission({ ...settings, now, occupied: users.length, alreadySeated: users.some(u => u.userId === userId), hasWallet: (await tx.linkedWallet.count({ where: { userId } })) > 0 });
    if (denied) throw new AccessError(denied);
    const source = actorId === null ? 'EARLY_ACCESS' : 'ADMIN';
    const previous = await tx.accessGrant.findUnique({ where: { userId_source: { userId, source } } });
    if (previous?.status === 'ACTIVE' && (previous.validUntil === null || previous.validUntil > now)) return previous;
    // A self-join with no explicit expiry takes the admin-set seat duration, if one is configured.
    const validUntil = v.data.validUntil ?? (actorId === null && settings.accessDays ? new Date(now.getTime() + settings.accessDays * 86_400_000) : null);
    const data = { tier: 'EARLY_ACCESS' as const, status: 'ACTIVE' as const, validUntil, revokedAt: null, createdBy: actorId, reason };
    const result = await tx.accessGrant.upsert({ where: { userId_source: { userId, source } }, create: { userId, source, ...data }, update: data });
    await audit(tx, actorId ?? userId, 'entitlements.granted', { userId, grantId: result.id, source, tier: data.tier, validUntil: data.validUntil?.toISOString() ?? null, reason });
    return result;
  }, TX_OPTIONS);
}
export async function revokeLocalGrant(db: PrismaClient, userId: string, grantId: string, actorId: string | null, reasonInput: string, now: Date) {
  const reason = sanitizeUntrusted(reasonInput, 300).trim();
  if (!reason) throw new AccessError('INVALID_INPUT', 400);
  return db.$transaction(async tx => {
    if (actorId !== null) await requireAdminActor(tx, actorId);
    await lock(tx, 'seats');
    const grant = await tx.accessGrant.findFirst({ where: { id: grantId, userId, tier: 'EARLY_ACCESS', ...(actorId === null ? { source: 'EARLY_ACCESS' } : {}) } });
    if (!grant) throw new AccessError('NOT_FOUND', 404);
    if (grant.status === 'REVOKED') return;
    await tx.accessGrant.update({ where: { id: grant.id }, data: { status: 'REVOKED', revokedAt: now } });
    await audit(tx, actorId ?? userId, 'entitlements.revoked', { userId, grantId, source: grant.source, reason });
  }, TX_OPTIONS);
}
