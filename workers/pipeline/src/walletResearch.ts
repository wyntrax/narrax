import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@narra/database';
import { qualifyWallet } from '@narra/smart-money';
import { walletMarketEvidence } from './walletResearchEvidence';

/** Unvalidated research thresholds. Separate from the existing trading consensus and Early Radar. */
export const WALLET_FLOW_LIMITS = { windowMs: 60 * 60_000, newestTradeMs: 15 * 60_000, minEntities: 2,
  minEntityNetSol: 0.5, minLiquidityUsd: 20_000, minHolders: 50, maxHolderAgeMs: 60 * 60_000,
  maxRiskAgeMs: 60 * 60_000, maxTokens: 100, maxTrades: 10_000, horizons: [1,4,24] } as const;

/** Why a candidate token produced no published flow. Counted in `wallet.research.flowHealth`. */
export const WALLET_FLOW_WITHHELD_REASONS = ['TOKEN_UNAVAILABLE','NO_NEW_TRADES','TOO_MANY_TRADES',
  'NO_QUALIFIED_WALLETS','TRADE_STALE','FLOW_BELOW_MINIMUM','FEW_INDEPENDENT_ENTITIES',
  'NO_MARKET_EVIDENCE','THIN_LIQUIDITY','NO_HOLDER_OBSERVATION','FEW_HOLDERS','NO_RISK_OBSERVATION',
  'RISK_BLOCKED'] as const;
export type WalletFlowWithheldReason = typeof WALLET_FLOW_WITHHELD_REASONS[number];
export interface FlowGateFacts {
  tokenAvailable: boolean; trades: number; tooManyTrades: boolean; qualifiedTrades: number;
  newestQualifiedTradeAgeMs: number | null; netSol: number; supportingEntities: number;
  liquidityUsd: number | null; holders: number | null; riskFlags: readonly string[] | null;
}

const BLOCKING_RISK_FLAGS = new Set(['HONEYPOT','MINT_AUTHORITY_ACTIVE','FREEZE_AUTHORITY_ACTIVE']);

/** Returns the first gate that withholds a candidate, in evaluation order, or null when it can publish. */
export function flowWithholdReason(f: FlowGateFacts): WalletFlowWithheldReason | null {
  const L = WALLET_FLOW_LIMITS;
  if (!f.tokenAvailable) return 'TOKEN_UNAVAILABLE';
  if (!f.trades) return 'NO_NEW_TRADES';
  if (f.tooManyTrades) return 'TOO_MANY_TRADES';
  if (!f.qualifiedTrades) return 'NO_QUALIFIED_WALLETS';
  if (f.newestQualifiedTradeAgeMs == null || f.newestQualifiedTradeAgeMs > L.newestTradeMs) return 'TRADE_STALE';
  if (!Number.isFinite(f.netSol) || Math.abs(f.netSol) < L.minEntityNetSol) return 'FLOW_BELOW_MINIMUM';
  if (f.supportingEntities < L.minEntities) return 'FEW_INDEPENDENT_ENTITIES';
  if (f.liquidityUsd == null) return 'NO_MARKET_EVIDENCE';
  if (f.liquidityUsd < L.minLiquidityUsd) return 'THIN_LIQUIDITY';
  if (f.holders == null) return 'NO_HOLDER_OBSERVATION';
  if (f.holders < L.minHolders) return 'FEW_HOLDERS';
  if (f.riskFlags == null) return 'NO_RISK_OBSERVATION';
  if (f.riskFlags.some(flag => BLOCKING_RISK_FLAGS.has(flag))) return 'RISK_BLOCKED';
  return null;
}

type Db = Pick<Prisma.TransactionClient, 'systemSetting'>;
export async function walletQualifications(db: Db, wallets: { id: string; active: boolean; researchReview: string }[], now: Date) {
  const settings = await db.systemSetting.findMany({ where: { key: { in: wallets.flatMap(w => [`wallet.research.${w.id}`, `wallet.history.${w.id}`]) } } });
  const byKey = new Map(settings.map(s => [s.key, s.value]));
  return new Map(wallets.map(w => [w.id, { ...qualifyWallet(w.researchReview, w.active, byKey.get(`wallet.research.${w.id}`), byKey.get(`wallet.history.${w.id}`), now), sample: byKey.get(`wallet.research.${w.id}`) ?? null }]));
}

/** Weak timing-only links can transitively chain unrelated wallets into one mega-cluster; only stronger links collapse entities. */
export function entityKeyForWallet(wallet: { id: string; clusterId: string | null; cluster?: { label: string | null; confidence: string } | null }): string {
  if (!wallet.clusterId) return `wallet:${wallet.id}`;
  if (wallet.cluster?.label === 'timing' && wallet.cluster?.confidence === 'LOW') return `wallet:${wallet.id}`;
  return `cluster:${wallet.clusterId}`;
}

/** Research rows only; no Alert, AI job or order. Call after intelligence refresh. */
export async function publishWalletResearch(db: PrismaClient, clock: () => Date = () => new Date()) {
  const L = WALLET_FLOW_LIMITS, start = clock();
  // Group in the database: `distinct` after `take` can truncate the candidate set when
  // one busy token dominates the newest raw trades.
  const recent = await db.walletTrade.groupBy({
    by: ['tokenId'],
    where: { wallet: { active: true, researchReview: 'APPROVED' }, at: { gte: new Date(+start - L.windowMs), lte: start } },
    _max: { at: true }, orderBy: { _max: { at: 'desc' } }, take: L.maxTokens + 1,
  });
  const out = { considered: Math.min(recent.length, L.maxTokens), created: 0, withheld: 0, capped: recent.length > L.maxTokens,
    withheldReasons: {} as Partial<Record<WalletFlowWithheldReason, number>> };
  for (const { tokenId } of recent.slice(0,L.maxTokens)) {
    const result = await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`wallet-research:${tokenId}`}))`;
      const now = clock();
      const token = await tx.token.findUnique({ where: { id: tokenId }, select: { blacklisted: true } });
      if (!token || token.blacklisted) return { created: false as const, reason: 'TOKEN_UNAVAILABLE' as const };
      const last = await tx.walletResearchSignal.findFirst({ where: { tokenId }, orderBy: { createdAt: 'desc' } });
      const trades = await tx.walletTrade.findMany({ where: { tokenId, wallet: { active: true, researchReview: 'APPROVED' }, at: { gte: new Date(Math.max(+now - L.windowMs, last ? +last.createdAt + 1 : 0)), lte: now } }, orderBy: [{ at: 'asc' }, { id: 'asc' }], take: L.maxTrades + 1, include: { wallet: { include: { cluster: { select: { label: true, confidence: true } } } } } });
      if (!trades.length) return { created: false as const, reason: 'NO_NEW_TRADES' as const };
      if (trades.length > L.maxTrades) return { created: false as const, reason: 'TOO_MANY_TRADES' as const };
      const wallets = [...new Map(trades.map(t => [t.wallet.id,t.wallet])).values()];
      const qualifications = await walletQualifications(tx, wallets, now);
      const qualified = trades.filter(t => qualifications.get(t.walletId)?.eligible);
      if (!qualified.length) return { created: false as const, reason: 'NO_QUALIFIED_WALLETS' as const };
      const entities = new Map<string, number>();
      for (const t of qualified) {
        const key = entityKeyForWallet(t.wallet);
        entities.set(key, (entities.get(key) ?? 0) + (t.side === 'BUY' ? 1 : -1) * Number(t.amountSol));
      }
      const net = [...entities.values()].reduce((sum,n) => sum+n,0);
      const side = net > 0 ? 'BUY' : 'SELL';
      const supporting = [...entities.values()].filter(n => side === 'BUY' ? n >= L.minEntityNetSol : n <= -L.minEntityNetSol).length;
      // Cheap flow gates run before market/holder/risk lookups: most candidate tokens stop here,
      // and walletMarketEvidence can walk several rows before it finds valid provenance.
      if (!Number.isFinite(net) || Math.abs(net) < L.minEntityNetSol) return { created: false as const, reason: 'FLOW_BELOW_MINIMUM' as const };
      if (supporting < L.minEntities) return { created: false as const, reason: 'FEW_INDEPENDENT_ENTITIES' as const };
      if (+now - +qualified.at(-1)!.at > L.newestTradeMs) return { created: false as const, reason: 'TRADE_STALE' as const };
      const [market, holder, risk] = await Promise.all([
        walletMarketEvidence(tx, tokenId, now),
        tx.tokenHolderMetric.findFirst({ where: { tokenId, at: { lte: now, gte: new Date(+now - L.maxHolderAgeMs) } }, orderBy: { at: 'desc' } }),
        tx.tokenRiskMetric.findFirst({ where: { tokenId, at: { lte: now, gte: new Date(+now - L.maxRiskAgeMs) } }, orderBy: { at: 'desc' } }),
      ]);
      const reason = flowWithholdReason({
        tokenAvailable: !!token && !token.blacklisted,
        trades: trades.length, tooManyTrades: trades.length > L.maxTrades, qualifiedTrades: qualified.length,
        newestQualifiedTradeAgeMs: qualified.at(-1) ? +now - +qualified.at(-1)!.at : null,
        netSol: net, supportingEntities: supporting,
        liquidityUsd: market?.liquidityUsd ?? null, holders: holder?.holders ?? null, riskFlags: risk?.flags ?? null,
      });
      if (reason) return { created: false as const, reason };
      const signatures = qualified.map(t => t.signature).sort();
      const dedupeKey = createHash('sha256').update(JSON.stringify([tokenId,side,signatures])).digest('hex');
      await tx.walletResearchSignal.create({ data: { tokenId, side, dedupeKey, walletCount: new Set(qualified.map(t => t.walletId)).size,
        independentEntities: supporting, netFlowSol: net, entryPriceUsd: market!.priceUsd, entryMetricId: market!.metricId, entryAt: new Date(market!.at), createdAt: now,
        evidence: { version: 1, market: market!, holder: { id: holder!.id, at: holder!.at.toISOString(), holders: holder!.holders, top10Pct: holder!.top10Pct }, risk: { id: risk!.id, at: risk!.at.toISOString(), riskScore: risk!.riskScore, flags: risk!.flags }, rules: L,
          wallets: wallets.filter(w => qualifications.get(w.id)?.eligible).map(w => ({ address: w.address, clusterId: w.clusterId, reviewAt: w.researchReviewedAt?.toISOString() ?? null, qualification: qualifications.get(w.id)! })),
          trades: qualified.map(t => ({ id: t.id, wallet: t.wallet.address, signature: t.signature, side: t.side, amountSol: Number(t.amountSol), at: t.at.toISOString() })) } as Prisma.InputJsonValue,
        measurements: { create: L.horizons.map(horizonHours => ({ horizonHours, dueAt: new Date(+now + horizonHours * 3_600_000) })) },
      } });
      return { created: true as const };
    }, { timeout: 30_000 });
    if (result.created) out.created++;
    else {
      out.withheld++;
      out.withheldReasons[result.reason] = (out.withheldReasons[result.reason] ?? 0) + 1;
    }
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
