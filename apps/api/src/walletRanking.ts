import { Prisma, type PrismaClient } from '@narra/database';
import { WalletPerformance, WalletRankingPage, type WalletEntryBand } from '@narra/shared';

const obj = (v: unknown): Record<string,unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string,unknown> : {};
const fresh = (v: unknown, now: Date, age: number) => typeof v === 'string' && Date.parse(v) <= +now && +now-Date.parse(v) <= age;
export function rankingReasons(performance: WalletPerformance, band: WalletPerformance['bands'][number], history: unknown, now: Date, linked: boolean, developer: boolean, minMedianPositionSol = 0.01) {
  const h = obj(history), reasons: string[] = [];
  const historyComplete = h.capped === false && h.skipped === 0 && h.windowDays === 30 && fresh(h.checkedAt,now,86_400_000) &&
    fresh(h.coveredTo,now,86_400_000) && typeof h.coveredFrom === 'string' && typeof h.coveredTo === 'string' &&
    Date.parse(h.coveredTo)-Date.parse(h.coveredFrom)>=30*86_400_000;
  if (!historyComplete) reasons.push('HISTORY_INCOMPLETE');
  if (!fresh(performance.checkedAt,now,45*60_000)) reasons.push('PERFORMANCE_STALE');
  if (!fresh(performance.lastTradeAt,now,86_400_000)) reasons.push('ACTIVITY_STALE');
  if (performance.capped) reasons.push('TRADE_LIMIT');
  if (performance.invalidTrades || performance.unmatchedSells) reasons.push('INCOMPLETE_COST_BASIS');
  if (band.closedPositions<20 || band.closedTokens<5 || band.observedDays<7) reasons.push('SMALL_SAMPLE');
  if (band.medianClosedPositionSol == null) reasons.push('POSITION_SIZE_UNKNOWN');
  else if (new Prisma.Decimal(band.medianClosedPositionSol).lt(minMedianPositionSol)) reasons.push('SMALL_POSITIONS');
  if (band.realisedPnlSol===null || new Prisma.Decimal(band.realisedPnlSol).lte(0) || (band.medianRoi??0)<=0) reasons.push('POSITIVE_RESULTS_REQUIRED');
  if ((band.winRateLowerBound??0)<0.5) reasons.push('LOW_WIN_CONFIDENCE');
  if (band.band==='UNKNOWN' || band.band==='ALL' || band.band==='OVER_1M') reasons.push('SMALL_CAP_UNPROVEN');
  if ((band.fastCloseRate??0)>0.5) reasons.push('FAST_EXITS');
  if (linked) reasons.push('LINKED_WALLETS');
  if (developer) reasons.push('KNOWN_DEPLOYER');
  return { historyComplete, reasons };
}

/** Bounded cohort, deterministic rank within it. Never ranks by token growth or promotes operator review. */
export async function walletRanking(db: PrismaClient, now: Date, band: WalletEntryBand, limit: number, status: 'ALL' | 'REVIEW_READY' | 'OBSERVING' = 'ALL', minMedianPositionSol = 0.01) {
  const wallets = await db.trackedWallet.findMany({ where: { active: true, researchReview: { not: 'REJECTED' } },
    orderBy: { id: 'asc' }, take: 501, select: { id: true, address: true, label: true, researchReview: true, clusterId: true } });
  const cohort = wallets.slice(0,500);
  const [settings, developers] = await Promise.all([
    db.systemSetting.findMany({ where: { key: { in: ['wallet.evaluation.pipeline', ...cohort.flatMap(w=>[`wallet.performance.${w.id}`,`wallet.history.${w.id}`])] } } }),
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
    const linked = w.clusterId!==null, developer = devs.has(w.address);
    const { reasons, historyComplete } = rankingReasons(parsed.data,performance,values.get(`wallet.history.${w.id}`),now,linked,developer,minMedianPositionSol);
    return [{ address:w.address,label:w.label,review:w.researchReview,status:reasons.length?'OBSERVING' as const:'REVIEW_READY' as const,
      reasons,historyComplete,linked,developer,checkedAt:parsed.data.checkedAt,performance }];
  });
  items.sort((a,b)=>Number(b.status==='REVIEW_READY')-Number(a.status==='REVIEW_READY') ||
    Number(b.historyComplete)-Number(a.historyComplete) ||
    (b.performance.winRateLowerBound??-1)-(a.performance.winRateLowerBound??-1) ||
    new Prisma.Decimal(b.performance.realisedPnlSol??'0').cmp(a.performance.realisedPnlSol??'0') || a.address.localeCompare(b.address));
  const pipeline = WalletRankingPage.shape.pipeline.safeParse(values.get('wallet.evaluation.pipeline'));
  const counts = { reviewReady: items.filter(w=>w.status==='REVIEW_READY').length, observing: items.filter(w=>w.status==='OBSERVING').length };
  const filtered = items.filter(w=>status==='ALL'||w.status===status);
  return { asOf: now.toISOString(), band, windowDays: 30 as const, total: filtered.length, capped: wallets.length>500 || filtered.length>limit,
    minMedianPositionSol, counts, pipeline: pipeline.success?pipeline.data:null,items:filtered.slice(0,limit) };
}
