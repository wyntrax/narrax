import {Prisma,type PrismaClient} from '@narra/database';
import {WSOL_MINT} from '@narra/market-data';
import {z} from 'zod';
import type {HolderRpcSource} from './holderRpc';
import {RADAR_EVIDENCE_LIMITS} from '@narra/token-intel';
import {readSocialPriority} from './researchDiagnostics';

export const HOLDER_FALLBACK_KEY='research.holderFallback.progress';
/**
 * The primary token-info source reports holder observations hours old, so it cannot
 * satisfy the 60-minute radar gate. Complete RPC enumeration is the only fresh source.
 * Four paced calls per token at a 500ms interval cost about two seconds each.
 *
 * These are the market-run defaults: two tokens per five-minute run, a bounded top-up for
 * price-lane tokens outside the radar cohort. The cohort itself is served by the separate
 * holder-refresh job (RADAR_HOLDER_LIMITS), because the market run has little schedule headroom.
 */
export const HOLDER_FALLBACK_LIMITS={
 perRun:2,
 /** Do not start another token after this much elapsed work. A started token may still
  *  finish inside its own 15s RPC timeout, so total overrun is bounded by that timeout. */
 deadlineMs:15_000,
 cooldownMs:30*60_000,
 providerCooldownMs:15*60_000,
 maxPerRun:40,
 maxDeadlineMs:120_000,
 minDeadlineMs:5_000,
} as const;

export interface HolderFallbackBudget{perRun:number;deadlineMs:number}

/** Bounded operator tuning. Invalid or out-of-range values fall back to the defaults. */
export function holderFallbackBudget(env:NodeJS.ProcessEnv=process.env):HolderFallbackBudget{
 const read=(name:string,fallback:number,min:number,max:number)=>{
  const parsed=Number(env[name]);
  return Number.isFinite(parsed)&&parsed>0?Math.min(max,Math.max(min,Math.floor(parsed))):fallback;
 };
 return {
  perRun:read('HOLDER_RPC_FALLBACK_PER_RUN',HOLDER_FALLBACK_LIMITS.perRun,1,HOLDER_FALLBACK_LIMITS.maxPerRun),
  deadlineMs:read('HOLDER_RPC_FALLBACK_DEADLINE_MS',HOLDER_FALLBACK_LIMITS.deadlineMs,HOLDER_FALLBACK_LIMITS.minDeadlineMs,HOLDER_FALLBACK_LIMITS.maxDeadlineMs),
 };
}

export interface HolderCandidate{id:string;mint:string}
const Progress=z.object({cursor:z.string(),cooldownUntil:z.string().datetime().nullable(),attempts:z.record(z.string().datetime())});

/**
 * The radar cohort is the social priority list: tokens with qualified chatter and a
 * small-cap quote. Its holder gate is 60 minutes, so it needs its own cadence rather
 * than a share of the 5-minute market run. Three tokens a minute is about 180/hour
 * against a cohort of at most 200.
 */
export const RADAR_HOLDER_LIMITS={perRun:3,deadlineMs:20_000,maxPerRun:12,maxDeadlineMs:60_000,minDeadlineMs:5_000} as const;

export function radarHolderBudget(env:NodeJS.ProcessEnv=process.env):HolderFallbackBudget{
 const read=(name:string,fallback:number,min:number,max:number)=>{
  const parsed=Number(env[name]);
  return Number.isFinite(parsed)&&parsed>0?Math.min(max,Math.max(min,Math.floor(parsed))):fallback;
 };
 return {
  perRun:read('HOLDER_RPC_COHORT_PER_RUN',RADAR_HOLDER_LIMITS.perRun,1,RADAR_HOLDER_LIMITS.maxPerRun),
  deadlineMs:read('HOLDER_RPC_COHORT_DEADLINE_MS',RADAR_HOLDER_LIMITS.deadlineMs,RADAR_HOLDER_LIMITS.minDeadlineMs,RADAR_HOLDER_LIMITS.maxDeadlineMs),
 };
}

/** Refreshes the radar cohort independently of which tokens a market run happened to price. */
export async function refreshRadarHolders(
 db:PrismaClient,source:HolderRpcSource,now=new Date(),opts:HolderFallbackBudget=radarHolderBudget(),
){
 const ids=await readSocialPriority(db,now);
 const tokens=ids.length?await db.token.findMany({where:{id:{in:ids},blacklisted:false,mint:{not:WSOL_MINT}},select:{id:true,mint:true}}):[];
 return refreshHolderFallback(db,source,tokens,()=>now,opts);
}

/**
 * Refresh the stalest holder observations within a bounded budget. Rotation is by
 * evidence age, not token id: the tokens closest to failing the 60-minute gate are
 * served first, and the persisted cursor only breaks ties between equal ages.
 * Failed or missing RPC evidence never changes a stored observation time.
 */
export async function refreshHolderFallback(
 db:PrismaClient,source:HolderRpcSource,candidates:HolderCandidate[],clock=()=>new Date(),opts:HolderFallbackBudget=holderFallbackBudget(),
){
 const out={
  holderFallbackAttempts:0,holderFallbackWritten:0,holderFallbackUnknown:0,holderFallbackThrottled:0,
  holderFallbackCandidates:0,holderFallbackFresh:0,holderFallbackDeferred:0,holderFallbackDeadlineHit:0,
 };
 const now=clock(),started=Date.now(),row=await db.systemSetting.findUnique({where:{key:HOLDER_FALLBACK_KEY}});
 const parsed=Progress.safeParse(row?.value),state=parsed.success?parsed.data:null;
 const unique=[...new Map(candidates.map(t=>[t.id,t])).values()];
 out.holderFallbackCandidates=unique.length;
 if(state?.cooldownUntil&&Date.parse(state.cooldownUntil)>+now)return out;
 // Attempts inside the cooldown window are kept; older ones are forgotten.
 const attempts=Object.fromEntries(Object.entries(state?.attempts??{}).filter(([,at])=>Number.isFinite(Date.parse(at))&&+now-Date.parse(at)<HOLDER_FALLBACK_LIMITS.cooldownMs));
 if(!unique.length)return out;
 // One query for the newest observation per candidate; a per-token lookup would add
 // hundreds of round trips once the radar cohort is passed in whole.
 const rows=await db.$queryRaw<{tokenId:string;at:Date}[]>`SELECT DISTINCT ON ("tokenId") "tokenId", at
  FROM "TokenHolderMetric" WHERE "tokenId" IN (${Prisma.join(unique.map(t=>t.id))}) ORDER BY "tokenId", at DESC`;
 const newest=new Map(rows.map(r=>[r.tokenId,+r.at]));
 const isFresh=(id:string)=>{const at=newest.get(id);return at!=null&&at<=+now&&+now-at<=RADAR_EVIDENCE_LIMITS.holdersMaxAgeMs;};
 const order=(id:string)=>newest.get(id)??-Infinity;
 const cursor=state?.cursor??'';
 const ordered=[...unique].sort((a,b)=>{
  const byAge=order(a.id)-order(b.id);
  if(byAge!==0)return byAge;
  // Equal (or unknown) ages rotate from the saved cursor so one run cannot always win.
  const rotation=(a.id>cursor?0:1)-(b.id>cursor?0:1);
  return rotation||(a.id<b.id?-1:a.id>b.id?1:0);
 });
 out.holderFallbackFresh=ordered.filter(t=>isFresh(t.id)).length;
 const persisted={...attempts};
 let cursorValue=cursor,cooldownUntil:string|null=null;
 for(const token of ordered){
  if(isFresh(token.id)||attempts[token.id])continue;
  if(out.holderFallbackAttempts>=opts.perRun||Date.now()-started>=opts.deadlineMs){
   if(Date.now()-started>=opts.deadlineMs)out.holderFallbackDeadlineHit=1;
   break;
  }
  const checked=clock();
  out.holderFallbackAttempts++;persisted[token.id]=checked.toISOString();cursorValue=token.id;
  const claim={cursor:cursorValue,attempts:persisted,cooldownUntil};
  await db.systemSetting.upsert({where:{key:HOLDER_FALLBACK_KEY},create:{key:HOLDER_FALLBACK_KEY,value:claim},update:{value:claim}});
  const evidence=await source.get(token.mint).catch(()=>({ok:false as const,reason:'UNAVAILABLE' as const}));
  const retrievedAt=clock();
  if(evidence.ok&&evidence.mint===token.mint&&+evidence.sourceAt<=+retrievedAt&&+retrievedAt-+evidence.sourceAt<=RADAR_EVIDENCE_LIMITS.holdersMaxAgeMs){
   // Do not borrow developer ownership or smart-wallet counts from an older observation.
   await db.$transaction(async tx=>{
    const metric=await tx.tokenHolderMetric.create({data:{tokenId:token.id,holders:evidence.holders,top10Pct:evidence.top10Pct,devHoldingPct:null,at:evidence.sourceAt}});
    const value={mint:token.mint,metricId:metric.id,source:'solana-rpc',sourceAt:evidence.sourceAt.toISOString(),retrievedAt:retrievedAt.toISOString(),slot:evidence.slot,program:evidence.program,accounts:evidence.accounts,holders:evidence.holders,top10Pct:evidence.top10Pct,devHoldingPct:null,basis:'positive-balance-owners-including-pools',complete:true};
    await tx.systemSetting.create({data:{key:`research.holderMetric.${metric.id}`,value}});
    const key=`research.holders.${token.id}`;await tx.systemSetting.upsert({where:{key},create:{key,value},update:{value}});
   });out.holderFallbackWritten++;
  }else{out.holderFallbackUnknown++;if(!evidence.ok&&['RATE_LIMITED','UNAVAILABLE'].includes(evidence.reason)){cooldownUntil=new Date(+retrievedAt+HOLDER_FALLBACK_LIMITS.providerCooldownMs).toISOString();out.holderFallbackThrottled++;}}
  const value={cursor:cursorValue,attempts:persisted,cooldownUntil};await db.systemSetting.upsert({where:{key:HOLDER_FALLBACK_KEY},create:{key:HOLDER_FALLBACK_KEY,value},update:{value}});
  if(cooldownUntil)break;
 }
 // Demand this run could not serve: still stale, not cooling down, not attempted now.
 out.holderFallbackDeferred=ordered.filter(t=>!isFresh(t.id)&&!attempts[t.id]&&!persisted[t.id]).length;
 return out;
}
