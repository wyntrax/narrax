import type { Prisma, PrismaClient } from '@narra/database';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import {bulkSettings,bulkProfiles,PUBLICATION_BATCH_SIZE,type ProfilePublication} from './bulkPublication';
import { streamIntelligenceInputs, type IntelligenceTradeRow } from './walletIntelligenceRead';
import { computeWalletPerformance, type PerformanceTrade } from './walletPerformance';
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
  readPages: number;
  loadMs: number;
  computeMs: number;
  publishMs: number;
  publicationOperations: number;
}

const WINDOW = '30D';
export const PERFORMANCE_TRADE_CAP = 10_000;
const toNum = (v: { toString(): string } | null) => (v == null ? 0 : Number(v.toString()));
const plainObject = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** Keeps only the frozen pre-trade DexScreener marketCapUsd provenance needed by `computeWalletPerformance`,
 * converting Prisma Decimals to strings and dropping large raw webhook payloads from V8 heap. */
export function slimPerformanceTrade(row: IntelligenceTradeRow): PerformanceTrade {
  let evidence: PerformanceTrade['evidence'] = null;
  let marketCapUsd: string | null = null;
  if (row.side === 'BUY') {
    const ev = plainObject(row.evidence);
    const market = ev ? plainObject(ev.market) : null;
    if (
      ev &&
      market &&
      typeof ev.eventAt === 'string' &&
      market.source === 'dexscreener' &&
      market.marketCapIsFdv === false &&
      typeof market.at === 'string'
    ) {
      evidence = { eventAt: ev.eventAt, market: { at: market.at, source: 'dexscreener', marketCapIsFdv: false } };
      marketCapUsd = row.marketCapUsd == null ? null : row.marketCapUsd.toString();
    }
  }
  return {
    id: row.id,
    tokenId: row.tokenId,
    side: row.side,
    amountSol: row.amountSol.toString(),
    tokenAmount: row.tokenAmount == null ? null : row.tokenAmount.toString(),
    marketCapUsd,
    evidence,
    at: row.at,
  };
}

/**
 * Recomputes wallet scores, leader scores, styles, timing clusters and per-token consensus from stored trades.
 * Everything is calculated from data with fixed rules. No model is involved. Runs in one transaction,
 * so readers never see a half-updated picture.
 */
export async function recomputeWalletIntelligence(db: PrismaClient, now: Date = new Date(), opts: RecomputeOptions = {}): Promise<RecomputeSummary> {
  const windowDays = opts.windowDays ?? 30;
  const consensusMinutes = opts.consensusMinutes ?? 60;
  const since = new Date(now.getTime() - windowDays * 86_400_000);
  const perfSince = +now - 30 * 86_400_000;
  const sinceMs = +since;
  const consensusCutoff = now.getTime() - consensusMinutes * 60_000;

  const performanceRows = new Map<string, PerformanceTrade[]>();
  const performanceCapped = new Set<string>();
  const byWallet = new Map<string, TradeRow[]>();
  const firstBuyByWallet = new Map<string, Map<string, Date>>();
  const recentPerToken = new Map<string, ConsensusEvent[]>();
  let tradesUsed = 0;

  const started = performance.now();
  const { wallets, pages } = await streamIntelligenceInputs(db, new Date(Math.min(sinceMs, perfSince)), now, (page, activeIds) => {
    for (const row of page) {
      const rowAt = +row.at;
      if (rowAt >= perfSince && !performanceCapped.has(row.walletId)) {
        let mine = performanceRows.get(row.walletId);
        if (!mine) {
          mine = [];
          performanceRows.set(row.walletId, mine);
        }
        if (mine.length >= PERFORMANCE_TRADE_CAP) {
          performanceCapped.add(row.walletId);
        } else {
          mine.push(slimPerformanceTrade(row));
        }
      }
      if (activeIds.has(row.walletId) && row.tokenAmount !== null && rowAt >= sinceMs) {
        const t: TradeRow = {
          wallet: row.walletId,
          token: row.tokenId,
          side: row.side,
          sol: toNum(row.amountSol),
          qty: toNum(row.tokenAmount),
          at: row.at,
        };
        tradesUsed++;
        let mine = byWallet.get(t.wallet);
        if (!mine) {
          mine = [];
          byWallet.set(t.wallet, mine);
        }
        mine.push(t);
        if (row.side === 'BUY') {
          let firsts = firstBuyByWallet.get(t.wallet);
          if (!firsts) {
            firsts = new Map<string, Date>();
            firstBuyByWallet.set(t.wallet, firsts);
          }
          const prev = firsts.get(t.token);
          if (!prev || rowAt < +prev) firsts.set(t.token, row.at);
        }
        if (rowAt >= consensusCutoff) {
          let events = recentPerToken.get(t.token);
          if (!events) {
            events = [];
            recentPerToken.set(t.token, events);
          }
          events.push({ wallet: t.wallet, side: t.side, sol: t.sol, at: t.at });
        }
      }
    }
  });
  const loaded = performance.now();

  const firstBuyEntries: Entry[] = [];
  for (const [wallet, tokens] of firstBuyByWallet) {
    for (const [token, at] of tokens) firstBuyEntries.push({ wallet, token, at });
  }
  firstBuyByWallet.clear();

  const leaders = computeLeaderStats(firstBuyEntries);
  await yieldToEventLoop();
  const { clusters, edges } = detectTimingClusters(firstBuyEntries);
  await yieldToEventLoop();
  firstBuyEntries.length = 0;

  // Only wallets with no cluster, or a timing cluster, can be reassigned. Clusters from other evidence are left alone.
  const reassignable = new Set(wallets.filter((w) => !w.cluster || w.cluster.label === 'timing').map((w) => w.id));
  const clusterOf = new Map<string, string>();
  clusters.forEach((c, i) => c.wallets.forEach((w) => reassignable.has(w) && clusterOf.set(w, `timing-${i}`)));

  const settings:{key:string;value:Prisma.InputJsonValue}[]=[];
  const profiles:ProfilePublication[]=[];
  const metrics:Prisma.WalletMetricCreateManyInput[]=[];
  const clusterData:{members:string[];confidence:Prisma.WalletClusterUncheckedCreateInput['confidence']}[]=[];
  const consensusSignals:Prisma.ConsensusSignalUncheckedCreateInput[]=[];
  const info = new Map<string, WalletInfo>();
  const unscored: string[] = [];
  let scored = 0;

  for (const w of wallets) {
    // Prisma operations below are lazy: yield while preparing them so Redis
    // leases and other queues stay responsive, then publish atomically as before.
    await yieldToEventLoop();
    const performanceKey = `wallet.performance.${w.id}`, observed = performanceRows.get(w.id) ?? [];
    const performance = computeWalletPerformance(observed, now, performanceCapped.has(w.id));
    performanceRows.delete(w.id);
    settings.push({key:performanceKey,value:performance});
    const mine = byWallet.get(w.id) ?? [];
    let observedBuys = 0, observedSells = 0;
    for (const t of mine) { if (t.side === 'BUY') observedBuys++; else observedSells++; }
    const stats = computeWalletStats(mine);
    const score = walletScore(stats);
    const sample = researchSample(mine, stats, score, now);
    const researchKey = `wallet.research.${w.id}`;
    settings.push({key:researchKey,value:{...sample}});
    const key = `wallet.intelligence.${w.id}`;
    const value = { checkedAt: now.toISOString(), windowDays, observedTrades: mine.length, observedBuys, observedSells, unmatchedSells: stats.unmatchedSells, closedTrades: stats.legs.length, requiredClosedTrades: MIN_CLOSED_LEGS, status: score === null ? 'INSUFFICIENT_HISTORY' : 'READY' };
    settings.push({key,value});
    if (score === null) { byWallet.delete(w.id); unscored.push(w.id); continue; }
    const leader = leaders.get(w.id);
    const style = classifyStyle(stats, leader, rotationRate(mine));
    byWallet.delete(w.id);
    const pat = holdingPatterns(stats.legs);
    const leaderScore = leader?.leaderScore ?? 0;
    // A wallet in a non-timing cluster (for example a funding cluster) keeps it, so linked wallets count once in consensus.
    info.set(w.id, { score, leaderScore, clusterId: clusterOf.get(w.id) ?? (reassignable.has(w.id) ? null : w.clusterId) });
    scored++;

    const profile = { score, leaderScore, style, medianHoldSeconds: stats.medianHoldSeconds == null ? null : Math.round(stats.medianHoldSeconds), bestPattern: pat.best, weakPattern: pat.weak };
    profiles.push({walletId:w.id,...profile});
    metrics.push({ walletId: w.id, window: WINDOW, winRate: stats.winRate ?? 0, pnlSol: stats.pnlSol, closedTrades: stats.legs.length, avgRoi: stats.avgRoi ?? 0, medianRoi: stats.medianRoi ?? 0, maxDrawdown: stats.maxDrawdown, computedAt: now });
  }
  // Replace timing clusters wholesale.
  let clusterCount = 0;
  for (const c of clusters) {
    const members = c.wallets.filter((w) => reassignable.has(w));
    if (members.length < 2) continue;
    clusterCount++;
    clusterData.push({ members, confidence: c.confidence });
  }
  const rel = edges.filter((e) => reassignable.has(e.a) && reassignable.has(e.b));

  // Consensus per token over the recent window.
  let processed = 0;
  let signals = 0;
  for (const [tokenId, events] of recentPerToken) {
    if (++processed%2000===0) await yieldToEventLoop();
    const c = computeConsensus(events, info);
    if (!c) continue;
    signals++;
    consensusSignals.push({ tokenId, score: c.score, walletCount: c.walletCount, independentEntities: c.independentEntities, leaderCount: c.leaderCount, netFlowSol: c.netFlowSol, timingConcentration: c.timingConcentration, at: now });
  }

  const prepared=performance.now();
  // Use an interactive transaction so publication gets an explicit budget.
  // Prisma's array form only accepts isolationLevel and otherwise uses its 5s
  // default, which is too short for 200+ wallet/profile/setting writes.
  const consensusToWrite = await filterConsensusWrites(db, consensusSignals, now);
  const publicationOperations=await db.$transaction(async tx=>{
    const ops:Prisma.PrismaPromise<unknown>[]=[];
    ops.push(...bulkSettings(tx,settings),...bulkProfiles(tx,profiles));
    for(let i=0;i<metrics.length;i+=PUBLICATION_BATCH_SIZE)ops.push(tx.walletMetric.createMany({data:metrics.slice(i,i+PUBLICATION_BATCH_SIZE)}));
    // A wallet that no longer has enough closed trades loses its profile instead of keeping a stale score.
    if (unscored.length) ops.push(tx.walletProfile.deleteMany({ where: { walletId: { in: unscored } } }));
    ops.push(tx.trackedWallet.updateMany({ where: { cluster: { label: 'timing' } }, data: { clusterId: null } }));
    ops.push(tx.walletRelationship.deleteMany({ where: { kind: 'TIMING' } }));
    ops.push(tx.walletCluster.deleteMany({ where: { label: 'timing' } }));
    for (const c of clusterData) {
      ops.push(tx.walletCluster.create({ data: { label: 'timing', confidence: c.confidence, wallets: { connect: c.members.map((id) => ({ id })) } } }));
    }
    if (rel.length) {
      ops.push(tx.walletRelationship.createMany({ data: rel.map((e) => ({ fromId: e.a, toId: e.b, kind: 'TIMING', confidence: e.confidence, evidence: { sharedTokens: e.sharedTokens } })) }));
    }
    for (const signal of consensusToWrite) ops.push(tx.consensusSignal.create({ data: signal }));
    for (const op of ops) await op;
    return ops.length;
  },{timeout:30_000,maxWait:10_000});
  await pruneExpiredConsensusSignals(db, now);
  return { walletsScored: scored, walletsUnscored: unscored.length, clusters: clusterCount, consensusSignals: signals, tradesUsed,
    readPages:pages,loadMs:Math.round(loaded-started),computeMs:Math.round(prepared-loaded),publishMs:Math.round(performance.now()-prepared),publicationOperations };
}

/** Skip duplicate unchanged ConsensusSignal writes inside this window while preserving hourly heartbeats. */
export const CONSENSUS_HEARTBEAT_MS = 60 * 60_000;
export const CONSENSUS_RETENTION_MS = 14 * 86_400_000;
export const CONSENSUS_PRUNE_BATCH = 5_000;

type ConsensusSnapshotRow = {
  tokenId: string;
  score: number;
  walletCount: number;
  independentEntities: number;
  leaderCount: number;
  netFlowSol: unknown;
  timingConcentration: number | null;
  at: Date;
};

function consensusMateriallyChanged(prev: ConsensusSnapshotRow, next: Prisma.ConsensusSignalUncheckedCreateInput): boolean {
  return (
    prev.score !== next.score ||
    prev.walletCount !== next.walletCount ||
    prev.independentEntities !== next.independentEntities ||
    prev.leaderCount !== next.leaderCount ||
    Math.abs(Number(prev.netFlowSol) - Number(next.netFlowSol ?? 0)) >= 0.05 ||
    Math.abs((prev.timingConcentration ?? 0) - (next.timingConcentration ?? 0)) >= 0.01
  );
}

/** Deduplicates unchanged consensus rows within `CONSENSUS_HEARTBEAT_MS` while still writing changes immediately. */
export async function filterConsensusWrites(
  db: PrismaClient,
  candidates: Prisma.ConsensusSignalUncheckedCreateInput[],
  now: Date,
): Promise<Prisma.ConsensusSignalUncheckedCreateInput[]> {
  if (!candidates.length || typeof db.consensusSignal?.findMany !== 'function') return candidates;
  const existing = (await db.consensusSignal.findMany({
    where: { tokenId: { in: candidates.map((c) => c.tokenId) } },
    orderBy: [{ tokenId: 'asc' }, { at: 'desc' }],
    distinct: ['tokenId'],
  })) as ConsensusSnapshotRow[];
  const latestByToken = new Map(existing.map((row) => [row.tokenId, row]));
  return candidates.filter((candidate) => {
    const prev = latestByToken.get(candidate.tokenId);
    if (!prev) return true;
    if (+prev.at > +now || +now - +prev.at >= CONSENSUS_HEARTBEAT_MS) return true;
    return consensusMateriallyChanged(prev, candidate);
  });
}

/** Deletes expired ConsensusSignal rows in indexed bounded batches. */
export async function pruneExpiredConsensusSignals(db: PrismaClient, now: Date): Promise<number> {
  if (typeof db.consensusSignal?.findMany !== 'function' || typeof db.consensusSignal?.deleteMany !== 'function') return 0;
  const cutoff = new Date(now.getTime() - CONSENSUS_RETENTION_MS);
  const stale = await db.consensusSignal.findMany({
    where: { at: { lt: cutoff } },
    orderBy: { at: 'asc' },
    take: CONSENSUS_PRUNE_BATCH,
    select: { id: true },
  });
  if (!stale.length) return 0;
  await db.consensusSignal.deleteMany({ where: { id: { in: stale.map((r) => r.id) } } });
  return stale.length;
}
