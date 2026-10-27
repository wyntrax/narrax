import {randomUUID} from 'node:crypto';
import {afterAll,it,expect} from 'vitest';
import {createPrisma} from '@narra/database';
import {snapshot} from '@narra/market-data';
import {assertTestDatabase} from '../../../scripts/test-database';
import {storeMarketSnapshot} from './marketSnapshot';
import {publishWalletResearch,measureWalletResearch} from './walletResearch';
import {makeWalletEventStore} from './prismaStores';
import {buildApp} from '../../../apps/api/src/app';
import {walletScorePage} from '../../../apps/api/src/walletScorePage';
import {discoverCandidates,DISCOVERY_HEALTH_KEY,DISCOVERY_EMERGING_KEY} from './walletDiscovery';

assertTestDatabase(new URL(process.env.DATABASE_URL??'invalid:'));
const db=createPrisma(),tag=`wr${randomUUID().replace(/[^1-9A-HJ-NP-Za-km-z]/g,'x')}`,now=new Date('2041-05-31T12:00:00Z'),H=3600000;
const tokens:string[]=[],wallets:string[]=[],users:string[]=[],clusters:string[]=[];
const settingKeys:string[]=[];
async function price(tokenId:string,at:Date,value=1){return db.$transaction(tx=>storeMarketSnapshot(tx,tokenId,snapshot('mint',{priceUsd:value,liquidityUsd:50000,marketCapUsd:100000,marketCapIsFdv:false}),'dexscreener',at));}
async function setup(side:'BUY'|'SELL'='BUY'){
 const token=await db.token.create({data:{mint:`${tag}${tokens.length}`,symbol:'RESEARCH',name:'Research fixture'}});tokens.push(token.id);
 await price(token.id,new Date(+now-60000));
 await db.tokenHolderMetric.create({data:{tokenId:token.id,holders:100,top10Pct:20,at:now}});
 await db.tokenRiskMetric.create({data:{tokenId:token.id,riskScore:0,flags:[],at:now}});
 const pair=[];
 for(let i=0;i<2;i++){
  const w=await db.trackedWallet.create({data:{address:`${tag}${wallets.length}z`.replace(/0/g,'x').padEnd(40,'1'),researchReview:'APPROVED'}});wallets.push(w.id);pair.push(w);
  const sample={checkedAt:now.toISOString(),closedTrades:30,closedTokens:8,observedDays:10,unmatchedSells:0,excessSellUnits:0,score:80,pnlSol:1,medianRoi:0.1,lastTradeAt:now.toISOString()};
  const history={checkedAt:now.toISOString(),windowDays:30,capped:false,skipped:0,coveredFrom:new Date(+now-30*86400000).toISOString(),coveredTo:now.toISOString()};
  for(const [key,value] of [[`wallet.research.${w.id}`,sample],[`wallet.history.${w.id}`,history]] as const){settingKeys.push(key);await db.systemSetting.create({data:{key,value}});}
  await db.walletTrade.create({data:{walletId:w.id,tokenId:token.id,side,amountSol:1,tokenAmount:10,at:new Date(+now-30000),signature:`${tag}${wallets.length}trade`}});
 }
 return {token,pair};
}
afterAll(async()=>{
 const metrics=await db.tokenMetric.findMany({where:{tokenId:{in:tokens}},select:{id:true}});
 await db.systemSetting.deleteMany({where:{key:{in:[...settingKeys,...tokens.map(id=>`research.market.${id}`),...metrics.map(m=>`research.marketMetric.${m.id}`)]}}});
 await db.walletTrade.deleteMany({where:{tokenId:{in:tokens}}});
 await db.token.deleteMany({where:{id:{in:tokens}}});
 await db.trackedWallet.deleteMany({where:{id:{in:wallets}}});
 await db.walletCluster.deleteMany({where:{id:{in:clusters}}});
 await db.user.deleteMany({where:{id:{in:users}}});await db.$disconnect();
});

it('creates one immutable flow with three outcomes across concurrent publishers; no alerts or opportunities',async()=>{
 const {token}=await setup();
 await Promise.all([publishWalletResearch(db,()=>now),publishWalletResearch(db,()=>now)]);
 const signals=await db.walletResearchSignal.findMany({where:{tokenId:token.id},include:{measurements:true}});
 expect(signals).toHaveLength(1);const s=signals[0]!;
 expect(s.independentEntities).toBe(2);expect(Number(s.entryPriceUsd)).toBe(1);
 expect(s.measurements.map(m=>m.horizonHours).sort((a,b)=>a-b)).toEqual([1,4,24]);
 expect(await db.alert.count({where:{refId:token.id}})).toBe(0);
 expect(await db.opportunity.count({where:{tokenId:token.id}})).toBe(0);
 await price(token.id,new Date(+now+H-60000),2);
 await price(token.id,new Date(+now+H+1),999); // must not be used for the 1h mark
 await measureWalletResearch(db,new Date(+now+H));
 const m=await db.walletResearchMeasurement.findUniqueOrThrow({where:{signalId_horizonHours:{signalId:s.id,horizonHours:1}}});
 expect(m.status).toBe('MEASURED');expect(m.returnPct).toBe(100);
 await measureWalletResearch(db,new Date(+now+24*H));
 expect((await db.walletResearchMeasurement.findUniqueOrThrow({where:{signalId_horizonHours:{signalId:s.id,horizonHours:4}}})).status).toBe('UNKNOWN');
 await price(token.id,new Date(+now+4*H),3); // a later repair cannot rewrite a terminal unknown
 await measureWalletResearch(db,new Date(+now+25*H));
 expect((await db.walletResearchMeasurement.findUniqueOrThrow({where:{signalId_horizonHours:{signalId:s.id,horizonHours:4}}})).returnPct).toBeNull();
 expect(Number((await db.walletResearchSignal.findUniqueOrThrow({where:{id:s.id}})).entryPriceUsd)).toBe(1);
});

it.each(['provisional','cluster','stale','blacklist','unverified','holders','history','market-stale','future','honeypot','authority'] as const)('withholds %s evidence',async mode=>{
 const {token,pair}=await setup();
 if(mode==='provisional')await db.trackedWallet.update({where:{id:pair[0]!.id},data:{researchReview:'PROVISIONAL'}});
 if(mode==='cluster'){const c=await db.walletCluster.create({data:{label:'funding',confidence:'HIGH'}});clusters.push(c.id);await db.trackedWallet.updateMany({where:{id:{in:pair.map(w=>w.id)}},data:{clusterId:c.id}});}
 if(mode==='stale')await db.walletTrade.updateMany({where:{tokenId:token.id},data:{at:new Date(+now-20*60000)}});
 if(mode==='blacklist')await db.token.update({where:{id:token.id},data:{blacklisted:true}});
 if(mode==='unverified'){const m=await db.tokenMetric.findFirstOrThrow({where:{tokenId:token.id}});await db.systemSetting.delete({where:{key:`research.marketMetric.${m.id}`}});}
 if(mode==='holders')await db.tokenHolderMetric.updateMany({where:{tokenId:token.id},data:{holders:1}});
 if(mode==='history')await db.systemSetting.delete({where:{key:`wallet.history.${pair[0]!.id}`}});
 if(mode==='market-stale'||mode==='future')await db.tokenMetric.updateMany({where:{tokenId:token.id},data:{at:new Date(+now+(mode==='future'?1:-H))}});
 if(mode==='honeypot')await db.tokenRiskMetric.updateMany({where:{tokenId:token.id},data:{flags:['HONEYPOT']}});
 if(mode==='authority')await db.tokenRiskMetric.updateMany({where:{tokenId:token.id},data:{flags:['MINT_AUTHORITY_ACTIVE']}});
 await publishWalletResearch(db,()=>now);
 expect(await db.walletResearchSignal.count({where:{tokenId:token.id}})).toBe(0);
 // Keep later test publications from admitting the deliberately withheld fixtures.
 await db.trackedWallet.updateMany({where:{id:{in:pair.map(w=>w.id)}},data:{researchReview:'REJECTED'}});
});

it('records net selling as an observation, not proof of a full wallet exit',async()=>{
 const {token}=await setup('SELL');await publishWalletResearch(db,()=>now);
 const s=await db.walletResearchSignal.findFirstOrThrow({where:{tokenId:token.id}});
 expect(s.side).toBe('SELL');expect(Number(s.netFlowSol)).toBe(-2);
});

it('freezes trade-time evidence and leaves later-only prices unknown, including duplicates',async()=>{
 const {token,pair}=await setup();const store=makeWalletEventStore(db),w=pair[0]!;
 const sig=`${tag}evidence`;
 const event={wallet:w.address,mint:token.mint,side:'BUY' as const,amountSol:1,tokenAmount:2,at:now.toISOString(),signature:sig};
 expect(await store.saveWalletTrade(event)).toBe('created');
 const recorded=await db.walletTrade.findUniqueOrThrow({where:{signature:sig}});
 expect(Number(recorded.marketCapUsd)).toBe(100000);
 expect(recorded.evidence).toMatchObject({market:{source:'dexscreener',priceUsd:1}});
 await price(token.id,now,2);
 expect(await store.saveWalletTrade(event)).toBe('duplicate');
 expect((await db.walletTrade.findUniqueOrThrow({where:{signature:sig}})).evidence).toEqual(recorded.evidence);
 const old={...event,signature:`${sig}old`,at:new Date(+now-H).toISOString()};
 await store.saveWalletTrade(old);
 expect((await db.walletTrade.findUniqueOrThrow({where:{signature:old.signature}})).marketCapUsd).toBeNull();
});

it('enforces authentication, research access and admin review; approval cannot fabricate qualification',async()=>{
 const admin=await db.user.create({data:{privyUserId:`${tag}admin`,isAdmin:true}}),user=await db.user.create({data:{privyUserId:`${tag}user`}});users.push(admin.id,user.id);
 const app=await buildApp({account:{db,now:()=>now,verifier:{verify:async token=>({privyUserId:token})}}});
 try{
  const publicHeaders={authorization:`Bearer ${user.privyUserId}`},adminHeaders={authorization:`Bearer ${admin.privyUserId}`};
  for(const url of ['/v1/smart-money/flows','/v1/smart-money/emerging']){
   expect((await app.inject({url})).statusCode).toBe(401);
   expect((await app.inject({url,headers:publicHeaders})).statusCode).toBe(403);
   expect((await app.inject({url,headers:adminHeaders})).statusCode).toBe(200);
  }
  const w=await db.trackedWallet.create({data:{address:`${tag}Review`.padEnd(40,'1')}});wallets.push(w.id);
  expect((await app.inject({url:'/v1/admin/wallet-research/health',headers:publicHeaders})).statusCode).toBe(403);
  const health=await app.inject({url:'/v1/admin/wallet-research/health',headers:adminHeaders});
  expect(health.statusCode).toBe(200);expect(typeof health.json().enabled).toBe('boolean');expect(health.json().rules.version).toBe(1);
  const url=`/v1/admin/wallets/${w.address}/research-review`,payload={status:'APPROVED',reason:'Inspect sampled evidence'};
  expect((await app.inject({method:'POST',url,headers:publicHeaders,payload})).statusCode).toBe(403);
  const response=await app.inject({method:'POST',url,headers:adminHeaders,payload});
  expect(response.statusCode).toBe(200);expect(response.json().qualification.eligible).toBe(false);
  expect(await db.auditLog.count({where:{userId:admin.id,action:'wallet.research_review'}})).toBe(1);
  const list=await app.inject({url:'/v1/admin/wallets',headers:adminHeaders});expect(list.statusCode).toBe(200);
 }finally{await app.close();}
});

it('sorts scored wallets ahead of missing profiles across cursor pages',async()=>{
 const {pair}=await setup();
 await db.walletProfile.create({data:{walletId:pair[1]!.id,score:10,leaderScore:0}});
 const first=await walletScorePage(db,{term:tag,limit:1});
 expect(first[0]).toBe(pair[1]!.id);
 const second=await walletScorePage(db,{term:tag,limit:1,cursor:first[0]});
 expect(second).not.toContain(first[0]);
});

it('reports discovery missingness and repeats without treating one observation as a loss or approving emerging wallets',async()=>{
 const at=new Date('2042-06-01T12:00:00Z'),address=`${tag}Emerging`;
 const saved=await db.systemSetting.findMany({where:{key:{in:[DISCOVERY_HEALTH_KEY,DISCOVERY_EMERGING_KEY]}}});
 try{
  for(let i=0;i<4;i++){
   const t=await db.token.create({data:{mint:`${tag}discovery${i}`,symbol:'RESEARCH',name:'Research fixture',createdOnChainAt:new Date(+at-2*H),earlyBuyers:{create:{complete:true,buyers:[{wallet:address,rank:1,signature:'evidence',at:new Date(+at-2*H).toISOString()}],scannedAt:at}}}});tokens.push(t.id);
   if(i>=2)await price(t.id,new Date(+at-H));
   if(i===3)await price(t.id,at,4);
  }
  const result=await discoverCandidates(db,at);
  expect(result).toMatchObject({completeScans:4,noPrice:2,insufficientObservations:1,tokensJudged:1,winners:1,candidates:0,emerging:1});
  expect((await db.systemSetting.findUniqueOrThrow({where:{key:DISCOVERY_EMERGING_KEY}})).value).toMatchObject({items:[{address,scannedTokens:4,spend:{observedTokens:4,matchedTokens:0,unknownTokens:4,medianMatchedQuoteSol:null,unknownReasons:{LEGACY_NO_SPEND_EVIDENCE:4}}}]});
  expect(await db.walletCandidate.count({where:{address}})).toBe(0);
  expect(await db.trackedWallet.count({where:{address}})).toBe(0);
 }finally{
  await db.systemSetting.deleteMany({where:{key:{in:[DISCOVERY_HEALTH_KEY,DISCOVERY_EMERGING_KEY]}}});
  for(const s of saved)await db.systemSetting.create({data:{key:s.key,value:s.value!}});
 }
});
