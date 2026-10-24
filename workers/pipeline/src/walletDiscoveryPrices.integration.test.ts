import {afterAll,expect,it} from 'vitest';
import {createPrisma} from '@narra/database';
import {discoveryPriceCandidates} from './walletDiscovery';
import {FixtureMarketData,snapshot} from '@narra/market-data';
import {DISCOVERY_PRICE_CURSOR_KEY,refreshMarketData} from './marketData';
const db=createPrisma(),tag=`discovery-prices-${Date.now()}`;
const now=new Date('2040-01-01T12:00:00Z');
afterAll(async()=>{
 const tokens=await db.token.findMany({where:{mint:{startsWith:tag}},include:{metrics:true}});
 await db.systemSetting.deleteMany({where:{key:{in:tokens.flatMap(t=>[`research.market.${t.id}`,...t.metrics.map(m=>`research.marketMetric.${m.id}`)])}}});
 await db.token.deleteMany({where:{mint:{startsWith:tag}}});await db.$disconnect();
});
it('rotates complete scans before and after pricing, excluding old, blocked and reserved tokens',async()=>{
 const make=async(suffix:string,over:{blacklisted?:boolean;createdOnChainAt?:Date;complete?:boolean}={})=>db.token.create({data:{mint:`${tag}-${suffix}`,symbol:suffix,name:suffix,blacklisted:over.blacklisted??false,createdOnChainAt:over.createdOnChainAt??new Date(+now-3600000),earlyBuyers:{create:{complete:over.complete??true,buyers:[],scannedAt:now}}}});
 const a=await make('A'),b=await make('B'),c=await make('C'),reserved=await make('reserved');
 await make('incomplete',{complete:false});await make('blacklisted',{blacklisted:true});await make('old',{createdOnChainAt:new Date(+now-49*3600000)});
 await db.tokenMetric.create({data:{tokenId:a.id,priceUsd:1,marketCapUsd:100000,liquidityUsd:20000,volume24hUsd:10000,at:now}});
 const ids=[a.id,b.id,c.id].sort();
 const first=await discoveryPriceCandidates(db,now,2,[reserved.id],null);
 expect(first).toEqual(ids.slice(0,2));
 expect(await discoveryPriceCandidates(db,now,2,[reserved.id],first[1]!)).toEqual([ids[2],ids[0]]);
 expect(await discoveryPriceCandidates(db,now,0,[],null)).toEqual([]);
 const saved=await db.systemSetting.findUnique({where:{key:DISCOVERY_PRICE_CURSOR_KEY}});
 try{
  const quotes=new FixtureMarketData({snapshots:[snapshot(b.mint),snapshot(c.mint)]});
  const firstRun=await refreshMarketData(db,{quotes,info:null,launches:null},now,{maxTokens:150});
  expect(firstRun.tokensConsidered).toBeLessThanOrEqual(150);
  await refreshMarketData(db,{quotes,info:null,launches:null},new Date(+now+5*60000),{maxTokens:150});
  // First and later observations are required to judge discovery's growth condition.
  expect(await db.tokenMetric.count({where:{tokenId:b.id}})).toBe(2);
  expect(await db.tokenMetric.count({where:{tokenId:c.id}})).toBe(2);
 }finally{
  if(saved)await db.systemSetting.upsert({where:{key:saved.key},create:{key:saved.key,value:saved.value!},update:{value:saved.value!}});
  else await db.systemSetting.deleteMany({where:{key:DISCOVERY_PRICE_CURSOR_KEY}});
 }
});
