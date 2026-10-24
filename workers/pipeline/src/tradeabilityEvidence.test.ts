import {it,expect,vi,afterEach} from 'vitest';
import type {PrismaClient} from '@narra/database';
import {JupiterClient,type Quote,type QuoteRequest} from '@narra/solana';
import {makeTradeabilitySource,USDC_MINT,TRADEABILITY_PREFIX,TRADEABILITY_TICKET_USD} from './tradeabilityEvidence';
import {testTradeability} from '../../../scripts/test-tradeability';

const MINT='So11111111111111111111111111111111111111113',NOW=new Date('2026-10-23T12:00:00Z');
afterEach(()=>{vi.useRealTimers();delete process.env.RADAR_SAFETY_MODE;delete process.env.RADAR_TRADEABILITY_EVIDENCE;});

function db(){
 const rows=new Map<string,unknown>();
 return {rows,client:{systemSetting:{
  findUnique:async({where:{key}}:{where:{key:string}})=>({key,value:rows.get(key)??null}),
  upsert:async({where:{key},create}:{where:{key:string};create:{value:unknown}})=>{rows.set(key,create.value);return {key,value:create.value};},
 }} as unknown as PrismaClient};
}
function quote(over:Partial<Quote>={}):Quote{
 return {inputMint:USDC_MINT,outputMint:MINT,inAmount:'50000000',outAmount:'1000000',otherAmountThreshold:'995000',priceImpactPct:1.5,slippageBps:50,fetchedAt:NOW,raw:{routePlan:[{swapInfo:{ammKey:'test-pool',inputMint:USDC_MINT,outputMint:over.outputMint??MINT,inAmount:'50000000',outAmount:'1000000'}}]},...over};
}
function source(over:{db:PrismaClient;getQuote?:()=>Promise<Quote>;maxPerRun?:number;spacingMs?:number;cacheTtlMs?:number}){
 const calls:QuoteRequest[]=[];
 const s=makeTradeabilitySource(over.db,{maxPerRun:over.maxPerRun??3,spacingMs:over.spacingMs??0,cacheTtlMs:over.cacheTtlMs,quote:{getQuote:async(req)=>{calls.push(req);return over.getQuote?await over.getQuote():quote({outputMint:req.outputMint});}}});
 return {s:s!,calls};
}

it('records a real $50 USDC quote and reuses the mint-bound cache instead of re-quoting',async()=>{
 const store=db();
 const {s,calls}=source({db:store.client});
 const first=await s.get(MINT,NOW);
 expect(first).toMatchObject({mint:MINT,source:'jupiter',ticketUsdc:TRADEABILITY_TICKET_USD,priceImpactPct:1.5,inAmount:'50000000',direction:'BUY',outAmount:'1000000',sourceAt:NOW.toISOString()});
 expect(calls).toEqual([{inputMint:USDC_MINT,outputMint:MINT,amount:50_000_000n,slippageBps:50}]);
 expect(store.rows.get(`${TRADEABILITY_PREFIX}${MINT}`)).toMatchObject({mint:MINT,sourceAt:NOW.toISOString()});
 expect(await s.get(MINT,new Date(+NOW+60_000))).toEqual(first);
 expect(calls).toHaveLength(1);
});

it('stops at the per-run budget and resets on begin without inventing a quote',async()=>{
 const store=db();
 const {s,calls}=source({db:store.client,maxPerRun:2});
 const a=await s.get(MINT,NOW),b=await s.get(MINT.replace('13','14'),NOW),c=await s.get(MINT.replace('13','15'),NOW);
 expect(a).not.toBeNull();expect(b).not.toBeNull();expect(c).toBeNull();expect(calls).toHaveLength(2);
 s.begin();
 expect(await s.get(MINT.replace('13','15'),NOW)).not.toBeNull();expect(calls).toHaveLength(3);
});

it('rejects failed, mismatched or out-of-range quotes and keeps no cache row',async()=>{
 for(const getQuote of [async():Promise<Quote>=>{throw Error('provider down');},async()=>quote({outputMint:MINT.replace('13','99')}),async()=>quote({priceImpactPct:101}),async()=>quote({priceImpactPct:-1})]){
  const store=db(),{s}=source({db:store.client,getQuote});
  expect(await s.get(MINT,NOW)).toBeNull();expect(store.rows.size).toBe(0);
 }
 const store=db(),{s}=source({db:store.client,getQuote:async()=>quote({priceImpactPct:0})});
 expect(await s.get(MINT,NOW)).toMatchObject({priceImpactPct:0});
});

it('ignores stale or foreign-mint cache entries and never quotes an unpriced ticket',async()=>{
 const store=db(),key=`${TRADEABILITY_PREFIX}${MINT}`;
 store.rows.set(key,testTradeability(MINT,new Date(+NOW-11*60_000),0.1));
 const {s,calls}=source({db:store.client});
 expect((await s.get(MINT,NOW))?.priceImpactPct).toBe(1.5);
 expect(calls).toHaveLength(1);
 store.rows.set(key,testTradeability(MINT.replace('13','77'),NOW,0.1));
 expect((await s.get(MINT,NOW))?.priceImpactPct).toBe(1.5);
 expect(calls).toHaveLength(2);
 const invalid=source({db:db().client});
 expect(await invalid.s.get('not-a-mint',NOW)).toBeNull();
 expect(await invalid.s.get(USDC_MINT,NOW)).toBeNull();
 expect(invalid.calls).toHaveLength(0);
});

it('shares one in-flight request and can be disabled without a source',async()=>{
 const store=db();
 let resolve:(q:Quote)=>void=()=>{};
 const {s,calls}=source({db:store.client,getQuote:()=>new Promise<Quote>(r=>{resolve=r;})});
 const p1=s.get(MINT,NOW),p2=s.get(MINT,NOW);
 await new Promise(r=>setTimeout(r,20));
 resolve(quote());
 expect(await p1).not.toBeNull();expect(await p2).not.toBeNull();expect(calls).toHaveLength(1);
 expect(makeTradeabilitySource(store.client,{enabled:false})).toBeNull();
 process.env.RADAR_SAFETY_MODE='off';
 expect(makeTradeabilitySource(store.client)).toBeNull();
});

it.each([
 {inAmount:'1'},{outAmount:'0'},{outAmount:'bad'},{otherAmountThreshold:null},
 {otherAmountThreshold:'1000001'},{slippageBps:500},{raw:{routePlan:[]}},
 {raw:{routePlan:[{}]}},{fetchedAt:new Date(+NOW+1)},{fetchedAt:new Date(+NOW-11*60_000)},
])('rejects invalid quote provenance %j',async(over)=>{
 const store=db(),{s}=source({db:store.client,getQuote:async()=>quote(over)});
 expect(await s.get(MINT,NOW)).toBeNull();expect(store.rows.size).toBe(0);
});

it('replaces legacy impact-only caches with validated provenance using the response timestamp',async()=>{
 const store=db();store.rows.set(`${TRADEABILITY_PREFIX}${MINT}`,{mint:MINT,source:'jupiter',sourceAt:NOW.toISOString(),ticketUsd:50,priceImpactPct:0});
 const fetchedAt=new Date(+NOW-1000),{s,calls}=source({db:store.client,getQuote:async()=>quote({fetchedAt})});
 expect(await s.get(MINT,NOW)).toMatchObject({version:1,sourceAt:fetchedAt.toISOString(),inAmount:'50000000'});
 expect(calls).toHaveLength(1);
});

it.each(['',' ', '-0.001', -0.001, 'Infinity', '1e999'])('rejects malformed impact %j through the real Jupiter parser without caching',async(priceImpactPct)=>{
 const store=db(),q=quote();
 const client=new JupiterClient({now:()=>NOW,fetch:async()=>new Response(JSON.stringify({...q,...q.raw as object,priceImpactPct}))});
 const s=makeTradeabilitySource(store.client,{quote:client,spacingMs:0})!;
 expect(await s.get(MINT,NOW)).toBeNull();expect(store.rows.size).toBe(0);
});

it('paces concurrent different mints and preserves spacing across scan boundaries',async()=>{
 vi.useFakeTimers();vi.setSystemTime(NOW);
 const starts:number[]=[],store=db();
 const s=makeTradeabilitySource(store.client,{spacingMs:500,quote:{getQuote:async req=>{
  starts.push(Date.now());return quote({outputMint:req.outputMint,fetchedAt:new Date()});
 }}})!;
 const pending=[s.get(MINT),s.get(MINT.replace('13','14')),s.get(MINT.replace('13','15'))];
 await vi.advanceTimersByTimeAsync(1000);
 expect((await Promise.all(pending)).every(Boolean)).toBe(true);
 expect(starts.map(at=>at-+NOW)).toEqual([0,500,1000]);
 s.begin();const next=s.get(MINT.replace('13','16'));
 await vi.advanceTimersByTimeAsync(500);expect(await next).not.toBeNull();
 expect(starts.map(at=>at-+NOW)).toEqual([0,500,1000,1500]);
});
