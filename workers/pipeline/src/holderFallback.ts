import type {PrismaClient} from '@narra/database';
import {z} from 'zod';
import type {HolderRpcSource} from './holderRpc';
import {RADAR_EVIDENCE_LIMITS} from '@narra/token-intel';

export const HOLDER_FALLBACK_KEY='research.holderFallback.progress';
export const HOLDER_FALLBACK_LIMITS={perRun:2,cooldownMs:30*60_000,providerCooldownMs:15*60_000} as const;
export interface HolderCandidate{id:string;mint:string}
const Progress=z.object({cursor:z.string(),cooldownUntil:z.string().datetime().nullable(),attempts:z.record(z.string().datetime())});
/** Candidates already have usable small-cap quotes. Rotate attempts, not only successes, and keep cooldown across restarts. */
export async function refreshHolderFallback(db:PrismaClient,source:HolderRpcSource,candidates:HolderCandidate[],clock=()=>new Date()){
 const out={holderFallbackAttempts:0,holderFallbackWritten:0,holderFallbackUnknown:0,holderFallbackThrottled:0};
 const now=clock(),row=await db.systemSetting.findUnique({where:{key:HOLDER_FALLBACK_KEY}});
 const parsed=Progress.safeParse(row?.value),state=parsed.success?parsed.data:null;
 if(state?.cooldownUntil&&Date.parse(state.cooldownUntil)>+now)return out;
 const attempts=Object.fromEntries(Object.entries(state?.attempts??{}).filter(([,at])=>Number.isFinite(Date.parse(at))&&+now-Date.parse(at)<HOLDER_FALLBACK_LIMITS.cooldownMs));
 const unique=[...new Map(candidates.map(t=>[t.id,t])).values()].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 const ordered=state?.cursor?[...unique.filter(t=>t.id>state.cursor!),...unique.filter(t=>t.id<=state.cursor!)]:unique;
 let cursor=state?.cursor??'',cooldownUntil:string|null=null;
 for(const token of ordered){
  if(out.holderFallbackAttempts>=HOLDER_FALLBACK_LIMITS.perRun)break;
  if(attempts[token.id])continue;
  // Read after Gecko collection so a fresh primary observation never spends a fallback call.
  const latest=await db.tokenHolderMetric.findFirst({where:{tokenId:token.id},orderBy:{at:'desc'},select:{at:true}});
  const checked=clock();
  if(latest&&+latest.at<=+checked&&+checked-+latest.at<=RADAR_EVIDENCE_LIMITS.holdersMaxAgeMs)continue;
  out.holderFallbackAttempts++;attempts[token.id]=checked.toISOString();cursor=token.id;
  const claim={cursor,attempts,cooldownUntil};
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
  const value={cursor,attempts,cooldownUntil};await db.systemSetting.upsert({where:{key:HOLDER_FALLBACK_KEY},create:{key:HOLDER_FALLBACK_KEY,value},update:{value}});
  if(cooldownUntil)break;
 }
 return out;
}
