import type {Prisma,PrismaClient} from '@narra/database';
type TokenMetric=Prisma.TokenMetricGetPayload<Record<string,never>>;
import {EARLY_OUTCOME_RULES,radarEntry,measureEarlyHorizon,summarizeEarlyRadar,type RadarPoint} from '@narra/analytics';
import {
  evaluateRadarSafety, radarEvidenceIssue, radarSafetyBlockedSettingKey, radarSafetyLabel, radarSafetyModeFromEnv, radarSafetySettingKey,
  type RadarEvidenceIssue, type RadarSafetyFacts, type RadarSafetySnapshot,
} from '@narra/token-intel';

const HOUR=3600000;
export const EARLY_TRACKING_LIMITS={batch:200,legacyBatch:50,reportRows:5000} as const;
const num=(value:{toString():string}|null|undefined)=>value==null?null:Number(value.toString());
async function point(db:Pick<Prisma.TransactionClient,'systemSetting'>,metric:TokenMetric|null):Promise<RadarPoint|null>{
  if(!metric)return null;
  // An intervening refresh must not erase provenance for an exact historical observation.
  const history=(await db.systemSetting.findUnique({where:{key:`research.marketMetric.${metric.id}`}}))?.value;
  const metadata=(history??(await db.systemSetting.findUnique({where:{key:`research.market.${metric.tokenId}`}}))?.value) as {metricId?:unknown;source?:unknown;marketCapIsFdv?:unknown}|null;
  const exact=metadata?.metricId===metric.id;
  return {id:metric.id,at:metric.at,priceUsd:num(metric.priceUsd),marketCapUsd:num(metric.marketCapUsd),marketCapIsFdv:exact&&typeof metadata?.marketCapIsFdv==='boolean'?metadata.marketCapIsFdv:null,source:exact&&metadata?.source==='dexscreener'?'dexscreener':null};
}
const horizons=(at:Date)=>EARLY_OUTCOME_RULES.horizonsHours.map(horizonHours=>({horizonHours,targetAt:new Date(+at+horizonHours*HOUR),nextCheckAt:new Date(+at+horizonHours*HOUR)}));
/** Optional facts the scoring caller already has but that are not stored on the metric/holder rows. */
export interface RadarSafetyContext{
  priceGrowth1hPct:number|null;
  priceGrowth3hPct:number|null;
  narrativeManipulationRisk:number|null;
  /** Optional source facts. Omitted/null means unknown, never safe. */
  devHoldingPct?:number|null;
  /** Extra flags from a safety source; merged with the stored risk row for the gate only. */
  riskFlags?:readonly string[];
  top10ExLpPct?:number|null;
  lpBurnedPct?:number|null;
  lpLocked?:boolean|null;
  bundlePct?:number|null;
  sniperPct?:number|null;
  insiderPct?:number|null;
  uniqueBuyers24h?:number|null;
  uniqueSellers24h?:number|null;
  priceImpactPct?:number|null;
  deployerPriorRugs?:number|null;
  /** When the tradeability quote was taken. Recorded separately from the primary safety source. */
  tradeabilityAt?:string|null;
  tradeability?:import('@narra/shared').TradeabilityQuote|null;
  /** Provenance of the optional evidence. The gate only records it. */
  source?:string|null;
  sourceAt?:string|null;
}
type RadarAlertInput={tokenId:string;mint:string;profile:'trencher'|'holder';tier:'WATCH'|'STRONG';route:'NARRATIVE'|'SOCIAL';matchKind:'NAME'|'MINT'|'TICKER_ONLY';score:number;metricId:string;holderMetricId:string;title:string;body:string;safetyContext?:RadarSafetyContext};
export type RadarPublicationResult={created:true;safety:RadarSafetySnapshot|null}|{created:false;reason:RadarEvidenceIssue|'DUPLICATE'|'SAFETY_BLOCKED';safety?:RadarSafetySnapshot};

/** Atomically freezes attribution/entry and the safety verdict with the alert. No opportunity, decision or trading writes. */
export async function createEarlyRadarAlert(db:PrismaClient,input:RadarAlertInput,at?:Date):Promise<RadarPublicationResult>{
  const kind=input.profile==='trencher'?'EARLY_RADAR_TRENCHER':'EARLY_RADAR_HOLDER';
  return db.$transaction(async tx=>{
    // Serialize both discovery routes for this token/profile, including concurrent workers.
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`${kind}:${input.tokenId}`}))`;
    // Capture wall time after lock acquisition. A slow scoring run/lock wait cannot
    // publish under its earlier job-start timestamp. Tests may inject a fixed time.
    const alertedAt=at??new Date();
    if(await tx.alert.count({where:{kind,refId:input.tokenId,createdAt:{gte:new Date(+alertedAt-6*HOUR),lte:alertedAt}}}))return {created:false,reason:'DUPLICATE'};
    const metric=await tx.tokenMetric.findFirst({where:{id:input.metricId,tokenId:input.tokenId}});
    const holders=await tx.tokenHolderMetric.findFirst({where:{id:input.holderMetricId,tokenId:input.tokenId},select:{at:true,holders:true,top10Pct:true,devHoldingPct:true,smartWalletHolders:true}});
    const issue=radarEvidenceIssue(metric?{at:metric.at,priceUsd:num(metric.priceUsd)}:null,holders,alertedAt);
    if(issue)return {created:false,reason:issue};
    const observation=await point(tx,metric);
    if(observation?.source!=='dexscreener')return {created:false,reason:'MARKET_UNVERIFIED'};
    const risk=await tx.tokenRiskMetric.findFirst({where:{tokenId:input.tokenId,at:{lte:alertedAt}},orderBy:{at:'desc'},select:{id:true,at:true,flags:true}});
    const mode=radarSafetyModeFromEnv();
    const safety=mode==='off'?null:(()=>{
      const facts:RadarSafetyFacts={
        tokenId:input.tokenId,mint:input.mint,profile:input.profile,route:input.route,matchKind:input.matchKind,tier:input.tier,score:input.score,
        metricId:input.metricId,holderMetricId:input.holderMetricId,riskMetricId:risk?.id??null,
        priceUsd:num(metric?.priceUsd),marketCapUsd:num(metric?.marketCapUsd),liquidityUsd:num(metric?.liquidityUsd),volume24hUsd:num(metric?.volume24hUsd),
        holders:holders?.holders??null,top10Pct:holders?.top10Pct??null,
        // A second source cannot erase a higher recorded developer holding.
        devHoldingPct:input.safetyContext?.devHoldingPct!=null&&holders?.devHoldingPct!=null?Math.max(input.safetyContext.devHoldingPct,holders.devHoldingPct):input.safetyContext?.devHoldingPct??holders?.devHoldingPct??null,
        riskFlags:[...new Set([...(risk?.flags??[]),...(input.safetyContext?.riskFlags??[])])],marketAt:metric?.at??null,holdersAt:holders?.at??null,riskAt:risk?.at??null,
        priceGrowth1hPct:input.safetyContext?.priceGrowth1hPct??null,priceGrowth3hPct:input.safetyContext?.priceGrowth3hPct??null,
        narrativeManipulationRisk:input.safetyContext?.narrativeManipulationRisk??null,
        top10ExLpPct:input.safetyContext?.top10ExLpPct??null,lpBurnedPct:input.safetyContext?.lpBurnedPct??null,lpLocked:input.safetyContext?.lpLocked??null,
        bundlePct:input.safetyContext?.bundlePct??null,sniperPct:input.safetyContext?.sniperPct??null,insiderPct:input.safetyContext?.insiderPct??null,
        uniqueBuyers24h:input.safetyContext?.uniqueBuyers24h??null,uniqueSellers24h:input.safetyContext?.uniqueSellers24h??null,
        priceImpactPct:input.safetyContext?.priceImpactPct??null,deployerPriorRugs:input.safetyContext?.deployerPriorRugs??null,
        tradeabilityAt:input.safetyContext?.tradeabilityAt&&Number.isFinite(+new Date(input.safetyContext.tradeabilityAt))?new Date(input.safetyContext.tradeabilityAt):null,
        tradeability:input.safetyContext?.tradeability??null,
        evidenceSource:input.safetyContext?.source??null,
        evidenceAt:input.safetyContext?.sourceAt&&Number.isFinite(+new Date(input.safetyContext.sourceAt))?new Date(input.safetyContext.sourceAt):null,
      };
      return {...evaluateRadarSafety(facts,alertedAt),mode};
    })();
    if(safety&&mode==='enforce'&&safety.status!=='PASS'){
      const key=radarSafetyBlockedSettingKey(input.tokenId,input.profile),value=safety as unknown as Prisma.InputJsonValue;
      await tx.systemSetting.upsert({where:{key},create:{key,value},update:{value}});
      return {created:false,reason:'SAFETY_BLOCKED',safety};
    }
    const entry=radarEntry(observation,alertedAt);
    // The verdict is displayed with the call. Shadow mode must not look like an unqualified buy signal.
    const body=safety?`${input.body} ${radarSafetyLabel(safety)}${mode==='shadow'?' Shadow mode: recorded, not enforced.':''}`:input.body;
    const alert=await tx.alert.create({data:{kind,priority:input.tier==='STRONG'?'IMPORTANT':'WATCH',refType:'TOKEN',refId:input.tokenId,title:input.title,body,createdAt:alertedAt,
      earlyRadarOutcome:{create:{tokenId:input.tokenId,mint:input.mint,alertedAt,profile:input.profile,tier:input.tier,route:input.route,matchKind:input.matchKind,score:input.score,...entry,measurements:{create:horizons(alertedAt)}}},
    }});
    if(safety){
      const key=radarSafetySettingKey(alert.id),value=safety as unknown as Prisma.InputJsonValue;
      await tx.systemSetting.create({data:{key,value}});
    }
    return {created:true,safety};
  });
}

/** Stored observations only. Immutable terminal measurements; missing windows stay explicitly unknown. */
export async function trackEarlyRadarOutcomes(db:PrismaClient,deps:{now?:()=>Date;batch?:number;only?:string[]}={}){
  const now=(deps.now??(()=>new Date()))();
  const summary={legacyRegistered:0,measured:0,observed:0,unknown:0,pending:0};
  const legacy=await db.alert.findMany({where:{kind:{in:['EARLY_RADAR_TRENCHER','EARLY_RADAR_HOLDER']},refType:'TOKEN',refId:{not:null},createdAt:{lte:now},earlyRadarOutcome:null,...(deps.only?{id:{in:deps.only}}:{})},orderBy:[{createdAt:'asc'},{id:'asc'}],take:EARLY_TRACKING_LIMITS.legacyBatch});
  for(const alert of legacy){
    // Never reconstruct route, tier or entry by parsing free text or borrowing today's price.
    await db.earlyRadarOutcome.upsert({where:{alertId:alert.id},update:{},create:{alertId:alert.id,tokenId:alert.refId!,alertedAt:alert.createdAt,profile:alert.kind==='EARLY_RADAR_TRENCHER'?'trencher':'holder',tier:'UNKNOWN',route:'UNKNOWN',matchKind:'UNKNOWN',entryUnknownReason:'LEGACY_NO_SNAPSHOT',measurements:{create:horizons(alert.createdAt)}}});
    summary.legacyRegistered++;
  }
  const due=await db.earlyRadarMeasurement.findMany({where:{status:'PENDING',nextCheckAt:{lte:now},...(deps.only?{outcome:{alertId:{in:deps.only}}}:{})},orderBy:[{nextCheckAt:'asc'},{id:'asc'}],take:Math.min(deps.batch??EARLY_TRACKING_LIMITS.batch,EARLY_TRACKING_LIMITS.batch),include:{outcome:true}});
  for(const row of due){
    const metric=await db.tokenMetric.findFirst({where:{tokenId:row.outcome.tokenId,at:{gte:row.targetAt,lte:new Date(Math.min(+now,+row.targetAt+EARLY_OUTCOME_RULES.horizonToleranceMs))},priceUsd:{gt:0}},orderBy:[{at:'asc'},{id:'asc'}]});
    const measurement=measureEarlyHorizon(row.outcome.entryPriceUsd,row.targetAt,await point(db,metric),now);
    const updated=await db.earlyRadarMeasurement.updateMany({where:{id:row.id,status:'PENDING'},data:{...measurement,measuredAt:now,nextCheckAt:new Date(+now+EARLY_OUTCOME_RULES.recheckMs)}});
    if(!updated.count)continue;
    summary.measured++;
    if(measurement.status==='OBSERVED')summary.observed++;else if(measurement.status==='UNKNOWN')summary.unknown++;else summary.pending++;
  }
  return summary;
}

export async function earlyRadarReport(db:PrismaClient,from:Date,to:Date){
  if(!Number.isFinite(+from)||!Number.isFinite(+to)||+from>+to)throw Error('Invalid report range');
  const where={alertedAt:{gte:from,lte:to}};
  const [total,rows]=await Promise.all([db.earlyRadarOutcome.count({where}),db.earlyRadarOutcome.findMany({where,orderBy:[{alertedAt:'asc'},{id:'asc'}],take:EARLY_TRACKING_LIMITS.reportRows,include:{measurements:true}})]);
  const groups=summarizeEarlyRadar(rows),truncated=total>rows.length;
  if(truncated)for(const group of groups)for(const h of group.horizons){h.returns.sufficient=false;h.returns.note='INSUFFICIENT DATA: report row limit reached; narrow the date range';}
  return {from,to,total,read:rows.length,truncated,groups,caveats:[
    'Gross observed price returns, not executable trades or PnL; fees, liquidity and price impact are not modeled.',
    'Missing prices are unknown, not zero. Delisted and failed tokens may be disproportionately missing (survivorship bias).',
    'Overlapping events are removed within each cohort using the respective 1h, 24h or 7d horizon. Cohorts can still share tokens and are not independent experiments.',
    'Evidence gates require 30 independent known returns across 15 tokens; these unvalidated minimums do not establish predictive power.',
    'Legacy alerts have UNKNOWN attribution and no reconstructed entry. Market cap can be FDV or have unknown basis; inspect frozen measurements.',
  ]};
}
