import type { Prisma, PrismaClient } from '@narra/database';
import {
  classifyStyle, computeConsensus, computeLeaderStats, computeWalletStats, detectTimingClusters, holdingPatterns, rotationRate, walletScore, MIN_CLOSED_LEGS, researchSample,
  type ConsensusEvent, type Entry, type TradeRow, type WalletInfo,
} from '@narra/smart-money';

export interface RecomputeOptions {
  windowDays?: number;
  consensusMinutes?: number;
}

export interface RecomputeSummary {
  walletsScored: number;
  walletsUnscored: number;
  clusters: number;
  consensusSignals: number;
  tradesUsed: number;
}

const WINDOW = '30D';
const toNum = (v: { toString(): string } | null) => (v == null ? 0 : Number(v.toString()));

/**
 * Recomputes wallet scores, leader scores, styles, timing clusters and per-token consensus from stored trades.
 * Everything is calculated from data with fixed rules. No model is involved. Runs in one transaction,
 * so readers never see a half-updated picture.
 */
export async function recomputeWalletIntelligence(db: PrismaClient, now: Date = new Date(), opts: RecomputeOptions = {}): Promise<RecomputeSummary> {
  const windowDays = opts.windowDays ?? 30;
  const consensusMinutes = opts.consensusMinutes ?? 60;
  const since = new Date(now.getTime() - windowDays * 86_400_000);

  const [wallets, rows] = await Promise.all([
    db.trackedWallet.findMany({ where: { active: true }, select: { id: true, clusterId: true, cluster: { select: { label: true } } } }),
    db.walletTrade.findMany({
      where: { at: { gte: since, lte: now }, tokenAmount: { not: null } },
      select: { walletId: true, tokenId: true, side: true, amountSol: true, tokenAmount: true, at: true },
      orderBy: { at: 'asc' },
    }),
  ]);

  // Deactivated wallets keep their history but take no part in scores, clusters or consensus.
  const activeIds = new Set(wallets.map((w) => w.id));
  const trades: TradeRow[] = rows.filter((r) => activeIds.has(r.walletId)).map((r) => ({ wallet: r.walletId, token: r.tokenId, side: r.side, sol: toNum(r.amountSol), qty: toNum(r.tokenAmount), at: r.at }));
  const byWallet = new Map<string, TradeRow[]>();
  for (const t of trades) byWallet.set(t.wallet, [...(byWallet.get(t.wallet) ?? []), t]);

  const buys: Entry[] = trades.filter((t) => t.side === 'BUY').map((t) => ({ wallet: t.wallet, token: t.token, at: t.at }));
  const leaders = computeLeaderStats(buys);
  const { clusters, edges } = detectTimingClusters(buys);

  // Only wallets with no cluster, or a timing cluster, can be reassigned. Clusters from other evidence are left alone.
  const reassignable = new Set(wallets.filter((w) => !w.cluster || w.cluster.label === 'timing').map((w) => w.id));
  const clusterOf = new Map<string, string>();
  clusters.forEach((c, i) => c.wallets.forEach((w) => reassignable.has(w) && clusterOf.set(w, `timing-${i}`)));

  const ops: Prisma.PrismaPromise<unknown>[] = [];
  const info = new Map<string, WalletInfo>();
  const unscored: string[] = [];
  let scored = 0;

  for (const w of wallets) {
    const mine = byWallet.get(w.id) ?? [];
    const stats = computeWalletStats(mine);
    const score = walletScore(stats);
    const sample = researchSample(mine, stats, score, now);
    const researchKey = `wallet.research.${w.id}`;
    ops.push(db.systemSetting.upsert({ where: { key: researchKey }, create: { key: researchKey, value: { ...sample } }, update: { value: { ...sample } } }));
    const key = `wallet.intelligence.${w.id}`;
    const value = { checkedAt: now.toISOString(), windowDays, observedTrades: mine.length, observedBuys: mine.filter(t=>t.side==='BUY').length, observedSells: mine.filter(t=>t.side==='SELL').length, unmatchedSells: stats.unmatchedSells, closedTrades: stats.legs.length, requiredClosedTrades: MIN_CLOSED_LEGS, status: score === null ? 'INSUFFICIENT_HISTORY' : 'READY' };
    ops.push(db.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } }));
    if (score === null) { unscored.push(w.id); continue; }
    const leader = leaders.get(w.id);
    const style = classifyStyle(stats, leader, rotationRate(mine));
    const pat = holdingPatterns(stats.legs);
    const leaderScore = leader?.leaderScore ?? 0;
    // A wallet in a non-timing cluster (for example a funding cluster) keeps it, so linked wallets count once in consensus.
    info.set(w.id, { score, leaderScore, clusterId: clusterOf.get(w.id) ?? (reassignable.has(w.id) ? null : w.clusterId) });
    scored++;

    const profile = { score, leaderScore, style, medianHoldSeconds: stats.medianHoldSeconds == null ? null : Math.round(stats.medianHoldSeconds), bestPattern: pat.best, weakPattern: pat.weak };
    ops.push(db.walletProfile.upsert({ where: { walletId: w.id }, create: { walletId: w.id, ...profile }, update: profile }));
    ops.push(db.walletMetric.create({
      data: { walletId: w.id, window: WINDOW, winRate: stats.winRate ?? 0, pnlSol: stats.pnlSol, closedTrades: stats.legs.length, avgRoi: stats.avgRoi ?? 0, medianRoi: stats.medianRoi ?? 0, maxDrawdown: stats.maxDrawdown, computedAt: now },
    }));
  }
  // A wallet that no longer has enough closed trades loses its profile instead of keeping a stale score.
  if (unscored.length) ops.push(db.walletProfile.deleteMany({ where: { walletId: { in: unscored } } }));

  // Replace timing clusters wholesale.
  ops.push(db.trackedWallet.updateMany({ where: { cluster: { label: 'timing' } }, data: { clusterId: null } }));
  ops.push(db.walletRelationship.deleteMany({ where: { kind: 'TIMING' } }));
  ops.push(db.walletCluster.deleteMany({ where: { label: 'timing' } }));
  let clusterCount = 0;
  for (const c of clusters) {
    const members = c.wallets.filter((w) => reassignable.has(w));
    if (members.length < 2) continue;
    clusterCount++;
    ops.push(db.walletCluster.create({ data: { label: 'timing', confidence: c.confidence, wallets: { connect: members.map((id) => ({ id })) } } }));
  }
  const rel = edges.filter((e) => reassignable.has(e.a) && reassignable.has(e.b));
  if (rel.length) {
    ops.push(db.walletRelationship.createMany({ data: rel.map((e) => ({ fromId: e.a, toId: e.b, kind: 'TIMING', confidence: e.confidence, evidence: { sharedTokens: e.sharedTokens } })) }));
  }

  // Consensus per token over the recent window.
  const cutoff = now.getTime() - consensusMinutes * 60_000;
  const recent = trades.filter((t) => t.at.getTime() >= cutoff);
  const perToken = new Map<string, ConsensusEvent[]>();
  for (const t of recent) perToken.set(t.token, [...(perToken.get(t.token) ?? []), { wallet: t.wallet, side: t.side, sol: t.sol, at: t.at }]);
  let signals = 0;
  for (const [tokenId, events] of perToken) {
    const c = computeConsensus(events, info);
    if (!c) continue;
    signals++;
    ops.push(db.consensusSignal.create({ data: { tokenId, score: c.score, walletCount: c.walletCount, independentEntities: c.independentEntities, leaderCount: c.leaderCount, netFlowSol: c.netFlowSol, timingConcentration: c.timingConcentration, at: now } }));
  }

  await db.$transaction(ops);
  return { walletsScored: scored, walletsUnscored: unscored.length, clusters: clusterCount, consensusSignals: signals, tradesUsed: trades.length };
}
