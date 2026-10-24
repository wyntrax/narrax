import {z} from 'zod';
import type {PrismaClient} from '@narra/database';
import type {QueueCounts,QueueHealth} from '@narra/queue';
import {aiEnabled,loadAiConfig,tokensUsedToday,researchCoverage,MARKET_DATA_LIMITS} from '@narra/worker-pipeline';
import {marketEvidence,marketTokenImage,observation} from './marketEvidence';

const Receipt=z.object({at:z.string().datetime(),items:z.number().int().positive(),parsed:z.number().int().nonnegative(),queued:z.number().int().nonnegative(),skipped:z.number().int().nonnegative()});
const Sync=z.object({at:z.string().datetime(),action:z.string(),webhookActive:z.boolean().nullable(),desired:z.number().int().nonnegative(),error:z.string().optional()});
const Progress=z.object({checkedAt:z.string().datetime(),closedTrades:z.number().nonnegative(),observedTrades:z.number().nonnegative(),status:z.enum(['READY','INSUFFICIENT_HISTORY'])});
export interface HealthPorts {queueCounts?:()=>Promise<Record<string,QueueCounts>>;queueHealth?:()=>Promise<Record<string,QueueHealth>>;marketDataEnabled?:boolean;webhookConfigured?:boolean;aiProviderConfigured?:boolean}
const QUEUES=['wallet-events','wallet-sync','wallet-intelligence','wallet-discovery','market-data','token-resolution','ai-analysis','narrative-ingestion'];
const SCAN_LIMIT=2000;
// A warning to inspect delivery, not proof of failure: tracked wallets can be quiet.
const WEBHOOK_RECEIPT_STALE_SECONDS=60*60;
const elapsed=(at:string|null,now:Date)=>at?Math.max(0,Math.round((+now-Date.parse(at))/1000)):null;

/** Read-only operational evidence. Absence of trades is not evidence of a broken
 * webhook, and a successful sync is not an endpoint/delivery connectivity test. */
export async function dataHealth(db:PrismaClient,ports:HealthPorts,now:Date){
 const since=new Date(+now-30*86400000),recent=new Date(+now-3600000);
 const [settings,wallets,walletCount,profileCount,lastTrade,trades30d,tokenCount,tokens,unknownNames,candidateCount,belowThreshold,expiredCount,cfg,aiOn,used]=await Promise.all([
  db.systemSetting.findMany({where:{key:{in:['health.walletWebhook.receipt','wallets.syncStatus']}}}),
  db.trackedWallet.findMany({where:{active:true},take:SCAN_LIMIT,orderBy:{id:'asc'},select:{id:true}}),
  db.trackedWallet.count({where:{active:true}}),db.walletProfile.count({where:{wallet:{active:true}}}),
  db.walletTrade.findFirst({where:{wallet:{active:true},at:{lte:now}},orderBy:{at:'desc'},select:{at:true}}),
  db.walletTrade.count({where:{wallet:{active:true},at:{gte:since,lte:now},tokenAmount:{not:null}}}),
  db.token.count({where:{blacklisted:false}}),
  db.token.findMany({where:{blacklisted:false},orderBy:{id:'asc'},take:SCAN_LIMIT,select:{id:true,mint:true,symbol:true,metrics:{orderBy:{at:'desc'},take:1,select:{id:true}}}}),
  db.token.count({where:{OR:[{symbol:'UNKNOWN'},{name:'Unknown'}]}}),
  db.opportunity.count({where:{createdAt:{gte:recent,lte:now},score:{gte:50},analyses:{none:{}}}}),
  db.opportunity.count({where:{createdAt:{gte:recent,lte:now},score:{lt:50},analyses:{none:{}}}}),
  db.opportunity.count({where:{createdAt:{lt:recent},analyses:{none:{}}}}),
  loadAiConfig(db),aiEnabled(db),tokensUsedToday(db,now),
 ]);
 const [evidence,progress,history]=await Promise.all([
  marketEvidence(db,tokens.map(t=>t.id)),
  db.systemSetting.findMany({where:{key:{in:wallets.map(w=>`wallet.intelligence.${w.id}`)}}}),
  db.systemSetting.findMany({where:{key:{in:wallets.map(w=>`wallet.history.${w.id}`)}}}),
 ]);
 const receipt=Receipt.safeParse(settings.find(s=>s.key==='health.walletWebhook.receipt')?.value);
 const sync=Sync.safeParse(settings.find(s=>s.key==='wallets.syncStatus')?.value);
 const computation=progress.flatMap(p=>{const parsed=Progress.safeParse(p.value);return parsed.success?[parsed.data]:[];});
 const validReceipt=receipt.success&&Date.parse(receipt.data.at)<=+now?receipt.data:null;
 const validSync=sync.success&&Date.parse(sync.data.at)<=+now?sync.data:null;
 const lastComputation=computation.map(c=>c.checkedAt).filter(at=>Date.parse(at)<=+now).sort().at(-1)??null;
  const market={scanned:tokens.length,total:tokenCount,capped:tokenCount>tokens.length,fresh:0,stale:0,future:0,unverified:0,withStoredArtwork:0,withoutStoredArtwork:0,lastAt:null as string|null};
  for(const token of tokens){
   const source=evidence.get(token.id);
   if(marketTokenImage(source,token.mint))market.withStoredArtwork++;else market.withoutStoredArtwork++;
   const observed=observation(source,token.metrics[0]?.id,now);
   if(!observed){market.unverified++;continue;}
   if(Date.parse(observed.at)>+now)market.future++;else if(observed.stale)market.stale++;else market.fresh++;
   if(Date.parse(observed.at)<=+now&&(!market.lastAt||observed.at>market.lastAt))market.lastAt=observed.at;
  }
 let counts:Record<string,QueueCounts>|null=null,runs:Record<string,QueueHealth>|null=null;
 try{counts=await ports.queueCounts?.()??null;}catch{/* Unknown, not an empty healthy queue. */}
 try{runs=await ports.queueHealth?.()??null;}catch{/* Retained-job diagnostics unavailable. */}
 const queues=QUEUES.map(name=>{
  const count=counts?.[name]??null,run=runs?.[name]??null;
  const enabled=name==='market-data'?ports.marketDataEnabled!==false:name==='ai-analysis'?aiOn&&ports.aiProviderConfigured!==false:name==='wallet-sync'?ports.webhookConfigured!==false:true;
   // Retained failed jobs are history. Only a failure inside this window describes current health.
   const failedMs=run?.lastFailedAt?Date.parse(run.lastFailedAt):NaN,recentFailure=Number.isFinite(failedMs)&&failedMs<=+now&&+now-failedMs<=60*60_000;
   const state=!enabled?'DISABLED':!count?'UNKNOWN':count.consumers===0?'ERROR':count.consumers==null?'UNKNOWN':recentFailure||count.waiting>100||run?.lastRun?.providerFailures||run?.lastRun?.providerErrors||run?.lastRun?.rateLimited||run?.lastRun?.skipped?'WARNING':'OK';
  return {name,state,counts:count,lastCompletedAt:run?.lastCompletedAt??null,lastFailedAt:run?.lastFailedAt??null,lastRun:run?.lastRun??null};
 });
 const issues:string[]=[];
 if(!counts)issues.push('QUEUES_UNAVAILABLE');
 if(queues.some(q=>q.state==='ERROR'))issues.push('WORKER_MISSING');
 if(queues.some(q=>q.counts&&q.counts.failed>0))issues.push('RETAINED_FAILURES');
 if(queues.some(q=>q.lastRun?.providerFailures))issues.push('AI_PROVIDER_FAILURES');
 if(queues.some(q=>q.name==='ai-analysis'&&q.lastRun?.skipped))issues.push('AI_RUN_SKIPPED');
 if(queues.some(q=>q.lastRun?.rateLimited))issues.push('PROVIDER_RATE_LIMIT');
 if(ports.webhookConfigured===false)issues.push('WEBHOOK_NOT_CONFIGURED');
 else if(!validSync||elapsed(validSync.at,now)!>30*60)issues.push('WEBHOOK_SYNC_UNKNOWN');
 else if(validSync.webhookActive===false||validSync.error)issues.push('WEBHOOK_SYNC_PROBLEM');
 if(!validReceipt)issues.push('NO_DELIVERY_EVIDENCE');
 else if(validReceipt.parsed===0)issues.push('DELIVERY_UNPARSED');
 else if(validReceipt.queued===0)issues.push('DELIVERY_UNTRACKED');
 if(validReceipt&&elapsed(validReceipt.at,now)!>WEBHOOK_RECEIPT_STALE_SECONDS)issues.push('DELIVERY_STALE');
 if(walletCount&&!trades30d)issues.push('NO_WALLET_TRADES');
 const staleComputations=computation.filter(c=>Date.parse(c.checkedAt)>+now||elapsed(c.checkedAt,now)!>45*60).length;
 const missingComputations=wallets.length-computation.length;
 if(staleComputations||missingComputations)issues.push('WALLET_COMPUTATION_GAPS');
 if(walletCount>profileCount)issues.push('INSUFFICIENT_WALLET_HISTORY');
  if(ports.marketDataEnabled!==false&&(market.stale||market.unverified||market.future))issues.push('MARKET_COVERAGE_GAPS');
 if(unknownNames)issues.push('TOKEN_NAMES_MISSING');
 if([cfg.fastModel,cfg.reasoningModel].some(model=>!model.trim()||['gpt-6-luna','gpt-6-sol'].includes(model.trim())))issues.push('AI_MODEL_PLACEHOLDER');
 if(!aiOn)issues.push('AI_DISABLED');else if(ports.aiProviderConfigured===false)issues.push('AI_NOT_CONFIGURED');else if(used>=cfg.tokenBudget)issues.push('ANALYSIS_BUDGET_EXHAUSTED');
  const coverage=await researchCoverage(db,now);
   const resolutionCollectors=(['market','social','narrative'] as const).map(stage=>{
   const recorded=coverage?.stages.find(s=>s.stage===stage),latest=recorded?.latest??null;
   const at=latest&&Date.parse(latest.at)<=+now?latest.at:null,maxAgeSeconds=stage==='market'?900:1800;
    // Social/narrative resolution may run inside the scoped market worker or on token-resolution.
    // Their diagnostics are not evidence that the separate source-ingestion worker succeeded.
    const queue=stage==='market'?queues.find(q=>q.name==='market-data'):undefined;
   const state=stage==='market'&&ports.marketDataEnabled===false?'DISABLED':queue?.state==='ERROR'?'ERROR':!at?'UNKNOWN':elapsed(at,now)!>maxAgeSeconds?'STALE':latest?.counters.errors||queue?.state==='WARNING'?'WARNING':'OK';
   return {stage,state,lastRecordedAt:at,ageSeconds:elapsed(at,now),maxAgeSeconds,counters:at?latest!.counters:null};
   });
   const ingestion=queues.find(q=>q.name==='narrative-ingestion');
   const ingestionAt=ingestion?.lastCompletedAt&&Date.parse(ingestion.lastCompletedAt)<=+now?ingestion.lastCompletedAt:null;
   const ingestionCounters=ingestionAt&&ingestion?.lastRun?Object.fromEntries(['topicsSeen','mentionsStored','narrativesUpdated','providerErrors'].flatMap(key=>{const value=ingestion.lastRun?.[key as 'topicsSeen'|'mentionsStored'|'narrativesUpdated'|'providerErrors'];return value===undefined?[]:[[key,value]];})):null;
   const ingestionState=ingestion?.state==='ERROR'?'ERROR':!ingestionAt||ingestionCounters?.providerErrors===undefined?'UNKNOWN':ingestionCounters.providerErrors>0?'WARNING':elapsed(ingestionAt,now)!>35*60?'STALE':'OK';
   const collectors=[...resolutionCollectors,{stage:'narrative-ingestion' as const,state:ingestionState,lastRecordedAt:ingestionAt,ageSeconds:elapsed(ingestionAt,now),maxAgeSeconds:35*60,counters:ingestionCounters}];
  const lastMarket=collectors.find(c=>c.stage==='market');
  const budgets={priceTokensPerRun:MARKET_DATA_LIMITS.maxTokensPerRun,infoCallsPerRun:MARKET_DATA_LIMITS.maxInfoCallsPerRun,lastPriceTokens:lastMarket?.counters?.tokensConsidered??null,lastInfoCalls:lastMarket?.counters?.infoCalls??null};
  return {
    checkedAt:now.toISOString(),issues,queues,coverage,collectors,budgets,
  webhook:{configured:ports.webhookConfigured??null,lastReceipt:validReceipt,sync:validSync?{at:validSync.at,action:validSync.action,active:validSync.webhookActive,desired:validSync.desired,hasError:!!validSync.error}:null},
  wallets:{tracked:walletCount,profiles:profileCount,withoutProfile:walletCount-profileCount,trades30d,lastTradeAt:lastTrade?.at.toISOString()??null,lastComputedAt:lastComputation,scanned:wallets.length,capped:walletCount>wallets.length,missingComputations,staleComputations,historyCapped:history.filter(h=>typeof h.value==='object'&&h.value!==null&&!Array.isArray(h.value)&&h.value.capped===true).length},
  market:{...market,enabled:ports.marketDataEnabled!==false,unknownNames},
  analysis:{enabled:aiOn,providerConfigured:ports.aiProviderConfigured??null,fastModel:cfg.fastModel,reasoningModel:cfg.reasoningModel,usedToday:used,budget:cfg.tokenBudget,recentCandidates:candidateCount,recentBelowThreshold:belowThreshold,olderUnanalyzed:expiredCount},
 };
}
