import type { Prisma, PrismaClient } from '@narra/database';
import { isSolanaAddress, WalletPerformance } from '@narra/shared';
import { z } from 'zod';
import { DISCOVERY_HOLD_LIMITS } from './walletDiscovery';

/** Proven small-cap evidence that must not be discarded by a stale-capacity eviction. */
const provenSmallCapMetrics = (perfValue: unknown) => {
  const parsed = WalletPerformance.safeParse(perfValue);
  if (!parsed.success) return null;
  const smallCap = parsed.data.bands.find(b => b.band === 'SMALL_CAP');
  if (!smallCap || smallCap.closedPositions < 5 || smallCap.closedTokens < 5 || smallCap.observedDays < 7) return null;
  if ((smallCap.winRateLowerBound ?? 0) < 0.5 || smallCap.realisedPnlSol === null || Number(smallCap.realisedPnlSol) <= 0 ||
    (smallCap.medianRoi ?? 0) <= 0 || (smallCap.fastCloseRate ?? 0) > 0.5) return null;
  return { winRateLowerBound: smallCap.winRateLowerBound ?? 0, realisedPnlSol: Number(smallCap.realisedPnlSol) };
};
const hasProvenSmallCapSample = (perfValue: unknown): boolean => provenSmallCapMetrics(perfValue) !== null;

export const WALLET_INTAKE_KEY = 'wallet.evaluation.intake';
/** `evictMaxScore` is a reversible capacity policy: stale provisional wallets below it can be released to make room for new candidates. History is kept and they can be reactivated. */
export const WALLET_INTAKE_LIMITS = { capacity: 200, perCycle: 2, staleProvisionalMs: 7 * 86_400_000, evictMaxScore: 50, evictMaxHoldSeconds: 300, minMedianQuoteSol: 0.01 } as const;
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
      const holdRank = (w: typeof candidates[number]) =>
        w.hold?.stillHolding ? (w.hold.heldMs != null && w.hold.heldMs >= DISCOVERY_HOLD_LIMITS.minHeldMs ? 3 : 2) : w.hold?.stillHolding === false ? 0 : 1;
      const spendSize = (w: typeof candidates[number]) => {
        const value = w.spend?.medianMatchedQuoteSol;
        return w.spend && w.spend.matchedTokens >= 2 && value != null && Number.isFinite(Number(value)) ? Number(value) : -1;
      };
      // Prefer observed holders first, then unprobed candidates, then confirmed dumpers; break ties by known size and repeat participation.
      const pending = candidates.filter(w => !existing.has(w.address)).sort((a,b) =>
        holdRank(b) - holdRank(a) || spendSize(b) - spendSize(a) || b.scannedTokens - a.scannedTokens);
      if (out.capacity === 0 && pending.length > 0) {
        out.evicted = await evictStaleProvisional(tx, now, Math.min(WALLET_INTAKE_LIMITS.perCycle, pending.length));
        out.capacity += out.evicted;
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

/** Releases the oldest stale provisional wallets that have not established a small-cap record.
 * Returns the number actually deactivated. */
async function evictStaleProvisional(tx: Prisma.TransactionClient, now: Date, needed: number): Promise<number> {
  if (needed <= 0 || typeof tx.trackedWallet.updateMany !== 'function') return 0;
  const staleCutoff = new Date(+now - WALLET_INTAKE_LIMITS.staleProvisionalMs);
  const stalePool = await tx.trackedWallet.findMany({
    where: {
      source: 'DISCOVERED',
      active: true,
      researchReview: 'PROVISIONAL',
      createdAt: { lte: staleCutoff },
      OR: [
        { profile: { is: null } },
        { profile: { is: { score: { lt: WALLET_INTAKE_LIMITS.evictMaxScore } } } },
        { profile: { is: { medianHoldSeconds: { lt: WALLET_INTAKE_LIMITS.evictMaxHoldSeconds } } } },
      ],
    },
    select: { id: true, profile: { select: { score: true, medianHoldSeconds: true } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: WALLET_INTAKE_LIMITS.perCycle * 5,
  });
  const perfRows = stalePool.length > 0 && typeof tx.systemSetting.findMany === 'function'
    ? await tx.systemSetting.findMany({ where: { key: { in: stalePool.map(w => `wallet.performance.${w.id}`) } }, select: { key: true, value: true } })
    : [];
  const byKey = new Map(perfRows.map(s => [s.key, s.value]));
  const evictIds = stalePool
    .filter(row => !hasProvenSmallCapSample(byKey.get(`wallet.performance.${row.id}`)))
    .sort((a, b) => (a.profile?.score ?? -1) - (b.profile?.score ?? -1) || (a.profile?.medianHoldSeconds ?? -1) - (b.profile?.medianHoldSeconds ?? -1))
    .slice(0, needed)
    .map(row => row.id);
  if (!evictIds.length) return 0;
  return (await tx.trackedWallet.updateMany({ where: { id: { in: evictIds } }, data: { active: false } })).count;
}

export const WALLET_REACTIVATION_KEY = 'wallet.evaluation.reactivation';

/** Restores inactive wallets that already proved a small-cap record but were released by an
 * earlier capacity policy. Operator-rejected wallets are never touched. At most `perCycle`
 * wallets are reactivated per run; a stale non-proven wallet is released first when full. */
export async function reactivateProvenWallets(db: PrismaClient, now = new Date()) {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('wallet-evaluation-intake'))`;
    const active = await tx.trackedWallet.count({ where: { source: 'DISCOVERED', active: true, researchReview: { not: 'REJECTED' } } });
    let capacity = Math.max(0, WALLET_INTAKE_LIMITS.capacity - active);
    const out = { checkedAt: now.toISOString(), reactivated: 0, evicted: 0, candidates: 0, capacity };
    if (typeof tx.trackedWallet.updateMany !== 'function' || typeof tx.systemSetting.findMany !== 'function') return out;
    const inactive = await tx.trackedWallet.findMany({
      where: { source: 'DISCOVERED', active: false, researchReview: { not: 'REJECTED' } },
      select: { id: true, address: true },
      orderBy: { id: 'asc' },
      take: WALLET_INTAKE_LIMITS.capacity,
    });
    if (!inactive.length) return out;
    const perfRows = await tx.systemSetting.findMany({ where: { key: { in: inactive.map(w => `wallet.performance.${w.id}`) } }, select: { key: true, value: true } });
    const byKey = new Map(perfRows.map(s => [s.key, s.value]));
    const proven = inactive.flatMap(w => {
      const metrics = provenSmallCapMetrics(byKey.get(`wallet.performance.${w.id}`));
      return metrics ? [{ ...w, metrics }] : [];
    }).sort((a, b) => b.metrics.winRateLowerBound - a.metrics.winRateLowerBound ||
      b.metrics.realisedPnlSol - a.metrics.realisedPnlSol || a.id.localeCompare(b.id));
    out.candidates = proven.length;
    if (!proven.length) return out;
    const wanted = Math.min(WALLET_INTAKE_LIMITS.perCycle, proven.length);
    if (capacity < wanted) {
      out.evicted = await evictStaleProvisional(tx, now, wanted - capacity);
      capacity += out.evicted;
    }
    const selected = proven.slice(0, Math.min(wanted, capacity));
    if (selected.length) {
      out.reactivated = (await tx.trackedWallet.updateMany({ where: { id: { in: selected.map(w => w.id) } }, data: { active: true } })).count;
      capacity -= out.reactivated;
    }
    out.capacity = Math.max(0, capacity);
    const value = { ...out, addresses: selected.map(w => w.address) };
    await tx.systemSetting.upsert({ where: { key: WALLET_REACTIVATION_KEY }, create: { key: WALLET_REACTIVATION_KEY, value }, update: { value } });
    return out;
  }, { timeout: 30_000, maxWait: 10_000 });
}
