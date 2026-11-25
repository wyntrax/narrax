import { Prisma, type PrismaClient } from '@narra/database';
import { WalletAutomationSummary, WalletPerformance, WalletRankingPage, isFreshTimestamp, parseFlowSuitability, walletHistoryCoverage, type WalletEntryBand } from '@narra/shared';

function parseAutomation(intelligenceValue: unknown): WalletAutomationSummary | null {
  if (!intelligenceValue || typeof intelligenceValue !== 'object' || Array.isArray(intelligenceValue)) return null;
  const parsed = WalletAutomationSummary.safeParse((intelligenceValue as { automation?: unknown }).automation);
  return parsed.success ? parsed.data : null;
}

export function rankingReasons(performance: WalletPerformance, band: WalletPerformance['bands'][number], history: unknown, now: Date, linked: boolean, developer: boolean, minMedianPositionSol = 0.01, automated = false) {
  const reasons: string[] = [];
  const scope = performance.bands?.find((b) => b.band === 'ALL') ?? band;
  const { historyComplete, deepLiveSample } = walletHistoryCoverage(performance, history, now, band);
  if (!historyComplete && !deepLiveSample) reasons.push('HISTORY_INCOMPLETE');
  if (!isFreshTimestamp(performance.checkedAt,now,45*60_000)) reasons.push('PERFORMANCE_STALE');
  if (!isFreshTimestamp(performance.lastTradeAt,now,86_400_000)) reasons.push('ACTIVITY_STALE');
  if (performance.capped) reasons.push('TRADE_LIMIT');
  const unmatchedLimit = scope.closedPositions >= 100 ? Math.floor(scope.closedPositions * 0.015) : 0;
  if (performance.invalidTrades || performance.unmatchedSells > unmatchedLimit) reasons.push('INCOMPLETE_COST_BASIS');
  if (band.closedPositions<20 || band.closedTokens<5 || band.observedDays<7) reasons.push('SMALL_SAMPLE');
  if (band.medianClosedPositionSol == null) reasons.push('POSITION_SIZE_UNKNOWN');
  else if (new Prisma.Decimal(band.medianClosedPositionSol).lt(minMedianPositionSol)) reasons.push('SMALL_POSITIONS');
  if (band.realisedPnlSol===null || new Prisma.Decimal(band.realisedPnlSol).lte(0) || (band.medianRoi??0)<=0) reasons.push('POSITIVE_RESULTS_REQUIRED');
  if ((band.deadBagPositions??0)>0 && band.deadBagCostSol!=null && band.realisedPnlSol!=null && new Prisma.Decimal(band.realisedPnlSol).minus(band.deadBagCostSol).lte(0)) reasons.push('DEAD_BAG_OVERHANG');
  if ((band.winRateLowerBound??0)<0.5) reasons.push('LOW_WIN_CONFIDENCE');
  if (band.band==='UNKNOWN' || band.band==='ALL' || band.band==='OVER_1M') reasons.push('SMALL_CAP_UNPROVEN');
  if ((band.fastCloseRate??0)>0.5) reasons.push('FAST_EXITS');
  if (automated) reasons.push('AUTOMATED_BEHAVIOR');
  if (linked) reasons.push('LINKED_WALLETS');
  if (developer) reasons.push('KNOWN_DEPLOYER');
  return { historyComplete, reasons };
}

/** Weak timing-only links can transitively chain unrelated wallets into one mega-cluster; only stronger links mark LINKED_WALLETS. */
export function isLinkedCluster(wallet: { clusterId: string | null; cluster?: { label: string | null; confidence: string } | null }): boolean {
  if (!wallet.clusterId) return false;
  return !(wallet.cluster?.label === 'timing' && wallet.cluster?.confidence === 'LOW');
}

/** Bounded cohort, deterministic rank within it. Never ranks by token growth or promotes operator review. */
export async function walletRanking(db: PrismaClient, now: Date, band: WalletEntryBand, limit: number, status: 'ALL' | 'REVIEW_READY' | 'OBSERVING' = 'ALL', minMedianPositionSol = 0.01, flowOnly = false, excludeAutomated = false) {
  const wallets = await db.trackedWallet.findMany({ where: { active: true, researchReview: { not: 'REJECTED' } },
    orderBy: { id: 'asc' }, take: 501, select: { id: true, address: true, label: true, researchReview: true, clusterId: true, cluster: { select: { label: true, confidence: true } } } });
  const cohort = wallets.slice(0,500);
  const [settings, developers] = await Promise.all([
    db.systemSetting.findMany({ where: { key: { in: ['wallet.evaluation.pipeline', ...cohort.flatMap(w=>[`wallet.performance.${w.id}`,`wallet.history.${w.id}`,`wallet.intelligence.${w.id}`])] } } }),
    db.token.findMany({ where: { deployer: { in: cohort.map(w=>w.address) } }, distinct: ['deployer'], select: { deployer: true } }),
  ]);
  const values = new Map(settings.map(s=>[s.key,s.value])), devs = new Set(developers.map(t=>t.deployer));
  const items = cohort.flatMap(w=>{
    const parsed = WalletPerformance.safeParse(values.get(`wallet.performance.${w.id}`));
    if (!parsed.success) return [];
    const performance = parsed.data.bands.find(b=>b.band===band);
    if (!performance?.positions) return [];
    // Positive minimums filter every evaluation group, before counts and limit.
    // Zero disables the size filter so unknown evidence remains inspectable.
    if (minMedianPositionSol > 0 && (performance.medianClosedPositionSol == null ||
      new Prisma.Decimal(performance.medianClosedPositionSol).lt(minMedianPositionSol))) return [];
    const linked = isLinkedCluster(w), developer = devs.has(w.address);
    const automation = parseAutomation(values.get(`wallet.intelligence.${w.id}`));
    const { reasons, historyComplete } = rankingReasons(parsed.data,performance,values.get(`wallet.history.${w.id}`),now,linked,developer,minMedianPositionSol,automation?.automated ?? false);
    const flow = parseFlowSuitability(parsed.data, values.get(`wallet.history.${w.id}`), now);
    return [{ address:w.address,label:w.label,review:w.researchReview,status:reasons.length?'OBSERVING' as const:'REVIEW_READY' as const,
      reasons,historyComplete,linked,developer,checkedAt:parsed.data.checkedAt,performance,
      flowSuitable:flow.suitable,flowReasons:flow.reasons,flowMetrics:flow.metrics,automation }];
  });
  items.sort((a,b)=>Number(b.status==='REVIEW_READY')-Number(a.status==='REVIEW_READY') ||
    Number(b.historyComplete)-Number(a.historyComplete) ||
    Number(!(b.automation?.automated ?? false))-Number(!(a.automation?.automated ?? false)) ||
    (b.performance.winRateLowerBound??-1)-(a.performance.winRateLowerBound??-1) ||
    new Prisma.Decimal(b.performance.realisedPnlSol??'0').cmp(a.performance.realisedPnlSol??'0') || a.address.localeCompare(b.address));
  const pipeline = WalletRankingPage.shape.pipeline.safeParse(values.get('wallet.evaluation.pipeline'));
  const counts = { reviewReady: items.filter(w=>w.status==='REVIEW_READY').length, observing: items.filter(w=>w.status==='OBSERVING').length,
    flowSuitable: items.filter(w=>w.flowSuitable).length, automated: items.filter(w=>w.automation?.automated).length };
  const filtered = items.filter(w=>(!flowOnly||w.flowSuitable) && (!excludeAutomated||!w.automation?.automated) && (status==='ALL'||w.status===status));
  return { asOf: now.toISOString(), band, windowDays: 30 as const, total: filtered.length, capped: wallets.length>500 || filtered.length>limit,
    minMedianPositionSol, counts, pipeline: pipeline.success?pipeline.data:null,items:filtered.slice(0,limit) };
}
