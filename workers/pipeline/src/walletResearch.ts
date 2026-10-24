import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@narra/database';
import { qualifyWallet } from '@narra/smart-money';
import { walletMarketEvidence } from './walletResearchEvidence';

/** Unvalidated research thresholds. Separate from the existing trading consensus and Early Radar. */
export const WALLET_FLOW_LIMITS = { windowMs: 60 * 60_000, newestTradeMs: 15 * 60_000, minEntities: 2,
  minEntityNetSol: 0.5, minLiquidityUsd: 20_000, minHolders: 50, maxHolderAgeMs: 60 * 60_000,
  maxRiskAgeMs: 60 * 60_000, maxTokens: 100, maxTrades: 10_000, horizons: [1,4,24] } as const;

type Db = Pick<Prisma.TransactionClient, 'systemSetting'>;
export async function walletQualifications(db: Db, wallets: { id: string; active: boolean; researchReview: string }[], now: Date) {
  const settings = await db.systemSetting.findMany({ where: { key: { in: wallets.flatMap(w => [`wallet.research.${w.id}`, `wallet.history.${w.id}`]) } } });
  const byKey = new Map(settings.map(s => [s.key, s.value]));
  return new Map(wallets.map(w => [w.id, { ...qualifyWallet(w.researchReview, w.active, byKey.get(`wallet.research.${w.id}`), byKey.get(`wallet.history.${w.id}`), now), sample: byKey.get(`wallet.research.${w.id}`) ?? null }]));
}

/** Research rows only; no Alert, AI job or order. Call after intelligence refresh. */
export async function publishWalletResearch(db: PrismaClient, clock: () => Date = () => new Date()) {
  const L = WALLET_FLOW_LIMITS, start = clock();
  const recent = await db.walletTrade.findMany({ where: { wallet: { active: true, researchReview: 'APPROVED' }, at: { gte: new Date(+start - L.windowMs), lte: start } }, distinct: ['tokenId'], orderBy: { at: 'desc' }, take: L.maxTokens + 1, select: { tokenId: true } });
  const out = { considered: Math.min(recent.length, L.maxTokens), created: 0, withheld: 0, capped: recent.length > L.maxTokens };
  for (const { tokenId } of recent.slice(0,L.maxTokens)) {
    const created = await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`wallet-research:${tokenId}`}))`;
      const now = clock();
      const token = await tx.token.findUnique({ where: { id: tokenId }, select: { blacklisted: true } });
      if (!token || token.blacklisted) return false;
      const last = await tx.walletResearchSignal.findFirst({ where: { tokenId }, orderBy: { createdAt: 'desc' } });
      const trades = await tx.walletTrade.findMany({ where: { tokenId, wallet: { active: true, researchReview: 'APPROVED' }, at: { gte: new Date(Math.max(+now - L.windowMs, last ? +last.createdAt + 1 : 0)), lte: now } }, orderBy: [{ at: 'asc' }, { id: 'asc' }], take: L.maxTrades + 1, include: { wallet: true } });
      if (!trades.length || trades.length > L.maxTrades) return false;
      const wallets = [...new Map(trades.map(t => [t.wallet.id,t.wallet])).values()];
      const qualifications = await walletQualifications(tx, wallets, now);
      const qualified = trades.filter(t => qualifications.get(t.walletId)?.eligible);
      if (!qualified.length || +now - +qualified.at(-1)!.at > L.newestTradeMs) return false;
      const entities = new Map<string, number>();
      for (const t of qualified) {
        const key = t.wallet.clusterId ? `cluster:${t.wallet.clusterId}` : `wallet:${t.walletId}`;
        entities.set(key, (entities.get(key) ?? 0) + (t.side === 'BUY' ? 1 : -1) * Number(t.amountSol));
      }
      const net = [...entities.values()].reduce((sum,n) => sum+n,0);
      const side = net > 0 ? 'BUY' : 'SELL';
      const supporting = [...entities.values()].filter(n => side === 'BUY' ? n >= L.minEntityNetSol : n <= -L.minEntityNetSol).length;
      if (!Number.isFinite(net) || Math.abs(net) < L.minEntityNetSol || supporting < L.minEntities) return false;
      const [market, holder, risk] = await Promise.all([
        walletMarketEvidence(tx, tokenId, now),
        tx.tokenHolderMetric.findFirst({ where: { tokenId, at: { lte: now, gte: new Date(+now - L.maxHolderAgeMs) } }, orderBy: { at: 'desc' } }),
        tx.tokenRiskMetric.findFirst({ where: { tokenId, at: { lte: now, gte: new Date(+now - L.maxRiskAgeMs) } }, orderBy: { at: 'desc' } }),
      ]);
      if (!market || market.liquidityUsd < L.minLiquidityUsd || !holder || holder.holders < L.minHolders || !risk || risk.flags.some(f => f === 'HONEYPOT' || f === 'MINT_AUTHORITY_ACTIVE' || f === 'FREEZE_AUTHORITY_ACTIVE')) return false;
      const signatures = qualified.map(t => t.signature).sort();
      const dedupeKey = createHash('sha256').update(JSON.stringify([tokenId,side,signatures])).digest('hex');
      await tx.walletResearchSignal.create({ data: { tokenId, side, dedupeKey, walletCount: new Set(qualified.map(t => t.walletId)).size,
        independentEntities: supporting, netFlowSol: net, entryPriceUsd: market.priceUsd, entryMetricId: market.metricId, entryAt: new Date(market.at), createdAt: now,
        evidence: { version: 1, market, holder: { id: holder.id, at: holder.at.toISOString(), holders: holder.holders, top10Pct: holder.top10Pct }, risk: { id: risk.id, at: risk.at.toISOString(), riskScore: risk.riskScore, flags: risk.flags }, rules: L,
          wallets: wallets.filter(w => qualifications.get(w.id)?.eligible).map(w => ({ address: w.address, clusterId: w.clusterId, reviewAt: w.researchReviewedAt?.toISOString() ?? null, qualification: qualifications.get(w.id)! })),
          trades: qualified.map(t => ({ id: t.id, wallet: t.wallet.address, signature: t.signature, side: t.side, amountSol: Number(t.amountSol), at: t.at.toISOString() })) } as Prisma.InputJsonValue,
        measurements: { create: L.horizons.map(horizonHours => ({ horizonHours, dueAt: new Date(+now + horizonHours * 3_600_000) })) },
      } });
      return true;
    }, { timeout: 30_000 });
    if (created) out.created++; else out.withheld++;
  }
  const value = { ...out, checkedAt: clock().toISOString() };
  await db.systemSetting.upsert({ where: { key: 'wallet.research.flowHealth' }, create: { key: 'wallet.research.flowHealth', value }, update: { value } });
  return out;
}

/** Measured token returns, including SELL observations, are never presented as wallet PnL.
 * Every horizon uses a source-backed price at/before its own due time, never a later recovery. */
export async function measureWalletResearch(db: PrismaClient, now = new Date()) {
  const pending = await db.walletResearchMeasurement.findMany({ where: { status: 'PENDING', dueAt: { lte: now } }, orderBy: [{ dueAt: 'asc' }, { id: 'asc' }], take: 200, include: { signal: true } });
  let measured = 0, unknown = 0;
  for (const row of pending) {
    const market = await walletMarketEvidence(db, row.signal.tokenId, row.dueAt);
    const entry = Number(row.signal.entryPriceUsd);
    const result = market && entry > 0 ? (market.priceUsd / entry - 1) * 100 : null;
    const valid = result !== null && Number.isFinite(result);
    const updated = await db.walletResearchMeasurement.updateMany({ where: { id: row.id, status: 'PENDING' }, data: valid ? { status: 'MEASURED', priceUsd: market!.priceUsd, priceAt: new Date(market!.at), metricId: market!.metricId, returnPct: result, measuredAt: now } : { status: 'UNKNOWN', reason: 'NO_FRESH_SOURCE_BACKED_HORIZON_PRICE', measuredAt: now } });
    if (updated.count) { if (valid) measured++; else unknown++; }
  }
  return { measured, unknown };
}
