import {it,expect,vi} from 'vitest';
import type {PrismaClient} from '@narra/database';
import {walletTradeEvidence,SOL_HISTORY_PREFIX} from './walletResearchEvidence';
const at=new Date('2026-10-26T02:00:00Z');
it('recovers delayed trade USD from a pre-trade SOL observation without inventing entry cap',async()=>{
 const observed=new Date(+at-60000).toISOString();
 const db={tokenMetric:{findFirst:async()=>null},systemSetting:{findUnique:async()=>({value:{priceUsd:999,at:new Date(+at+60000).toISOString(),source:'dexscreener'}}),findFirst:vi.fn(async()=>({key:`${SOL_HISTORY_PREFIX}${observed}`,value:{priceUsd:150,at:observed,source:'dexscreener'}}))}};
 expect(await walletTradeEvidence(db as unknown as PrismaClient,'token',at,.00002)).toMatchObject({amountUsd:.003,marketCapUsd:null,evidence:{sol:{priceUsd:150},reasons:['NO_CONTEMPORANEOUS_MARKET']}});
});
it('never uses later or stale SOL observations for historical valuation',async()=>{
 for(const offset of [1,-16*60000]){
  const observed=new Date(+at+offset).toISOString();
  const db={tokenMetric:{findFirst:async()=>null},systemSetting:{findUnique:async()=>null,findFirst:async()=>({key:`${SOL_HISTORY_PREFIX}${observed}`,value:{priceUsd:150,at:observed,source:'dexscreener'}})}};
  expect((await walletTradeEvidence(db as unknown as PrismaClient,'token',at,1)).amountUsd).toBeNull();
 }
});
