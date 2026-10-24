import {it,expect,vi} from 'vitest';
import type {PrismaClient} from '@narra/database';
import {tokenHistory} from './tokenHistory';
const NOW=new Date('2026-10-18T12:00:00Z');
const row=(id:string,minutes:number)=>({id,at:new Date(+NOW-minutes*60000),priceUsd:'0.01'});
const proof=(metric:ReturnType<typeof row>,patch:Record<string,unknown>={})=>({key:`research.marketMetric.${metric.id}`,value:{metricId:metric.id,at:metric.at.toISOString(),source:'dexscreener',marketCapIsFdv:false,priceChange1hPct:null,pairAddress:'pool',dexId:null,pairCreatedAt:null,...patch}});
it('excludes unverified/mismatched records and preserves exact chronological samples',async()=>{
 const rows=[row('new',1),row('wrong-time',2),row('unverified',3),row('old',4)];
 const db={tokenMetric:{findMany:vi.fn(async()=>rows)},systemSetting:{findMany:vi.fn(async()=>[proof(rows[0]!),proof(rows[1]!,{at:NOW.toISOString()}),proof(rows[3]!)])}};
 const result=await tokenHistory(db as unknown as PrismaClient,'token','1h',NOW);
 expect(result.points.map(p=>p.at)).toEqual([rows[3]!.at.toISOString(),rows[0]!.at.toISOString()]);
 expect(result.excludedUnverified).toBe(2);
 expect(db.tokenMetric.findMany).toHaveBeenCalledWith(expect.objectContaining({take:501,where:{tokenId:'token',at:{gte:new Date(+NOW-3600000),lte:NOW}}}));
});
it('accepts the existing latest-record proof without claiming other legacy readings',async()=>{
 const newest=row('new',1),older=row('old',2);
 const db={tokenMetric:{findMany:async()=>[newest,older]},systemSetting:{findMany:async()=>[{...proof(newest),key:'research.market.token'}]}};
 expect((await tokenHistory(db as unknown as PrismaClient,'token','24h',NOW)).points).toHaveLength(1);
});
it('caps the scan and reports truncation without inventing samples',async()=>{
 const db={tokenMetric:{findMany:async()=>Array.from({length:501},(_,i)=>row(String(i),i))},systemSetting:{findMany:async()=>[]}};
 const result=await tokenHistory(db as unknown as PrismaClient,'token','7d',NOW);
 expect(result).toMatchObject({points:[],truncated:true,excludedUnverified:500});
});
