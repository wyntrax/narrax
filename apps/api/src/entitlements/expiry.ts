import type { PrismaClient } from '@narra/database';
import { audit, lock, TX_OPTIONS } from './common';

/** Scheduled independently of webhook delivery and trading workers. Access checks enforce expiry even between sweeps. */
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
