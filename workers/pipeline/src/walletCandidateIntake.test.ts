import { expect, it, vi } from 'vitest';
import type { PrismaClient } from '@narra/database';
import { intakeEmergingWallets, reactivateProvenWallets } from './walletCandidateIntake';

const now=new Date('2040-01-01T00:00:00Z');
const addresses=['So11111111111111111111111111111111111111112','11111111111111111111111111111111'];
function fixture(count:number,tracked:string[]=[],rejected:string[]=[]){
 const createMany=vi.fn(async(_args:unknown)=>({count:1})),upsert=vi.fn(async()=>({}));
 const tx={
  $executeRaw:vi.fn(async()=>0),systemSetting:{findUnique:async()=>({value:{checkedAt:now.toISOString(),items:addresses.map(address=>({address,scannedTokens:3}))}}),upsert},
  trackedWallet:{count:async()=>count,findMany:async()=>tracked.map(address=>({address})),createMany},
  walletCandidate:{findMany:async()=>rejected.map(address=>({address}))},
 };
 const db={$transaction:async(fn:(tx:unknown)=>unknown)=>fn(tx)} as unknown as PrismaClient;
 return {db,createMany,upsert};
}
it('respects remaining capacity and stops admission at the discovered-wallet cap',async()=>{
 const last=fixture(199);expect(await intakeEmergingWallets(last.db,now)).toMatchObject({capacity:1,added:1});
 expect(last.createMany.mock.calls[0]?.[0]).toMatchObject({data:[{address:addresses[0],researchReview:'PROVISIONAL'}]});
 const full=fixture(200);expect(await intakeEmergingWallets(full.db,now)).toMatchObject({reason:'CAPACITY_REACHED',added:0});expect(full.createMany).not.toHaveBeenCalled();
});
it('does not reactivate existing tracked addresses or bypass a rejected candidate',async()=>{
 const f=fixture(0,[addresses[0]!],[addresses[1]!]);expect(await intakeEmergingWallets(f.db,now)).toMatchObject({added:0});expect(f.createMany).not.toHaveBeenCalled();
});
it('evicts stale low-score PROVISIONAL wallets when capacity is full and new candidates await admission',async()=>{
 const createMany=vi.fn(async(args:{data:unknown[]})=>({count:args.data.length}));
 const updateMany=vi.fn(async(args:{where:{id:{in:string[]}}})=>({count:args.where.id.in.length}));
 const upsert=vi.fn(async()=>({}));
 let findCalls=0;
 const tx={
  $executeRaw:vi.fn(async()=>0),
  systemSetting:{findUnique:async()=>({value:{checkedAt:now.toISOString(),items:addresses.map(address=>({address,scannedTokens:3}))}}),upsert},
  trackedWallet:{
   count:async()=>200,
   findMany:async()=>{findCalls++;return findCalls===1?[]:[{id:'stale-low',profile:{score:22}},{id:'stale-unscored',profile:null}];},
   updateMany,
   createMany,
  },
  walletCandidate:{findMany:async()=>[]},
 };
 const db={$transaction:async(fn:(tx:unknown)=>unknown)=>fn(tx)} as unknown as PrismaClient;
 const res=await intakeEmergingWallets(db,now);
 expect(res).toMatchObject({evicted:2,capacity:2,added:2,reason:'EVALUATION_ONLY'});
 expect(updateMany).toHaveBeenCalledWith({where:{id:{in:['stale-unscored','stale-low']}},data:{active:false}});
 expect(createMany).toHaveBeenCalledTimes(1);
});
it('skips confirmed micro-dust bots with matched median quote below 0.01 SOL while keeping unmeasured or larger candidates',async()=>{
 const createMany=vi.fn(async(args:{data:{address:string}[]})=>({count:args.data.length}));
 const upsert=vi.fn(async()=>({}));
 const tx={
  $executeRaw:vi.fn(async()=>0),
  systemSetting:{findUnique:async()=>({value:{checkedAt:now.toISOString(),items:[
   {address:addresses[0],scannedTokens:4,spend:{matchedTokens:3,medianMatchedQuoteSol:0.00005}},
   {address:addresses[1],scannedTokens:4,spend:{matchedTokens:3,medianMatchedQuoteSol:0.25}},
  ]}}),upsert},
  trackedWallet:{count:async()=>0,findMany:async()=>[],createMany},
  walletCandidate:{findMany:async()=>[]},
 };
 const db={$transaction:async(fn:(tx:unknown)=>unknown)=>fn(tx)} as unknown as PrismaClient;
 const res=await intakeEmergingWallets(db,now);
 expect(res).toMatchObject({added:1,considered:1});
 expect(createMany.mock.calls[0]?.[0].data.map(w=>w.address)).toEqual([addresses[1]]);
});
it('accepts the stored decimal-string spend evidence and still removes dust',async()=>{
 const createMany=vi.fn(async(args:{data:{address:string}[]})=>({count:args.data.length}));
 const upsert=vi.fn(async()=>({}));
 const tx={
  $executeRaw:vi.fn(async()=>0),
  systemSetting:{findUnique:async()=>({value:{checkedAt:now.toISOString(),items:[
   {address:addresses[0],scannedTokens:4,spend:{matchedTokens:3,medianMatchedQuoteSol:'0.00005'}},
   {address:addresses[1],scannedTokens:4,spend:{matchedTokens:3,medianMatchedQuoteSol:'0.25'}},
  ]}}),upsert},
  trackedWallet:{count:async()=>0,findMany:async()=>[],createMany},
  walletCandidate:{findMany:async()=>[]},
 };
 const db={$transaction:async(fn:(tx:unknown)=>unknown)=>fn(tx)} as unknown as PrismaClient;
 expect(await intakeEmergingWallets(db,now)).toMatchObject({added:1,considered:1});
 expect(createMany.mock.calls[0]?.[0].data.map(w=>w.address)).toEqual([addresses[1]]);
});
it('prefers an emerging candidate that still holds an observed early buy, even with fewer repeat tokens',async()=>{
 const createMany=vi.fn(async(args:{data:{address:string}[]})=>({count:args.data.length}));
 const upsert=vi.fn(async()=>({}));
 const tx={
  $executeRaw:vi.fn(async()=>0),
  systemSetting:{findUnique:async()=>({value:{checkedAt:now.toISOString(),items:[
   {address:addresses[0],scannedTokens:8},
   {address:addresses[1],scannedTokens:3,hold:{checkedAt:now.toISOString(),tokenId:'t',mint:'m',stillHolding:true,heldMs:3_600_000}},
  ]}}),upsert},
  trackedWallet:{count:async()=>0,findMany:async()=>[],createMany},
  walletCandidate:{findMany:async()=>[]},
 };
 const db={$transaction:async(fn:(tx:unknown)=>unknown)=>fn(tx)} as unknown as PrismaClient;
 expect(await intakeEmergingWallets(db,now)).toMatchObject({added:2});
 expect(createMany.mock.calls[0]?.[0].data.map(w=>w.address)).toEqual([addresses[1],addresses[0]]);
});
it('deprioritizes confirmed dumpers below unprobed candidates and evicts stale fast-exit provisional wallets',async()=>{
 const createMany=vi.fn(async(args:{data:{address:string}[]})=>({count:args.data.length}));
 const updateMany=vi.fn(async(args:{where:{id:{in:string[]}}})=>({count:args.where.id.in.length}));
 const upsert=vi.fn(async()=>({}));
 let findCalls=0;
 const tx={
  $executeRaw:vi.fn(async()=>0),
  systemSetting:{findUnique:async()=>({value:{checkedAt:now.toISOString(),items:[
   {address:addresses[0],scannedTokens:6,spend:{matchedTokens:3,medianMatchedQuoteSol:2.5},hold:{checkedAt:now.toISOString(),tokenId:'t',mint:'m',stillHolding:false,heldMs:null}},
   {address:addresses[1],scannedTokens:3,spend:{matchedTokens:3,medianMatchedQuoteSol:0.5}},
  ]}}),upsert},
  trackedWallet:{
   count:async()=>200,
   findMany:async()=>{findCalls++;return findCalls===1?[]:[{id:'stale-fast-exit',profile:{score:65,medianHoldSeconds:45}}];},
   updateMany,
   createMany,
  },
  walletCandidate:{findMany:async()=>[]},
 };
 const db={$transaction:async(fn:(tx:unknown)=>unknown)=>fn(tx)} as unknown as PrismaClient;
 expect(await intakeEmergingWallets(db,now)).toMatchObject({evicted:1,capacity:1,added:1});
 expect(updateMany).toHaveBeenCalledWith({where:{id:{in:['stale-fast-exit']}},data:{active:false}});
 expect(createMany.mock.calls[0]?.[0].data.map(w=>w.address)).toEqual([addresses[1]]);
});
it('protects a provisional wallet with a proven small-cap sample from stale-capacity eviction',async()=>{
 const createMany=vi.fn(async(args:{data:{address:string}[]})=>({count:args.data.length}));
 const updateMany=vi.fn(async(args:{where:{id:{in:string[]}}})=>({count:args.where.id.in.length}));
 const upsert=vi.fn(async()=>({}));
 let findCalls=0;
 const provenPerf={
  version:1,checkedAt:now.toISOString(),windowDays:30,observedTrades:100,invalidTrades:0,unmatchedSells:0,capped:false,lastTradeAt:now.toISOString(),
  bands:[{band:'SMALL_CAP',positions:9,closedPositions:9,closedTokens:9,wins:9,losses:0,breakeven:0,openPositions:0,winRate:1,winRateLowerBound:0.7,realisedPnlSol:'4.9',openCostSol:'0',medianRoi:0.06,medianWinSol:'0.5',medianLossSol:null,profitFactor:null,medianFirstSellSeconds:91,medianCloseSeconds:132,realisedDrawdownSol:'0',observedDays:29,fastCloseRate:0.11}],
 };
 const tx={
  $executeRaw:vi.fn(async()=>0),
  systemSetting:{
   findUnique:async()=>({value:{checkedAt:now.toISOString(),items:[{address:addresses[0],scannedTokens:3}]}}),
   findMany:async()=>[{key:'wallet.performance.protected-small-cap',value:provenPerf}],
   upsert,
  },
  trackedWallet:{
   count:async()=>200,
   findMany:async()=>{findCalls++;return findCalls===1?[]:[{id:'protected-small-cap',profile:{score:64,medianHoldSeconds:52}},{id:'evictable-fast-exit',profile:{score:65,medianHoldSeconds:45}}];},
   updateMany,
   createMany,
  },
  walletCandidate:{findMany:async()=>[]},
 };
 const db={$transaction:async(fn:(tx:unknown)=>unknown)=>fn(tx)} as unknown as PrismaClient;
 expect(await intakeEmergingWallets(db,now)).toMatchObject({evicted:1,capacity:1,added:1});
 expect(updateMany).toHaveBeenCalledWith({where:{id:{in:['evictable-fast-exit']}},data:{active:false}});
});
it('reactivates proven small-cap wallets strongest-first and releases stale non-proven wallets when full',async()=>{
 const updateMany=vi.fn(async(args:{where:{id:{in:string[]}};data:{active:boolean}})=>({count:args.where.id.in.length}));
 const upsert=vi.fn(async()=>({}));
 let findCalls=0;
 const proven=(winRateLowerBound:number)=>({
  version:1,checkedAt:now.toISOString(),windowDays:30,observedTrades:100,invalidTrades:0,unmatchedSells:0,capped:false,lastTradeAt:now.toISOString(),
  bands:[{band:'SMALL_CAP',positions:9,closedPositions:9,closedTokens:9,wins:9,losses:0,breakeven:0,openPositions:0,winRate:1,winRateLowerBound,realisedPnlSol:'4.9',openCostSol:'0',medianRoi:0.06,medianWinSol:'0.5',medianLossSol:null,profitFactor:null,medianFirstSellSeconds:91,medianCloseSeconds:132,realisedDrawdownSol:'0',observedDays:29,fastCloseRate:0.11}],
 });
 const tx={
  $executeRaw:vi.fn(async()=>0),
  systemSetting:{
   findMany:async(args:{where:{key:{in:string[]}}})=>args.where.key.in.some(k=>k.startsWith('wallet.performance.proven-'))
    ? [{key:'wallet.performance.proven-1',value:proven(0.7)},{key:'wallet.performance.proven-2',value:proven(0.6)}]
    : [],
   upsert,
  },
  trackedWallet:{
   count:async()=>200,
   findMany:async()=>{findCalls++;return findCalls===1
    ? [{id:'proven-1',address:addresses[0]},{id:'proven-2',address:addresses[1]}]
    : [{id:'stale-1',profile:{score:64,medianHoldSeconds:45}},{id:'stale-2',profile:{score:63,medianHoldSeconds:50}}];},
   updateMany,
  },
 };
 const db={$transaction:async(fn:(tx:unknown)=>unknown)=>fn(tx)} as unknown as PrismaClient;
 expect(await reactivateProvenWallets(db,now)).toMatchObject({evicted:2,reactivated:2,capacity:0,candidates:2});
 expect(updateMany).toHaveBeenNthCalledWith(1,{where:{id:{in:['stale-2','stale-1']}},data:{active:false}});
 expect(updateMany).toHaveBeenNthCalledWith(2,{where:{id:{in:['proven-1','proven-2']}},data:{active:true}});
 expect(upsert).toHaveBeenCalledWith(expect.objectContaining({where:{key:'wallet.evaluation.reactivation'}}));
});
