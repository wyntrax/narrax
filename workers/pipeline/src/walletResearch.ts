import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@narra/database';
import { qualifyWallet } from '@narra/smart-money';
import { walletMarketEvidence } from './walletResearchEvidence';

/** Unvalidated research thresholds. Separate from the existing trading consensus and Early Radar. */
export const WALLET_FLOW_LIMITS = { windowMs: 60 * 60_000, newestTradeMs: 15 * 60_000, minEntities: 2,
  minEntityNetSol: 0.5, minLiquidityUsd: 20_000, minHolders: 50, maxHolderAgeMs: 60 * 60_000,
  maxRiskAgeMs: 60 * 60_000, maxTokens: 100, maxTrades: 10_000, pendingMs: 60 * 60_000, horizons: [1,4,24] } as const;

/** Why a candidate token produced no published flow. Counted in `wallet.research.flowHealth`. */
export const WALLET_FLOW_WITHHELD_REASONS = ['TOKEN_UNAVAILABLE','NO_NEW_TRADES','TOO_MANY_TRADES',
  'NO_QUALIFIED_WALLETS','TRADE_STALE','FLOW_BELOW_MINIMUM','FEW_INDEPENDENT_ENTITIES',
  'NO_MARKET_EVIDENCE','THIN_LIQUIDITY','NO_HOLDER_OBSERVATION','FEW_HOLDERS','NO_RISK_OBSERVATION',
  'RISK_BLOCKED','DUPLICATE_SIGNAL'] as const;
export type WalletFlowWithheldReason = typeof WALLET_FLOW_WITHHELD_REASONS[number];

/** Evidence gaps that can resolve on their own. These are retried instead of discarded. */
const PENDING_EVIDENCE_REASONS = new Set<WalletFlowWithheldReason>([
  'NO_MARKET_EVIDENCE','THIN_LIQUIDITY','NO_HOLDER_OBSERVATION','FEW_HOLDERS','NO_RISK_OBSERVATION',
]);
export interface FlowGateFacts {
  tokenAvailable: boolean; trades: number; tooManyTrades: boolean; qualifiedTrades: number;
  newestQualifiedTradeAgeMs: number | null; netSol: number; supportingEntities: number;
  liquidityUsd: number | null; holders: number | null; riskFlags: readonly string[] | null;
}

const BLOCKING_RISK_FLAGS = new Set(['HONEYPOT','MINT_AUTHORITY_ACTIVE','FREEZE_AUTHORITY_ACTIVE']);

/** Wallet-flow gates only. Pending retries use this without the newest-trade age gate. */
export function flowGateReason(f: Omit<FlowGateFacts,'liquidityUsd'|'holders'|'riskFlags'>): WalletFlowWithheldReason | null {
  const L = WALLET_FLOW_LIMITS;
  if (!f.tokenAvailable) return 'TOKEN_UNAVAILABLE';
  if (!f.trades) return 'NO_NEW_TRADES';
  if (f.tooManyTrades) return 'TOO_MANY_TRADES';
  if (!f.qualifiedTrades) return 'NO_QUALIFIED_WALLETS';
  if (f.newestQualifiedTradeAgeMs == null || f.newestQualifiedTradeAgeMs > L.newestTradeMs) return 'TRADE_STALE';
  if (!Number.isFinite(f.netSol) || Math.abs(f.netSol) < L.minEntityNetSol) return 'FLOW_BELOW_MINIMUM';
  if (f.supportingEntities < L.minEntities) return 'FEW_INDEPENDENT_ENTITIES';
  return null;
}

/** Returns the first gate that withholds a candidate, in evaluation order, or null when it can publish. */
export function flowWithholdReason(f: FlowGateFacts): WalletFlowWithheldReason | null {
  const L = WALLET_FLOW_LIMITS;
  const gate = flowGateReason(f);
  if (gate) return gate;
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

type TradeWithWallet = Prisma.WalletTradeGetPayload<{
  include: { wallet: { include: { cluster: { select: { label: true; confidence: true } } } } };
}>;

async function evaluateFlowTrades(db: Pick<Prisma.TransactionClient, 'systemSetting'>, trades: TradeWithWallet[], now: Date) {
  const wallets = [...new Map(trades.map(t => [t.wallet.id, t.wallet])).values()];
  const qualifications = await walletQualifications(db, wallets, now);
  const qualified = trades.filter(t => qualifications.get(t.walletId)?.eligible);
  const entities = new Map<string, number>();
  for (const t of qualified) {
    const key = entityKeyForWallet(t.wallet);
    entities.set(key, (entities.get(key) ?? 0) + (t.side === 'BUY' ? 1 : -1) * Number(t.amountSol));
  }
  const net = [...entities.values()].reduce((sum, n) => sum + n, 0);
  const side: 'BUY' | 'SELL' = net > 0 ? 'BUY' : 'SELL';
  const supporting = [...entities.values()].filter(n => side === 'BUY' ? n >= WALLET_FLOW_LIMITS.minEntityNetSol : n <= -WALLET_FLOW_LIMITS.minEntityNetSol).length;
  return { wallets, qualifications, qualified, entities, net, side, supporting };
}
type FlowFacts = Awaited<ReturnType<typeof evaluateFlowTrades>>;

async function flowEvidence(db: Pick<Prisma.TransactionClient, 'systemSetting' | 'tokenMetric' | 'tokenHolderMetric' | 'tokenRiskMetric'>, tokenId: string, now: Date) {
  const L = WALLET_FLOW_LIMITS;
  return Promise.all([
    walletMarketEvidence(db, tokenId, now),
    db.tokenHolderMetric.findFirst({ where: { tokenId, at: { lte: now, gte: new Date(+now - L.maxHolderAgeMs) } }, orderBy: { at: 'desc' } }),
    db.tokenRiskMetric.findFirst({ where: { tokenId, at: { lte: now, gte: new Date(+now - L.maxRiskAgeMs) } }, orderBy: { at: 'desc' } }),
  ]);
}
type FlowEvidence = Awaited<ReturnType<typeof flowEvidence>>;

/** Creates one immutable signal and clears any pending candidate for the token. */
async function createFlowSignal(tx: Prisma.TransactionClient, tokenId: string, facts: FlowFacts, evidence: FlowEvidence, now: Date) {
  const [market, holder, risk] = evidence;
  const signatures = facts.qualified.map(t => t.signature).sort();
  const dedupeKey = createHash('sha256').update(JSON.stringify([tokenId, facts.side, signatures])).digest('hex');
  const existing = await tx.walletResearchSignal.findUnique({ where: { dedupeKey }, select: { id: true } });
  if (existing) {
    await tx.walletFlowCandidate.deleteMany({ where: { tokenId } });
    return false;
  }
  await tx.walletResearchSignal.create({ data: {
    tokenId, side: facts.side, dedupeKey, walletCount: new Set(facts.qualified.map(t => t.walletId)).size,
    independentEntities: facts.supporting, netFlowSol: facts.net, entryPriceUsd: market!.priceUsd, entryMetricId: market!.metricId,
    entryAt: new Date(market!.at), createdAt: now,
    evidence: { version: 1, market: market!, holder: { id: holder!.id, at: holder!.at.toISOString(), holders: holder!.holders, top10Pct: holder!.top10Pct }, risk: { id: risk!.id, at: risk!.at.toISOString(), riskScore: risk!.riskScore, flags: risk!.flags }, rules: WALLET_FLOW_LIMITS,
      wallets: facts.wallets.filter(w => facts.qualifications.get(w.id)?.eligible).map(w => ({ address: w.address, clusterId: w.clusterId, reviewAt: w.researchReviewedAt?.toISOString() ?? null, qualification: facts.qualifications.get(w.id)! })),
      trades: facts.qualified.map(t => ({ id: t.id, wallet: t.wallet.address, signature: t.signature, side: t.side, amountSol: Number(t.amountSol), at: t.at.toISOString() })) } as Prisma.InputJsonValue,
    measurements: { create: WALLET_FLOW_LIMITS.horizons.map(horizonHours => ({ horizonHours, dueAt: new Date(+now + horizonHours * 3_600_000) })) },
  } });
  await tx.walletFlowCandidate.deleteMany({ where: { tokenId } });
  return true;
}

/** Stores a flow whose wallet gates passed but whose evidence can still arrive. */
async function rememberPending(tx: Prisma.TransactionClient, tokenId: string, facts: FlowFacts, now: Date, reason: WalletFlowWithheldReason) {
  const signatures = facts.qualified.map(t => t.signature).sort();
  const data = { side: facts.side, netFlowSol: facts.net, supportingEntities: facts.supporting,
    walletCount: new Set(facts.qualified.map(t => t.walletId)).size, signatures, lastAttemptAt: now, lastReason: reason };
  await tx.walletFlowCandidate.upsert({ where: { tokenId },
    create: { tokenId, ...data, firstFlowAt: now, expiresAt: new Date(+now + WALLET_FLOW_LIMITS.pendingMs) }, update: data });
}

/** Retries stored flow candidates whose market/holder/risk evidence was missing. */
async function processPendingFlows(db: PrismaClient, clock: () => Date) {
  const L = WALLET_FLOW_LIMITS;
  const out = { created: 0, expired: 0, expiredReasons: {} as Record<string, number> };
  const now = clock();
  const rows = await db.walletFlowCandidate.findMany({ where: { expiresAt: { gt: now } }, orderBy: [{ firstFlowAt: 'asc' }, { id: 'asc' }], take: 100 });
  for (const row of rows) {
    const result = await db.$transaction(async tx => {
      const attemptAt = clock();
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`wallet-research:${row.tokenId}`}))`;
      const token = await tx.token.findUnique({ where: { id: row.tokenId }, select: { blacklisted: true } });
      if (!token || token.blacklisted) {
        await tx.walletFlowCandidate.deleteMany({ where: { id: row.id } });
        return { status: 'expired' as const, reason: 'TOKEN_UNAVAILABLE' };
      }
      const trades = await tx.walletTrade.findMany({ where: { signature: { in: row.signatures } },
        include: { wallet: { include: { cluster: { select: { label: true, confidence: true } } } } } });
      if (trades.length !== row.signatures.length || trades.some(t => t.tokenId !== row.tokenId)) {
        await tx.walletFlowCandidate.deleteMany({ where: { id: row.id } });
        return { status: 'expired' as const, reason: 'TRADES_UNAVAILABLE' };
      }
      const facts = await evaluateFlowTrades(tx, trades, attemptAt);
      if (!facts.qualified.length) {
        await tx.walletFlowCandidate.deleteMany({ where: { id: row.id } });
        return { status: 'expired' as const, reason: 'NO_QUALIFIED_WALLETS' };
      }
      // The pending window intentionally replaces the newest-trade age gate.
      const gate = flowGateReason({ tokenAvailable: true, trades: trades.length, tooManyTrades: trades.length > L.maxTrades,
        qualifiedTrades: facts.qualified.length, newestQualifiedTradeAgeMs: 0, netSol: facts.net, supportingEntities: facts.supporting });
      if (gate) {
        await tx.walletFlowCandidate.deleteMany({ where: { id: row.id } });
        return { status: 'expired' as const, reason: gate };
      }
      const evidence = await flowEvidence(tx, row.tokenId, attemptAt);
      const reason = flowWithholdReason({ tokenAvailable: true, trades: trades.length, tooManyTrades: trades.length > L.maxTrades,
        qualifiedTrades: facts.qualified.length, newestQualifiedTradeAgeMs: 0, netSol: facts.net, supportingEntities: facts.supporting,
        liquidityUsd: evidence[0]?.liquidityUsd ?? null, holders: evidence[1]?.holders ?? null, riskFlags: evidence[2]?.flags ?? null });
      if (reason) {
        if (PENDING_EVIDENCE_REASONS.has(reason)) {
          const signatures = facts.qualified.map(t => t.signature).sort();
          await tx.walletFlowCandidate.update({ where: { id: row.id }, data: {
            side: facts.side, netFlowSol: facts.net, supportingEntities: facts.supporting,
            walletCount: new Set(facts.qualified.map(t => t.walletId)).size, signatures,
            lastAttemptAt: attemptAt, lastReason: reason,
          } });
          return { status: 'pending' as const };
        }
        await tx.walletFlowCandidate.deleteMany({ where: { id: row.id } });
        return { status: 'expired' as const, reason };
      }
      const created = await createFlowSignal(tx, row.tokenId, facts, evidence, attemptAt);
      return { status: created ? 'created' as const : 'duplicate' as const };
    }, { timeout: 30_000 });
    if (result.status === 'created') out.created++;
    else if (result.status === 'expired') {
      out.expired++;
      out.expiredReasons[result.reason] = (out.expiredReasons[result.reason] ?? 0) + 1;
    }
  }
  // Rows that missed the evidence window are counted once, with their last known blocker.
  const expired = await db.walletFlowCandidate.findMany({ where: { expiresAt: { lte: clock() } }, orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }], take: 100 });
  for (const row of expired) {
    const deleted = await db.walletFlowCandidate.deleteMany({ where: { id: row.id, expiresAt: { lte: clock() } } });
    if (deleted.count) {
      out.expired++;
      out.expiredReasons[row.lastReason] = (out.expiredReasons[row.lastReason] ?? 0) + 1;
    }
  }
  return out;
}

/** Research rows only; no Alert, AI job or order. Call after intelligence refresh. */
export async function publishWalletResearch(db: PrismaClient, clock: () => Date = () => new Date()) {
  const L = WALLET_FLOW_LIMITS, start = clock();
  const pending = await processPendingFlows(db, clock);
  // Group in the database: `distinct` after `take` can truncate the candidate set when
  // one busy token dominates the newest raw trades.
  const recent = await db.walletTrade.groupBy({
    by: ['tokenId'],
    where: { wallet: { active: true, researchReview: 'APPROVED' }, at: { gte: new Date(+start - L.windowMs), lte: start } },
    _max: { at: true }, orderBy: { _max: { at: 'desc' } }, take: L.maxTokens + 1,
  });
  const out = { considered: Math.min(recent.length, L.maxTokens), created: pending.created, withheld: 0, capped: recent.length > L.maxTokens,
    withheldReasons: {} as Partial<Record<WalletFlowWithheldReason, number>>,
    pending: 0, pendingPublished: pending.created, pendingExpired: pending.expired,
    pendingReasons: {} as Record<string, number>, pendingExpiredReasons: pending.expiredReasons };
  for (const { tokenId } of recent.slice(0,L.maxTokens)) {
    const result = await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`wallet-research:${tokenId}`}))`;
      const now = clock();
      const token = await tx.token.findUnique({ where: { id: tokenId }, select: { blacklisted: true } });
      if (!token || token.blacklisted) return { status: 'withheld' as const, reason: 'TOKEN_UNAVAILABLE' as const };
      const last = await tx.walletResearchSignal.findFirst({ where: { tokenId }, orderBy: { createdAt: 'desc' } });
      const trades = await tx.walletTrade.findMany({ where: { tokenId, wallet: { active: true, researchReview: 'APPROVED' }, at: { gte: new Date(Math.max(+now - L.windowMs, last ? +last.createdAt + 1 : 0)), lte: now } }, orderBy: [{ at: 'asc' }, { id: 'asc' }], take: L.maxTrades + 1, include: { wallet: { include: { cluster: { select: { label: true, confidence: true } } } } } });
      if (!trades.length) return { status: 'withheld' as const, reason: 'NO_NEW_TRADES' as const };
      if (trades.length > L.maxTrades) return { status: 'withheld' as const, reason: 'TOO_MANY_TRADES' as const };
      const facts = await evaluateFlowTrades(tx, trades, now);
      if (!facts.qualified.length) return { status: 'withheld' as const, reason: 'NO_QUALIFIED_WALLETS' as const };
      const gate = flowGateReason({ tokenAvailable: true, trades: trades.length, tooManyTrades: trades.length > L.maxTrades,
        qualifiedTrades: facts.qualified.length, newestQualifiedTradeAgeMs: facts.qualified.at(-1) ? +now - +facts.qualified.at(-1)!.at : null,
        netSol: facts.net, supportingEntities: facts.supporting });
      if (gate) return { status: 'withheld' as const, reason: gate };
      const evidence = await flowEvidence(tx, tokenId, now);
      const reason = flowWithholdReason({ tokenAvailable: true, trades: trades.length, tooManyTrades: trades.length > L.maxTrades,
        qualifiedTrades: facts.qualified.length, newestQualifiedTradeAgeMs: facts.qualified.at(-1) ? +now - +facts.qualified.at(-1)!.at : null,
        netSol: facts.net, supportingEntities: facts.supporting,
        liquidityUsd: evidence[0]?.liquidityUsd ?? null, holders: evidence[1]?.holders ?? null, riskFlags: evidence[2]?.flags ?? null });
      if (reason) {
        if (PENDING_EVIDENCE_REASONS.has(reason)) {
          await rememberPending(tx, tokenId, facts, now, reason);
          return { status: 'pending' as const };
        }
        return { status: 'withheld' as const, reason };
      }
      const created = await createFlowSignal(tx, tokenId, facts, evidence, now);
      return created ? { status: 'created' as const } : { status: 'withheld' as const, reason: 'DUPLICATE_SIGNAL' as const };
    }, { timeout: 30_000 });
    if (result.status === 'created') out.created++;
    else if (result.status === 'withheld') {
      out.withheld++;
      out.withheldReasons[result.reason] = (out.withheldReasons[result.reason] ?? 0) + 1;
    }
    // A pending result is counted by the active-pending snapshot below, not as withheld.
  }
  const activePending = await db.walletFlowCandidate.findMany({ where: { expiresAt: { gt: clock() } }, select: { lastReason: true } });
  out.pending = activePending.length;
  for (const row of activePending) out.pendingReasons[row.lastReason] = (out.pendingReasons[row.lastReason] ?? 0) + 1;
  const value = { ...out, checkedAt: clock().toISOString() };
  await db.systemSetting.upsert({ where: { key: 'wallet.research.flowHealth' }, create: { key: 'wallet.research.flowHealth', value }, update: { value } });
  return out;
}

/** Measured token returns, including SELL observations, are never presented as wallet PnL.
 * Every horizon uses a source-backed price at/before its own due time, never a later recovery.
 * A horizon whose price came from a pool below the flow liquidity gate is UNKNOWN, not a return. */
export async function measureWalletResearch(db: PrismaClient, now = new Date()) {
  const pending = await db.walletResearchMeasurement.findMany({ where: { status: 'PENDING', dueAt: { lte: now } }, orderBy: [{ dueAt: 'asc' }, { id: 'asc' }], take: 200, include: { signal: true } });
  let measured = 0, unknown = 0;
  for (const row of pending) {
    const market = await walletMarketEvidence(db, row.signal.tokenId, row.dueAt);
    const entry = Number(row.signal.entryPriceUsd);
    const liquid = market !== null && Number.isFinite(market.liquidityUsd) && market.liquidityUsd >= WALLET_FLOW_LIMITS.minLiquidityUsd;
    const result = liquid && entry > 0 ? (market!.priceUsd / entry - 1) * 100 : null;
    const valid = result !== null && Number.isFinite(result);
    const reason = !market ? 'NO_FRESH_SOURCE_BACKED_HORIZON_PRICE' : !liquid ? 'THIN_LIQUIDITY' : entry <= 0 ? 'INVALID_ENTRY_PRICE' : 'NO_FRESH_SOURCE_BACKED_HORIZON_PRICE';
    const updated = await db.walletResearchMeasurement.updateMany({ where: { id: row.id, status: 'PENDING' }, data: valid ? { status: 'MEASURED', priceUsd: market!.priceUsd, priceAt: new Date(market!.at), metricId: market!.metricId, returnPct: result, measuredAt: now } : { status: 'UNKNOWN', reason, measuredAt: now } });
    if (updated.count) { if (valid) measured++; else unknown++; }
  }
  return { measured, unknown };
}
