import {it,expect,vi} from 'vitest';
import type {PrismaClient} from '@narra/database';
import {walletTradeEvidence,walletMarketLookup,SOL_HISTORY_PREFIX} from './walletResearchEvidence';
const at=new Date('2026-10-26T02:00:00Z');
it('recovers delayed trade USD from a pre-trade SOL observation without inventing entry cap',async()=>{
 const observed=new Date(+at-60000).toISOString();
 const db={tokenMetric:{findFirst:async()=>null},systemSetting:{findUnique:async()=>({value:{priceUsd:999,at:new Date(+at+60000).toISOString(),source:'dexscreener'}}),findFirst:vi.fn(async()=>({key:`${SOL_HISTORY_PREFIX}${observed}`,value:{priceUsd:150,at:observed,source:'dexscreener'}}))}};
 expect(await walletTradeEvidence(db as unknown as PrismaClient,'token',at,.00002)).toMatchObject({amountUsd:.003,marketCapUsd:null,evidence:{sol:{priceUsd:150},reasons:['NO_CONTEMPORANEOUS_MARKET','NO_TOKEN_MARKET_HISTORY']}});
});
it('falls back past an unprovenanced latest row but only inside the pre-trade window',async()=>{
 const rows=[{id:'bad',at:new Date(+at-1000),priceUsd:1,marketCapUsd:90000,liquidityUsd:20000},{id:'good',at:new Date(+at-60000),priceUsd:1,marketCapUsd:85000,liquidityUsd:20000}];
 const findFirst=vi.fn(async(args:{where:{id:{notIn:string[]};at:{gte:Date;lte:Date}}})=>{
  expect(args.where.at).toEqual({gte:new Date(+at-900000),lte:at});
  return rows.find(r=>!args.where.id.notIn.includes(r.id))??null;
 });
 const db={tokenMetric:{findFirst},systemSetting:{findUnique:async({where}:{where:{key:string}})=>where.key.endsWith('.good')?{value:{metricId:'good',at:rows[1]!.at.toISOString(),source:'dexscreener',marketCapIsFdv:false,pairAddress:'pair'}}:null}};
 expect(await walletMarketLookup(db as unknown as PrismaClient,'token',at)).toMatchObject({market:{metricId:'good',marketCapUsd:85000},reason:null});
 expect(findFirst).toHaveBeenCalledTimes(2);
});
it('distinguishes first-coverage gaps from stale history',async()=>{
 for(const [first,reason] of [[null,'NO_TOKEN_MARKET_HISTORY'],[{at:new Date(+at+1)},'TRADE_BEFORE_MARKET_HISTORY'],[{at:new Date(+at-900001)},'NO_MARKET_IN_WINDOW']] as const){
  const db={tokenMetric:{findFirst:vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(first)}};
  expect(await walletMarketLookup(db as unknown as PrismaClient,'token',at)).toEqual({market:null,reason});
 }
});
it('never uses later or stale SOL observations for historical valuation',async()=>{
 for(const offset of [1,-16*60000]){
  const observed=new Date(+at+offset).toISOString();
  const db={tokenMetric:{findFirst:async()=>null},systemSetting:{findUnique:async()=>null,findFirst:async()=>({key:`${SOL_HISTORY_PREFIX}${observed}`,value:{priceUsd:150,at:observed,source:'dexscreener'}})}};
  expect((await walletTradeEvidence(db as unknown as PrismaClient,'token',at,1)).amountUsd).toBeNull();
 }
});
