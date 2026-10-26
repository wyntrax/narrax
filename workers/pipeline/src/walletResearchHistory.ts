import type { PrismaClient } from '@narra/database';
import { collectWalletHistory } from './walletHistory';
import { makeWalletEventStore } from './prismaStores';
import { z } from 'zod';

const Progress = z.object({ checkedAt: z.string().datetime(), capped: z.boolean(), nextBefore: z.string().nullable(),
  scanFrom: z.string().datetime(), scanTo: z.string().datetime(), coveredFrom: z.string().datetime(), coveredTo: z.string().datetime(),
  scanned: z.number().int().nonnegative(), accepted: z.number().int().nonnegative(), skipped: z.number().int().nonnegative() });

/** Opt-in, at most two wallets / three pages each per intelligence cycle. This is
 * reconciliation, not a claim that filtered SWAP history includes all transfers. */
export async function refreshResearchHistory(db: PrismaClient, apiKey: string, now = new Date(), collect = collectWalletHistory) {
  const cursor = await db.systemSetting.findUnique({ where: { key: 'wallet.research.historyCursor' } });
  const after = typeof cursor?.value === 'string' ? cursor.value : null;
  const where = { active: true, researchReview: { not: 'REJECTED' } };
  const wallets = await db.trackedWallet.findMany({ where: { ...where, ...(after ? { id: { gt: after } } : {}) }, orderBy: { id: 'asc' }, take: 2 });
  if (after && wallets.length < 2) wallets.push(...await db.trackedWallet.findMany({ where: { ...where, id: { lte: after } }, orderBy: { id: 'asc' }, take: 2 - wallets.length }));
  const out = { scanned: 0, created: 0, capped: 0, skipped: 0, failures: 0 };
  const store = makeWalletEventStore(db);
  for (const wallet of wallets) {
    const key = `wallet.history.${wallet.id}`;
    const previous = await db.systemSetting.findUnique({ where: { key } });
    const value = previous?.value;
    const checked = value && typeof value === 'object' && !Array.isArray(value) && typeof value.checkedAt === 'string' ? Date.parse(value.checkedAt) : NaN;
    const parsed = Progress.safeParse(value), previousScan = parsed.success ? parsed.data : null;
    const resume = previousScan?.capped && previousScan.nextBefore && Date.parse(previousScan.scanTo) <= +now ? previousScan : null;
    if (!resume && +now >= checked && +now - checked < 12 * 3_600_000) { out.skipped++; continue; }
    try {
      // Finish the fixed window before advancing its head. Subsequent scans fill the gap
      // since the previous head, rather than repeatedly re-reading a busy wallet's first pages.
      const complete = previousScan && !previousScan.capped && Date.parse(previousScan.coveredTo) <= +now ? previousScan : null;
      const history = await collect(wallet.address, { apiKey, now: resume ? new Date(resume.scanTo) : now, maxPages: 3,
        ...(resume ? { before: resume.nextBefore!, since: new Date(resume.scanFrom) } : complete ? { since: new Date(complete.coveredTo) } : {}) });
      for (const e of history.events) if (await store.saveWalletTrade(e) === 'created') out.created++;
      const carry = resume ?? complete;
      const next = { checkedAt: now.toISOString(), scanned: (carry?.scanned ?? 0) + history.scanned,
        accepted: (carry?.accepted ?? 0) + history.events.length, skipped: (carry?.skipped ?? 0) + history.skipped,
        capped: history.capped, nextBefore: history.nextBefore ?? null, scanFrom: history.coveredFrom, scanTo: history.coveredTo,
        coveredFrom: carry?.coveredFrom ?? history.coveredFrom, coveredTo: history.coveredTo, windowDays: 30 };
      await db.systemSetting.upsert({ where: { key }, create: { key, value: next }, update: { value: next } });
      out.scanned++; if (history.capped) out.capped++;
    } catch { out.failures++; }
  }
  const last = wallets.at(-1);
  if (last) await db.systemSetting.upsert({ where: { key: 'wallet.research.historyCursor' }, create: { key: 'wallet.research.historyCursor', value: last.id }, update: { value: last.id } });
  return out;
}
