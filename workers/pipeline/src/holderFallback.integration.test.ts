import {randomBytes,randomUUID} from 'node:crypto';
import bs58 from 'bs58';
import {beforeAll,beforeEach,afterAll,expect,it,vi} from 'vitest';
import {createPrisma,type Prisma} from '@narra/database';
import {FixtureMarketData,snapshot,info} from '@narra/market-data';
import {assertTestDatabase} from '../../../scripts/test-database';
import {refreshHolderFallback,refreshRadarHolders,HOLDER_FALLBACK_KEY} from './holderFallback';
import {refreshMarketData} from './marketData';
import type {HolderRpcResult} from './holderRpc';
import {createEarlyRadarAlert} from './earlyRadarTracking';
import {deliverEarlyRadarTelegram,telegramCursorKey} from './telegram';
import {storeMarketSnapshot} from './marketSnapshot';
import {holderGrowthBaseline} from './holderHistory';
import {saveSocialPriority,SOCIAL_INFO_PRIORITY_KEY,COVERAGE_LIMITS} from './researchDiagnostics';
assertTestDatabase(new URL(process.env.DATABASE_URL!));
const db=createPrisma(),now=new Date('2051-03-01T12:00:00Z'),tag=`holder-${randomUUID()}`;
const budget={perRun:2,deadlineMs:30_000};
const tokens:{id:string;mint:string}[]=[];let previous:Prisma.JsonValue|undefined;
beforeAll(async()=>{
 previous=(await db.systemSetting.findUnique({where:{key:HOLDER_FALLBACK_KEY}}))?.value;
 for(let i=0;i<4;i++)tokens.push(await db.token.create({data:{id:`${tag}-${i}`,mint:bs58.encode(randomBytes(32)),name:tag,symbol:tag,createdOnChainAt:new Date(+now-3600000)},select:{id:true,mint:true}}));
});
beforeEach(async()=>{await db.systemSetting.deleteMany({where:{key:HOLDER_FALLBACK_KEY}});await db.tokenHolderMetric.deleteMany({where:{tokenId:{in:tokens.map(t=>t.id)}}});});
afterAll(async()=>{
 const alerts=await db.alert.findMany({where:{refId:{in:tokens.map(t=>t.id)}},select:{id:true}});
 await db.systemSetting.deleteMany({where:{key:{in:[telegramCursorKey(tag),...alerts.map(a=>`research.radarSafety.${a.id}`)]}}});
 await db.alert.deleteMany({where:{refId:{in:tokens.map(t=>t.id)}}});
 await db.systemSetting.deleteMany({where:{OR:[{key:HOLDER_FALLBACK_KEY},...tokens.flatMap(t=>[{key:`research.holders.${t.id}`},{key:`research.market.${t.id}`},{key:{startsWith:'research.holderMetric.'},value:{path:['mint'],equals:t.mint}}])]}});
 const metrics=await db.tokenMetric.findMany({where:{tokenId:{in:tokens.map(t=>t.id)}},select:{id:true}});await db.systemSetting.deleteMany({where:{key:{in:metrics.map(m=>`research.marketMetric.${m.id}`)}}});
 await db.token.deleteMany({where:{id:{in:tokens.map(t=>t.id)}}});
 if(previous!==undefined)await db.systemSetting.create({data:{key:HOLDER_FALLBACK_KEY,value:previous as Prisma.InputJsonValue}});
 await db.$disconnect();
});
function source(){return {get:vi.fn(async(mint:string):Promise<HolderRpcResult>=>({ok:true,mint,holders:200,top10Pct:30,sourceAt:new Date(+now-10000),slot:123,accounts:205,program:'test-program'}))};}
it('writes at most two real observations with immutable provenance; rotates and skips fresh holders',async()=>{
 const rpc=source(),first=await refreshHolderFallback(db,rpc,tokens,()=>now,budget);expect(first).toMatchObject({holderFallbackAttempts:2,holderFallbackWritten:2});
 expect(await db.tokenHolderMetric.count({where:{tokenId:{in:tokens.map(t=>t.id)}}})).toBe(2);
 const row=await db.tokenHolderMetric.findFirstOrThrow({where:{tokenId:tokens[0]!.id}});
 expect(row.at).toEqual(new Date(+now-10000));expect(row.devHoldingPct).toBeNull();
 expect((await db.systemSetting.findUniqueOrThrow({where:{key:`research.holderMetric.${row.id}`}})).value).toMatchObject({source:'solana-rpc',slot:123,complete:true,basis:'positive-balance-owners-including-pools',sourceAt:row.at.toISOString()});
 expect(await refreshHolderFallback(db,rpc,tokens,()=>new Date(+now+5*60000),budget)).toMatchObject({holderFallbackAttempts:2,holderFallbackWritten:2});
 expect(await refreshHolderFallback(db,rpc,tokens,()=>new Date(+now+10*60000),budget)).toMatchObject({holderFallbackAttempts:0,holderFallbackDeferred:0});
 expect(await db.alert.count({where:{refId:{in:tokens.map(t=>t.id)}}})).toBe(0);
});
it('serves the oldest holder observations first and reports the demand it could not serve',async()=>{
 const ages=[120,110,100,90];
 for(let i=0;i<tokens.length;i++)await db.tokenHolderMetric.create({data:{tokenId:tokens[i]!.id,holders:100+i,top10Pct:20,at:new Date(+now-ages[i]!*60000)}});
 const rpc=source();
 expect(await refreshHolderFallback(db,rpc,tokens,()=>now,budget)).toMatchObject({holderFallbackCandidates:4,holderFallbackFresh:0,holderFallbackAttempts:2,holderFallbackDeferred:2});
 expect(rpc.get.mock.calls.map(c=>c[0])).toEqual([tokens[0]!.mint,tokens[1]!.mint]);
});
it('spends no RPC work on candidates already inside the holder gate',async()=>{
 for(const t of tokens)await db.tokenHolderMetric.create({data:{tokenId:t.id,holders:200,top10Pct:30,at:new Date(+now-5*60000)}});
 const rpc=source();
 expect(await refreshHolderFallback(db,rpc,tokens,()=>now,budget)).toMatchObject({holderFallbackCandidates:4,holderFallbackFresh:4,holderFallbackAttempts:0,holderFallbackDeferred:0});
 expect(rpc.get).not.toHaveBeenCalled();
});
it('stops before starting work once the wall-clock deadline is spent',async()=>{
 const rpc=source();
 expect(await refreshHolderFallback(db,rpc,tokens,()=>now,{perRun:12,deadlineMs:0})).toMatchObject({holderFallbackAttempts:0,holderFallbackDeferred:4,holderFallbackDeadlineHit:1});
 expect(rpc.get).not.toHaveBeenCalled();
});
it('keeps failed and future observations unknown and persists provider cooldown',async()=>{
 const rpc=source();rpc.get.mockResolvedValueOnce({ok:false,reason:'RATE_LIMITED'});
 expect(await refreshHolderFallback(db,rpc,tokens,()=>now,budget)).toMatchObject({holderFallbackAttempts:1,holderFallbackWritten:0,holderFallbackThrottled:1});
 expect(await refreshHolderFallback(db,rpc,tokens,()=>new Date(+now+5*60000),budget)).toMatchObject({holderFallbackAttempts:0});
 rpc.get.mockImplementation(async mint=>({ok:true,mint,holders:200,top10Pct:30,sourceAt:new Date(+now+3600000),slot:123,accounts:205,program:'test'}));
 expect(await refreshHolderFallback(db,rpc,tokens,()=>new Date(+now+16*60000),budget)).toMatchObject({holderFallbackWritten:0,holderFallbackUnknown:2});
 expect(await db.tokenHolderMetric.count({where:{tokenId:{in:tokens.map(t=>t.id)}}})).toBe(0);
});
it('cached Gecko refresh cannot relabel newer RPC holder evidence',async()=>{
 const t=tokens[0]!,rpc=source();await refreshHolderFallback(db,rpc,[t],()=>now);
 const fixture=new FixtureMarketData({snapshots:[snapshot(t.mint,{marketCapUsd:40000})],info:[info(t.mint,{holdersUpdatedAt:new Date(+now-12*3600000)})]});
 await refreshMarketData(db,{quotes:fixture,info:fixture,launches:null},now,{maxTokens:10000});
 expect((await db.systemSetting.findUniqueOrThrow({where:{key:`research.holders.${t.id}`}})).value).toMatchObject({source:'solana-rpc',sourceAt:new Date(+now-10000).toISOString()});
 expect((await db.tokenHolderMetric.findFirstOrThrow({where:{tokenId:t.id},orderBy:{at:'desc'}})).at).toEqual(new Date(+now-10000));
});
it('fresh RPC holders can cross publication and delivery gates; failed fallback cannot',async()=>{
 const t=tokens[0]!;
 // Equal observation times do not identify a row: the preceding collection test
 // also writes a fixture-source metric at `now`. Keep the exact verified row.
 const unverified=await db.$transaction(tx=>storeMarketSnapshot(tx,t.id,snapshot(t.mint,{marketCapUsd:40000}),'fixture',now));
 const metric=await db.$transaction(tx=>storeMarketSnapshot(tx,t.id,snapshot(t.mint,{marketCapUsd:40000}),'dexscreener',now));
 const stale=await db.tokenHolderMetric.create({data:{tokenId:t.id,holders:200,top10Pct:30,at:new Date(+now-12*3600000)}});
 const input={tokenId:t.id,mint:t.mint,profile:'trencher' as const,tier:'WATCH' as const,route:'SOCIAL' as const,matchKind:'MINT' as const,score:60,metricId:metric.id,holderMetricId:stale.id,title:'Research fixture',body:'Research only'};
 expect(await createEarlyRadarAlert(db,input,now)).toEqual({created:false,reason:'HOLDERS_STALE'});
 await refreshHolderFallback(db,{get:async()=>({ok:false,reason:'INVALID_OR_INCOMPLETE'})},[t],()=>now);
 expect(await createEarlyRadarAlert(db,input,now)).toEqual({created:false,reason:'HOLDERS_STALE'});
 await db.systemSetting.deleteMany({where:{key:HOLDER_FALLBACK_KEY}});
 expect(await refreshHolderFallback(db,source(),[t],()=>now)).toMatchObject({holderFallbackAttempts:1,holderFallbackWritten:1});
 const fresh=await db.tokenHolderMetric.findFirstOrThrow({where:{tokenId:t.id},orderBy:{at:'desc'}});
 expect(fresh.at).toEqual(new Date(+now-10000));
 // Even with fresh holders, the same-timestamp fixture row must remain rejected.
 expect(await createEarlyRadarAlert(db,{...input,metricId:unverified.id,holderMetricId:fresh.id},now)).toEqual({created:false,reason:'MARKET_UNVERIFIED'});
 const previous=process.env.RADAR_SAFETY_MODE;process.env.RADAR_SAFETY_MODE='shadow';
 try{
  const published=await createEarlyRadarAlert(db,{...input,holderMetricId:fresh.id},now);
  expect(published,JSON.stringify(published)).toMatchObject({created:true,safety:{status:'UNKNOWN'}});
 }finally{if(previous===undefined)delete process.env.RADAR_SAFETY_MODE;else process.env.RADAR_SAFETY_MODE=previous;}
 const transport={send:vi.fn(async()=>({ok:true,messageId:'fixture'}))};
 // Isolate this test's delivery selection without altering the production cursor logic.
 const isolated={...db,alert:{findMany:async(args:any)=>db.alert.findMany({...args,where:{AND:[args.where,{refId:t.id}]}})}} as unknown as typeof db;
 const delivered=await deliverEarlyRadarTelegram(isolated,{chatId:tag,now,transport,dryRun:false,delayMs:0});
 expect(delivered).toMatchObject({sent:1,failed:0,stopped:false});expect(transport.send).toHaveBeenCalledOnce();
});
it('market collection invokes fallback for eligible stale-holder tokens even without primary info',async()=>{
 const t=tokens[1]!,at=new Date();
 // The radar cohort is read from scheduling state; clear it so only this run's token is offered.
 await db.systemSetting.deleteMany({where:{key:SOCIAL_INFO_PRIORITY_KEY}});
 await db.token.update({where:{id:t.id},data:{createdOnChainAt:new Date(+at-3600000)}});
 const fixture=new FixtureMarketData({snapshots:[snapshot(t.mint,{marketCapUsd:40000})]});
 const rpc={get:vi.fn(async(mint:string):Promise<HolderRpcResult>=>({ok:true,mint,holders:200,top10Pct:30,sourceAt:new Date(+at-10000),slot:123,accounts:205,program:'test'}))};
 const result=await refreshMarketData(db,{quotes:fixture,info:null,launches:null,holderFallback:rpc},at,{maxTokens:10000});
 expect(result).toMatchObject({holderFallbackAttempts:1,holderFallbackWritten:1});
 expect(rpc.get).toHaveBeenCalledWith(t.mint);
 expect((await db.tokenHolderMetric.findFirstOrThrow({where:{tokenId:t.id},orderBy:{at:'desc'}})).at).toEqual(new Date(+at-10000));
});
it('refreshes the radar cohort independently of which tokens the market run priced',async()=>{
 const t=tokens[3]!;
 await saveSocialPriority(db,[t.id],now);
 const rpc=source();
 try{
  expect(await refreshRadarHolders(db,rpc,now)).toMatchObject({holderFallbackCandidates:1,holderFallbackAttempts:1,holderFallbackWritten:1});
  expect(rpc.get).toHaveBeenCalledWith(t.mint);
  expect(await db.tokenHolderMetric.count({where:{tokenId:t.id}})).toBe(1);
 }finally{await db.systemSetting.deleteMany({where:{key:SOCIAL_INFO_PRIORITY_KEY}});}
});
it('does nothing for the radar cohort when the priority list has expired',async()=>{
 await saveSocialPriority(db,[tokens[3]!.id],now);
 const rpc=source();
 try{
  expect(await refreshRadarHolders(db,rpc,new Date(+now+COVERAGE_LIMITS.priorityMaxAgeMs+1))).toMatchObject({holderFallbackCandidates:0,holderFallbackAttempts:0});
  expect(rpc.get).not.toHaveBeenCalled();
 }finally{await db.systemSetting.deleteMany({where:{key:SOCIAL_INFO_PRIORITY_KEY}});}
});
it('does not turn a switch from Gecko to RPC (or back) into holder growth',async()=>{
 const t=tokens[2]!,past=new Date(+now-4*3600000);
 const old=await db.tokenHolderMetric.create({data:{tokenId:t.id,holders:150,top10Pct:30,at:past}});
 await refreshHolderFallback(db,source(),[t],()=>now);
 const fresh=await db.tokenHolderMetric.findFirstOrThrow({where:{tokenId:t.id},orderBy:{at:'desc'}});
 expect(await holderGrowthBaseline(db,t.id,fresh.id,new Date(+now-3*3600000))).toBeNull();
 await db.systemSetting.create({data:{key:`research.holderMetric.${old.id}`,value:{mint:t.mint,source:'solana-rpc',basis:'positive-balance-owners-including-pools'}}});
 expect(await holderGrowthBaseline(db,t.id,fresh.id,new Date(+now-3*3600000))).toBe(150);
 const gecko=await db.tokenHolderMetric.create({data:{tokenId:t.id,holders:200,top10Pct:30,at:new Date(+now+60000)}});
 expect(await holderGrowthBaseline(db,t.id,gecko.id,new Date(+now-3*3600000))).toBeNull();
});
