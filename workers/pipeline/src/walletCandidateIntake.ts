import type { PrismaClient } from '@narra/database';
import { isSolanaAddress } from '@narra/shared';
import { z } from 'zod';
import { DISCOVERY_HOLD_LIMITS } from './walletDiscovery';

export const WALLET_INTAKE_KEY = 'wallet.evaluation.intake';
/** `evictMaxScore` is a reversible capacity policy: stale provisional wallets below it can be released to make room for new candidates. History is kept and they can be reactivated. */
export const WALLET_INTAKE_LIMITS = { capacity: 200, perCycle: 2, staleProvisionalMs: 7 * 86_400_000, evictMaxScore: 50, minMedianQuoteSol: 0.01 } as const;
const SpendSummary = z.object({ matchedTokens: z.number().int().nonnegative(),
  medianMatchedQuoteSol: z.union([z.number().finite(), z.string().regex(/^\d+(\.\d+)?$/)]).nullable() }).optional();
const Hold = z.object({ checkedAt: z.string().datetime(), tokenId: z.string(), mint: z.string(), stillHolding: z.boolean(),
  heldMs: z.number().int().nonnegative().nullable() }).optional();
const Snapshot = z.object({ checkedAt: z.string().datetime(), items: z.array(z.object({ address: z.string(), scannedTokens: z.number().int().min(2), spend: SpendSummary, hold: Hold })).max(50) });

/** Repeat early participation is a lead, never proof of returns. Intake is independently
 * enabled by history collection, not by publication. Existing reviews are never overwritten. */
export async function intakeEmergingWallets(db: PrismaClient, now = new Date()) {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('wallet-evaluation-intake'))`;
    const snapshot = Snapshot.safeParse((await tx.systemSetting.findUnique({ where: { key: 'wallet.discovery.emerging' } }))?.value);
    const out = { checkedAt: now.toISOString(), added: 0, evicted: 0, considered: 0, capacity: 0, reason: 'NO_FRESH_DISCOVERY' };
    if (snapshot.success && +now >= Date.parse(snapshot.data.checkedAt) && +now - Date.parse(snapshot.data.checkedAt) <= 3_600_000) {
      const count = await tx.trackedWallet.count({ where: { source: 'DISCOVERED', active: true, researchReview: { not: 'REJECTED' } } });
      out.capacity = Math.max(0, WALLET_INTAKE_LIMITS.capacity - count);
      const rejected = new Set((await tx.walletCandidate.findMany({ where: { status: 'REJECTED' }, select: { address: true } })).map(w => w.address));
      const candidates = snapshot.data.items.filter(w =>
        isSolanaAddress(w.address) &&
        !rejected.has(w.address) &&
        !(w.spend && w.spend.matchedTokens >= 2 && w.spend.medianMatchedQuoteSol !== null && Number(w.spend.medianMatchedQuoteSol) < WALLET_INTAKE_LIMITS.minMedianQuoteSol),
      );
      const existing = new Set((await tx.trackedWallet.findMany({ where: { address: { in: candidates.map(w => w.address) } }, select: { address: true } })).map(w => w.address));
      const holdRank = (w: typeof candidates[number]) => w.hold?.stillHolding ? (w.hold.heldMs != null && w.hold.heldMs >= DISCOVERY_HOLD_LIMITS.minHeldMs ? 2 : 1) : 0;
      const spendSize = (w: typeof candidates[number]) => {
        const value = w.spend?.medianMatchedQuoteSol;
        return w.spend && w.spend.matchedTokens >= 2 && value != null && Number.isFinite(Number(value)) ? Number(value) : -1;
      };
      // Prefer observed holders first, then known size, then repeat participation. Ties retain snapshot order.
      const pending = candidates.filter(w => !existing.has(w.address)).sort((a,b) =>
        holdRank(b) - holdRank(a) || spendSize(b) - spendSize(a) || b.scannedTokens - a.scannedTokens);
      if (out.capacity === 0 && pending.length > 0 && typeof tx.trackedWallet.updateMany === 'function') {
        const staleCutoff = new Date(+now - WALLET_INTAKE_LIMITS.staleProvisionalMs);
        const canReadIntelligence = typeof tx.systemSetting.findMany === 'function';
        const stalePool = await tx.trackedWallet.findMany({
          where: {
            source: 'DISCOVERED',
            active: true,
            researchReview: 'PROVISIONAL',
            createdAt: { lte: staleCutoff },
            ...(!canReadIntelligence
              ? { OR: [{ profile: { is: null } }, { profile: { is: { score: { lt: WALLET_INTAKE_LIMITS.evictMaxScore } } } }] }
              : {}),
          },
          select: { id: true, profile: { select: { score: true } } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: canReadIntelligence ? WALLET_INTAKE_LIMITS.capacity : WALLET_INTAKE_LIMITS.perCycle * 5,
        });
        const validStale = stalePool.filter((row): row is { id: string; profile: { score: number } | null } =>
          typeof (row as { id?: unknown }).id === 'string');
        const automatedIds = new Set<string>();
        if (canReadIntelligence && validStale.length) {
          const intelRows = await tx.systemSetting.findMany({
            where: { key: { in: validStale.map(w => `wallet.intelligence.${w.id}`) } },
            select: { key: true, value: true },
          });
          for (const row of intelRows) {
            const v = row.value as { automation?: { automated?: unknown } } | null;
            if (v?.automation?.automated === true) automatedIds.add(row.key.slice('wallet.intelligence.'.length));
          }
        }
        // Evict stale automated/spray wallets first (even if survivorship bias inflated their score), then lowest score.
        const evictIds = validStale
          .filter(w => automatedIds.has(w.id) || w.profile === null || w.profile.score < WALLET_INTAKE_LIMITS.evictMaxScore)
          .sort((a, b) => Number(automatedIds.has(b.id)) - Number(automatedIds.has(a.id)) || (a.profile?.score ?? -1) - (b.profile?.score ?? -1))
          .slice(0, Math.min(WALLET_INTAKE_LIMITS.perCycle, pending.length))
          .map(w => w.id);
        if (evictIds.length) {
          out.evicted = (await tx.trackedWallet.updateMany({ where: { id: { in: evictIds } }, data: { active: false } })).count;
          out.capacity += out.evicted;
        }
      }
      const selected = pending.slice(0, Math.min(WALLET_INTAKE_LIMITS.perCycle, out.capacity));
      out.considered = candidates.length;
      if (selected.length) out.added = (await tx.trackedWallet.createMany({ data: selected.map(w => ({ address: w.address, source: 'DISCOVERED', active: true, researchReview: 'PROVISIONAL' })), skipDuplicates: true })).count;
      out.reason = out.capacity === 0 ? 'CAPACITY_REACHED' : 'EVALUATION_ONLY';
    }
    await tx.systemSetting.upsert({ where: { key: WALLET_INTAKE_KEY }, create: { key: WALLET_INTAKE_KEY, value: out }, update: { value: out } });
    return out;
  });
}
