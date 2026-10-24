import {it,expect,vi,afterEach} from 'vitest';
import type {PrismaClient} from '@narra/database';
import {dataHealth} from './dataHealth';
import {DataHealthSchema} from '../../web/src/features/admin/contracts';
const config=vi.hoisted(()=>({tokenBudget:1000,fastModel:'model-fast',reasoningModel:'model-reason'}));
const telemetry=vi.hoisted(()=>({stages:[] as {stage:string;latest:{at:string;runs:number;counters:Record<string,number>}|null}[]}));
vi.mock('@narra/worker-pipeline',()=>({aiEnabled:async()=>true,loadAiConfig:async()=>config,tokensUsedToday:async()=>1000,researchCoverage:async()=>telemetry.stages.length?{stages:telemetry.stages}:undefined,MARKET_DATA_LIMITS:{maxTokensPerRun:150,maxInfoCallsPerRun:18}}));
afterEach(()=>{telemetry.stages=[];});
const now=new Date('2026-10-18T12:00:00Z'),iso=now.toISOString();
it.each(['gpt-6-luna','gpt-6-sol','','   '])('flags placeholder or empty model %j read-only',async model=>{
 for(const field of ['fastModel','reasoningModel'] as const){
  const previous=config[field];config[field]=model;
  try{const result=await dataHealth(database().db,{},now);expect(result.issues).toContain('AI_MODEL_PLACEHOLDER');expect(result.analysis[field]).toBe(model);}finally{config[field]=previous;}
 }
});
it('does not flag real configured model names',async()=>{expect((await dataHealth(database().db,{},now)).issues).not.toContain('AI_MODEL_PLACEHOLDER');});
function database(){
 const rows=[{key:'health.walletWebhook.receipt',value:{at:iso,items:5,parsed:0,queued:0,skipped:5}},{key:'wallets.syncStatus',value:{at:iso,action:'skipped',desired:2,webhookActive:true,error:'secret-key-and-provider-url'}},{key:'wallet.intelligence.w1',value:{checkedAt:iso,closedTrades:5,observedTrades:10,status:'READY'}},{key:'wallet.history.w1',value:{capped:true}},{key:'research.market.t1',value:{metricId:'m1',at:iso,source:'dexscreener',marketCapIsFdv:false,priceChange1hPct:null,pairAddress:'pool',dexId:null,pairCreatedAt:null}}];
 const db={systemSetting:{findMany:async(q:{where:{key:{in:string[]}}})=>rows.filter(r=>q.where.key.in.includes(r.key))},trackedWallet:{count:async()=>2,findMany:async()=>[{id:'w1'},{id:'w2'}]},walletProfile:{count:async()=>1},walletTrade:{findFirst:async()=>({at:now}),count:async()=>10},token:{count:async(q:{where:{OR?:unknown}})=>q.where.OR?1:2,findMany:async()=>[{id:'t1',mint:'mint1',symbol:'ONE',metrics:[{id:'m1'}]},{id:'t2',mint:'mint2',symbol:'UNKNOWN',metrics:[{id:'m2'}]}]},opportunity:{count:async()=>3}};
 return {db:db as unknown as PrismaClient,rows};
}
it('distinguishes missing computation, unsupported delivery and source-linked price coverage without leaking errors',async()=>{
 const {db}=database();
 const result=await dataHealth(db,{queueCounts:async()=>({'wallet-events':{waiting:1,active:0,failed:0,delayed:0,consumers:0}})},now);
 expect(DataHealthSchema.safeParse(result).success).toBe(true);
 expect(result.issues).toEqual(expect.arrayContaining(['WORKER_MISSING','DELIVERY_UNPARSED','WALLET_COMPUTATION_GAPS','INSUFFICIENT_WALLET_HISTORY','ANALYSIS_BUDGET_EXHAUSTED']));
 expect(result.market).toMatchObject({fresh:1,unverified:1});expect(result.wallets).toMatchObject({profiles:1,withoutProfile:1,missingComputations:1,historyCapped:1});
 expect(JSON.stringify(result)).not.toContain('secret-key');
});
it('reports unavailable queue diagnostics and unknown delivery rather than inventing health',async()=>{
 const {db,rows}=database();rows.splice(0,1);
 const result=await dataHealth(db,{queueCounts:async()=>{throw new Error('secret');}},now);
 expect(result.webhook.lastReceipt).toBeNull();expect(result.queues.every(q=>q.state==='UNKNOWN')).toBe(true);
  expect(result.issues).toContain('QUEUES_UNAVAILABLE');expect(result.issues).toContain('NO_DELIVERY_EVIDENCE');
  expect(result.collectors.every(c=>c.state==='UNKNOWN')).toBe(true);
  expect(result.budgets).toEqual({priceTokensPerRun:150,infoCallsPerRun:18,lastPriceTokens:null,lastInfoCalls:null});
});
it('distinguishes stale completion, future telemetry, recorded failures and zero work',async()=>{
 telemetry.stages=[{stage:'market',latest:{at:new Date(+now-16*60000).toISOString(),runs:1,counters:{tokensConsidered:150,infoCalls:18}}},{stage:'social',latest:{at:new Date(+now+60000).toISOString(),runs:1,counters:{errors:0}}},{stage:'narrative',latest:{at:iso,runs:1,counters:{errors:2}}}];
 const {db}=database(),r=await dataHealth(db,{},now);
 expect(r.collectors.map(c=>c.state)).toEqual(['STALE','UNKNOWN','WARNING','UNKNOWN']);
 expect(r.budgets.lastPriceTokens).toBe(150);expect(r.budgets.lastInfoCalls).toBe(18);
 telemetry.stages[0]!.latest={at:iso,runs:1,counters:{tokensConsidered:0,infoCalls:0}};
 expect((await dataHealth(db,{},now)).budgets.lastPriceTokens).toBe(0);
 expect((await dataHealth(db,{marketDataEnabled:false},now)).collectors[0]?.state).toBe('DISABLED');
});
it('never treats recent token resolution as successful external narrative ingestion',async()=>{
 telemetry.stages=[{stage:'narrative',latest:{at:iso,runs:1,counters:{errors:0}}}];
 const {db}=database();
 const ports={queueCounts:async()=>({'narrative-ingestion':{waiting:0,active:0,failed:0,delayed:1,consumers:1}}),queueHealth:async()=>({'narrative-ingestion':{lastCompletedAt:iso,lastFailedAt:null,lastRun:{topicsSeen:7,providerErrors:7,mentionsStored:0,narrativesUpdated:0}}})};
 const result=await dataHealth(db,ports,now);
 expect(result.collectors.find(s=>s.stage==='narrative')?.state).toBe('OK');
 expect(result.collectors.find(s=>s.stage==='narrative-ingestion')).toMatchObject({state:'WARNING',counters:{providerErrors:7,mentionsStored:0}});
 expect(result.queues.find(q=>q.name==='narrative-ingestion')?.state).toBe('WARNING');
 expect((await dataHealth(db,{},now)).collectors.find(s=>s.stage==='narrative-ingestion')?.state).toBe('UNKNOWN');
});
it('counts only recent failures against current queue health, not retained history',async()=>{
 telemetry.stages=[{stage:'market',latest:{at:iso,runs:1,counters:{tokensConsidered:150,infoCalls:18,errors:0}}}];
 const {db}=database(),counts=async()=>({'market-data':{waiting:0,active:1,failed:7,delayed:0,consumers:1}});
 const old=await dataHealth(db,{queueCounts:counts,queueHealth:async()=>({'market-data':{lastCompletedAt:iso,lastFailedAt:new Date(+now-2*3600000).toISOString(),lastRun:null}})},now);
 expect(old.queues.find(q=>q.name==='market-data')?.state).toBe('OK');
 expect(old.collectors.find(c=>c.stage==='market')?.state).toBe('OK');
 const recent=await dataHealth(db,{queueCounts:counts,queueHealth:async()=>({'market-data':{lastCompletedAt:iso,lastFailedAt:new Date(+now-5*60000).toISOString(),lastRun:null}})},now);
 expect(recent.queues.find(q=>q.name==='market-data')?.state).toBe('WARNING');
});
it('counts only mint-bound artwork and separates future prices from fresh coverage',async()=>{
 const {db,rows}=database();
 Object.assign(rows.find(r=>r.key==='research.market.t1')!.value,{mint:'mint1',imageUrl:'https://cdn.dexscreener.com/cms/images/a.png',at:new Date(+now+60000).toISOString()});
 const result=await dataHealth(db,{},now);
 expect(result.market).toMatchObject({fresh:0,stale:0,future:1,withStoredArtwork:1,withoutStoredArtwork:1});
 Object.assign(rows.find(r=>r.key==='research.market.t1')!.value,{mint:'other'});
 expect((await dataHealth(db,{},now)).market.withStoredArtwork).toBe(0);
});
it('separates intentionally disabled pipelines from absent workers',async()=>{
 const {db}=database();const result=await dataHealth(db,{webhookConfigured:false,marketDataEnabled:false,aiProviderConfigured:false},now);
 expect(result.queues.find(q=>q.name==='ai-analysis')?.state).toBe('DISABLED');
 expect(result.queues.find(q=>q.name==='market-data')?.state).toBe('DISABLED');
 expect(result.issues).not.toContain('MARKET_COVERAGE_GAPS');expect(result.issues).toContain('AI_NOT_CONFIGURED');
});
it('flags stale delivery even when webhook sync and scoring are fresh',async()=>{
 const {db,rows}=database();
 Object.assign(rows[0]!.value,{at:new Date(+now-2*3600000).toISOString(),parsed:5,queued:5});
 const result=await dataHealth(db,{},now);
 expect(result.issues).toContain('DELIVERY_STALE');
 expect(result.webhook.lastReceipt?.at).toBe(new Date(+now-2*3600000).toISOString());
 expect((await dataHealth(database().db,{},now)).issues).not.toContain('DELIVERY_STALE');
});
