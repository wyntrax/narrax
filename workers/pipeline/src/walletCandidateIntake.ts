import type { PrismaClient } from '@narra/database';
import { isSolanaAddress } from '@narra/shared';
import { z } from 'zod';

export const WALLET_INTAKE_KEY = 'wallet.evaluation.intake';
export const WALLET_INTAKE_LIMITS = { capacity: 200, perCycle: 2 } as const;
const Snapshot = z.object({ checkedAt: z.string().datetime(), items: z.array(z.object({ address: z.string(), scannedTokens: z.number().int().min(2) })).max(50) });

/** Repeat early participation is a lead, never proof of returns. Intake is independently
 * enabled by history collection, not by publication. Existing reviews are never overwritten. */
export async function intakeEmergingWallets(db: PrismaClient, now = new Date()) {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('wallet-evaluation-intake'))`;
    const snapshot = Snapshot.safeParse((await tx.systemSetting.findUnique({ where: { key: 'wallet.discovery.emerging' } }))?.value);
    const out = { checkedAt: now.toISOString(), added: 0, considered: 0, capacity: 0, reason: 'NO_FRESH_DISCOVERY' };
    if (snapshot.success && +now >= Date.parse(snapshot.data.checkedAt) && +now - Date.parse(snapshot.data.checkedAt) <= 3_600_000) {
      const count = await tx.trackedWallet.count({ where: { source: 'DISCOVERED', active: true, researchReview: { not: 'REJECTED' } } });
      out.capacity = Math.max(0, WALLET_INTAKE_LIMITS.capacity - count);
      const rejected = new Set((await tx.walletCandidate.findMany({ where: { status: 'REJECTED' }, select: { address: true } })).map(w => w.address));
      const candidates = snapshot.data.items.filter(w => isSolanaAddress(w.address) && !rejected.has(w.address));
      const existing = new Set((await tx.trackedWallet.findMany({ where: { address: { in: candidates.map(w => w.address) } }, select: { address: true } })).map(w => w.address));
      const selected = candidates.filter(w => !existing.has(w.address)).slice(0, Math.min(WALLET_INTAKE_LIMITS.perCycle, out.capacity));
      out.considered = candidates.length;
      if (selected.length) out.added = (await tx.trackedWallet.createMany({ data: selected.map(w => ({ address: w.address, source: 'DISCOVERED', active: true, researchReview: 'PROVISIONAL' })), skipDuplicates: true })).count;
      out.reason = out.capacity === 0 ? 'CAPACITY_REACHED' : 'EVALUATION_ONLY';
    }
    await tx.systemSetting.upsert({ where: { key: WALLET_INTAKE_KEY }, create: { key: WALLET_INTAKE_KEY, value: out }, update: { value: out } });
    return out;
  });
}
