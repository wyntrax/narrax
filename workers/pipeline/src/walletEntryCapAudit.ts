import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import type { PrismaClient } from '@narra/database';
import { isSolanaAddress } from '@narra/shared';
import { z } from 'zod';
import { walletEntryCapPositions, type PerformanceTrade } from './walletPerformance';
import { walletMarketLookup } from './walletResearchEvidence';

export const EntryCapAuditOptions = z.object({
  walletLimit:z.number().int().min(1).max(10).default(5),
  entryLimit:z.number().int().min(1).max(500).default(100),
  wallet:z.string().refine(isSolanaAddress).optional(),
  afterWallet:z.string().min(1).max(128).optional(),
  afterEntry:z.string().min(1).max(128).optional(),
}).refine(o=>!o.afterEntry || !!o.wallet,{message:'Entry continuation requires a single --wallet'})
  .refine(o=>!o.wallet || !o.afterWallet,{message:'Use either --wallet or --after-wallet'});
export type EntryCapAuditOptions = z.infer<typeof EntryCapAuditOptions>;
const TRADE_LIMIT=10_000, LOOKUP_QUERY_LIMIT=500;
const object=(v:unknown):Record<string,unknown>=>v && typeof v==='object' && !Array.isArray(v)?v as Record<string,unknown>:{};
const small=(band:string)=>['UNDER_100K','100K_500K','500K_1M'].includes(band);
type AuditTrade=PerformanceTrade & {amountUsd:unknown};
type Lookup=Awaited<ReturnType<typeof walletMarketLookup>>;
export interface EntryCapAuditWallet {id:string;address:string;rows:AuditTrade[];tradesCapped:boolean}

const coverage=(positions:ReturnType<typeof walletEntryCapPositions>)=>{
  const known=positions.filter(p=>p.band!=='UNKNOWN').length;
  return {positions:positions.length,known,unknown:positions.length-known,knownPercent:positions.length?known*100/positions.length:null,
    closedPositions:positions.filter(p=>p.closed).length,knownClosedPositions:positions.filter(p=>p.closed&&p.band!=='UNKNOWN').length,
    smallCapPositions:positions.filter(p=>small(p.band)).length,smallCapClosedPositions:positions.filter(p=>p.closed&&small(p.band)).length};
};
export class EntryCapLookupBudgetReached extends Error {}

/** In-memory counterfactual only. Lookup must use stored pre-trade observations.
 * Round-robin lookup allocation prevents one wallet consuming the entire page. */
export async function previewEntryCapCoverage(wallets:EntryCapAuditWallet[],now:Date,
  lookup:(tokenId:string,at:Date)=>Promise<Lookup>,options:Partial<EntryCapAuditOptions>={}) {
  const opts=EntryCapAuditOptions.parse(options);
  if(!Number.isFinite(+now))throw new Error('Invalid audit time');
  if(wallets.length>opts.walletLimit || wallets.some(w=>w.rows.length>TRADE_LIMIT))throw new Error('Audit input exceeds bounds');
  const states=[];
  for(const w of wallets){
    const positions=walletEntryCapPositions(w.rows,now),byId=new Map(w.rows.map(r=>[r.id,r]));
    const reasons:Record<string,number>={};
    const add=(reason:string)=>{reasons[reason]=(reasons[reason]??0)+1;};
    const eligible:AuditTrade[]=[];
    for(const p of positions){
      if(p.band!=='UNKNOWN')continue;
      const row=byId.get(p.entryTradeId)!;
      // Match reconciliation's immutable-value / legacy-evidence guards.
      if(row.marketCapUsd!==null){add('EXISTING_CAP_NOT_REPAIRABLE');continue;}
      if(row.amountUsd!==null && object(row.evidence).eventAt!==row.at.toISOString()){add('LEGACY_VALUATION_GUARD');continue;}
      if(opts.afterEntry && row.id<=opts.afterEntry){add('BEFORE_ENTRY_CURSOR');continue;}
      eligible.push(row);
    }
    eligible.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
    states.push({w,positions,before:coverage(positions),eligible,index:0,reasons,add,patches:new Map<string,AuditTrade>(),
      recoveries:[] as {entryTradeId:string;tokenId:string;tradeAt:string;metricId:string;observedAt:string;marketCapUsd:string;source:string;pairAddress:string;closed:boolean}[]});
    await yieldToEventLoop();
  }
  let checked=0,budgetReached=false;
  outer: while(checked<opts.entryLimit){
    let progressed=false;
    for(const s of states){
      if(checked>=opts.entryLimit)break outer;
      const row=s.eligible[s.index];if(!row)continue;
      let result:Lookup;
      try{result=await lookup(row.tokenId,row.at);}catch(e){if(e instanceof EntryCapLookupBudgetReached){budgetReached=true;break outer;}throw e;}
      checked++;s.index++;progressed=true;
      const market=result.market;
      if(!market || market.marketCapUsd===null){s.add(result.reason??'NO_VALID_CAP');continue;}
      const patch={...row,marketCapUsd:String(market.marketCapUsd),evidence:{...object(row.evidence),version:1,eventAt:row.at.toISOString(),market}};
      // Reuse performance's entry classification, including exact band boundaries.
      const classification=walletEntryCapPositions([patch],now)[0];
      if(!classification || classification.band==='UNKNOWN'){s.add('CANDIDATE_EVIDENCE_REJECTED');continue;}
      s.patches.set(row.id,patch);s.add('RECOVERABLE');
      s.recoveries.push({entryTradeId:row.id,tokenId:row.tokenId,tradeAt:row.at.toISOString(),metricId:market.metricId,
        observedAt:market.at,marketCapUsd:String(market.marketCapUsd),source:market.source,pairAddress:market.pairAddress,
        closed:s.positions.find(p=>p.entryTradeId===row.id)!.closed});
    }
    if(!progressed)break;
  }
  const items=[];
  for(const s of states){
    const patched=s.w.rows.map(r=>s.patches.get(r.id)??r),after=coverage(walletEntryCapPositions(patched,now));
    const remaining=s.eligible.length-s.index;
    if(remaining)s.reasons.NOT_EXAMINED=remaining;
    items.push({walletId:s.w.id,address:s.w.address,observedTrades:s.w.rows.length,tradesCapped:s.w.tradesCapped,
      before:s.before,afterPreview:after,knownPositionGain:after.known-s.before.known,
      knownClosedPositionGain:after.knownClosedPositions-s.before.knownClosedPositions,
      smallCapClosedPositionGain:after.smallCapClosedPositions-s.before.smallCapClosedPositions,
      percentagePointGain:after.knownPercent===null?null:after.knownPercent-s.before.knownPercent!,
      unknownEntryReasons:s.reasons,eligibleEntries:s.eligible.length,checkedEntries:s.index,remainingEligibleEntries:remaining,
      nextEntryCursor:remaining?s.eligible[s.index-1]?.id??opts.afterEntry??null:null,
      entryContinuationRequired:remaining>0,recoveries:s.recoveries});
    await yieldToEventLoop();
  }
  const totals=items.reduce((n,w)=>({positions:n.positions+w.before.positions,knownBefore:n.knownBefore+w.before.known,
    unknownBefore:n.unknownBefore+w.before.unknown,knownAfterPreview:n.knownAfterPreview+w.afterPreview.known,
    unknownAfterPreview:n.unknownAfterPreview+w.afterPreview.unknown}),{positions:0,knownBefore:0,unknownBefore:0,knownAfterPreview:0,unknownAfterPreview:0});
  return {readOnly:true,asOf:now.toISOString(),options:opts,
    scope:{windowDays:30,wallets:items.length,tradeLimitPerWallet:TRADE_LIMIT,tradeOrder:'AT_ASC_ID_ASC',
      cappedWallets:items.filter(w=>w.tradesCapped).length,note:'Bounded observed-position denominators, not complete on-chain histories. Separate pages are separate database snapshots.'},
    lookup:{entryLimit:opts.entryLimit,checked,queryBudgetReached:budgetReached,remainingEligible:items.reduce((n,w)=>n+w.remainingEligibleEntries,0)},
    summary:{...totals,
      recoverablePositions:items.reduce((n,w)=>n+w.knownPositionGain,0),recoverableClosedPositions:items.reduce((n,w)=>n+w.knownClosedPositionGain,0),
      walletsWithGain:items.filter(w=>w.knownPositionGain>0).length,
      unknownEntryReasons:items.reduce<Record<string,number>>((all,w)=>{for(const [reason,n] of Object.entries(w.unknownEntryReasons))all[reason]=(all[reason]??0)+n;return all;},{})},
    impactOrder:items.filter(w=>w.knownPositionGain>0).sort((a,b)=>b.knownClosedPositionGain-a.knownClosedPositionGain||b.knownPositionGain-a.knownPositionGain||a.address.localeCompare(b.address)).map(w=>w.address),
    note:'Stored pre-trade market-cap evidence only. FDV, later quotes and current retrieval times never fill gaps. This preview does not repair rows, assess profitability or confer review readiness. Untested entries stay unknown.',items};
}

/** Database-enforced read-only, bounded SELECTs under one repeatable snapshot. */
export async function readEntryCapCoverageAudit(db:PrismaClient,now:Date,options:Partial<EntryCapAuditOptions>={}){
  const opts=EntryCapAuditOptions.parse(options);
  if(!Number.isFinite(+now))throw new Error('Invalid audit time');
  return db.$transaction(async tx=>{
    const mode=await tx.$queryRaw<{transaction_read_only:string}[]>`SHOW transaction_read_only`;
    if(mode[0]?.transaction_read_only!=='on')throw new Error('Entry-cap audit requires a read-only connection');
    const selected=await tx.trackedWallet.findMany({where:{active:true,researchReview:{not:'REJECTED'},
      ...(opts.wallet?{address:opts.wallet}:{}),...(opts.afterWallet?{id:{gt:opts.afterWallet}}:{})},orderBy:{id:'asc'},take:opts.walletLimit+1,select:{id:true,address:true}});
    const page=selected.slice(0,opts.walletLimit),wallets:EntryCapAuditWallet[]=[];
    for(const wallet of page){
      const rows=await tx.walletTrade.findMany({where:{walletId:wallet.id,at:{gte:new Date(+now-30*86400000),lte:now}},orderBy:[{at:'asc'},{id:'asc'}],take:TRADE_LIMIT+1,
        select:{id:true,tokenId:true,side:true,amountSol:true,tokenAmount:true,amountUsd:true,marketCapUsd:true,at:true,evidence:true}});
      wallets.push({...wallet,rows:rows.slice(0,TRADE_LIMIT),tradesCapped:rows.length>TRADE_LIMIT});
    }
    let queries=0;
    const claim=()=>{if(queries>=LOOKUP_QUERY_LIMIT)throw new EntryCapLookupBudgetReached();queries++;};
    // Only the two read methods used by walletMarketLookup are exposed.
    const lookupDb={tokenMetric:{findFirst:(args:Parameters<typeof tx.tokenMetric.findFirst>[0])=>{claim();return tx.tokenMetric.findFirst(args);}},
      systemSetting:{findUnique:(args:Parameters<typeof tx.systemSetting.findUnique>[0])=>{claim();return tx.systemSetting.findUnique(args);}}} as unknown as Parameters<typeof walletMarketLookup>[0];
    const result=await previewEntryCapCoverage(wallets,now,(token,at)=>walletMarketLookup(lookupDb,token,at),opts);
    return {...result,lookup:{...result.lookup,queries,queryLimit:LOOKUP_QUERY_LIMIT},walletPage:{hasMore:selected.length>opts.walletLimit,nextWalletCursor:selected.length>opts.walletLimit?page.at(-1)!.id:null}};
  },{isolationLevel:'RepeatableRead',timeout:60000});
}
