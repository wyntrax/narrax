import type { Prisma } from '@narra/database';
import { z } from 'zod';
import { decodeBase58 } from './crypto';

export class AccessError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); }
}
export const WalletAddress = z.string().min(32).max(44).refine(s => decodeBase58(s, 32) !== null);
export const WalletInput = z.object({ chain: z.literal('solana'), address: WalletAddress }).strict();
export const lock = (tx: Prisma.TransactionClient, name: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`narra-entitlements:${name}`}, 0))`;
export const lockUser = (tx: Prisma.TransactionClient, userId: string) => lock(tx, `user:${userId}`);
export const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000, isolationLevel: 'ReadCommitted' as const };
export async function requireAdminActor(tx: Prisma.TransactionClient, actorId: string) {
  if (!(await tx.user.findUnique({ where: { id: actorId }, select: { isAdmin: true } }))?.isAdmin) throw new AccessError('FORBIDDEN', 403);
}
export const audit = (tx: Prisma.TransactionClient, userId: string | null, action: string, detail: Prisma.InputJsonValue) => tx.auditLog.create({ data: { userId, action, detail } });
