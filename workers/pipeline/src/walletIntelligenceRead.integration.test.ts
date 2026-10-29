import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {createPrisma,type PrismaClient} from '@narra/database';
import {assertTestDatabase} from '../../../scripts/test-database';
import {readIntelligenceInputs,INTELLIGENCE_READ_PAGE_SIZE} from './walletIntelligenceRead';

assertTestDatabase(new URL(process.env.DATABASE_URL!));
const db=createPrisma(),tag=`paged-${randomUUID()}`,from=new Date('2071-01-01T00:00:00Z'),to=new Date(+from+60000);
let walletId:string,inactiveId:string,tokenId:string;
beforeAll(async()=>{
 walletId=(await db.trackedWallet.create({data:{address:tag}})).id;
 inactiveId=(await db.trackedWallet.create({data:{address:tag+'inactive',active:false}})).id;
 tokenId=(await db.token.create({data:{mint:tag,name:tag,symbol:'PAGE'}})).id;
 const rows=Array.from({length:INTELLIGENCE_READ_PAGE_SIZE*2+3},(_,i)=>({id:`${tag}-${String(i).padStart(5,'0')}`,walletId,tokenId,side:'BUY' as const,signature:`${tag}-${i}`,amountSol:'0.123456789',tokenAmount:'1.000000001',marketCapUsd:null,at:new Date(+from+(i<2001?0:1000)),evidence:{eventAt:from.toISOString(),market:null}}));
 await db.walletTrade.createMany({data:rows});
 await db.walletTrade.createMany({data:[{walletId:inactiveId,tokenId,side:'BUY',signature:tag+'inactive',amountSol:1,at:from},{walletId,tokenId,side:'BUY',signature:tag+'future',amountSol:1,at:new Date(+to+1)}]});
});
afterAll(async()=>{await db.trackedWallet.deleteMany({where:{id:{in:[walletId,inactiveId]}}});await db.token.delete({where:{id:tokenId}});await db.$disconnect();});
it('reads every row once across tied timestamps and keeps a repeatable snapshot during concurrent backfill',async()=>{
 const baseline=await db.walletTrade.findMany({where:{walletId,at:{gte:from,lte:to}},orderBy:[{at:'asc'},{id:'asc'}],select:{id:true,amountSol:true,tokenAmount:true,evidence:true}});
 const pageSizes:number[]=[];let inserted=false;
 const wrapped=new Proxy(db,{get(target,key){
  if(key==='$transaction')return (fn:(tx:unknown)=>unknown,opts:unknown)=>target.$transaction(async tx=>fn(new Proxy(tx,{get(t,k){
   if(k==='walletTrade')return {findMany:async(args:Parameters<typeof db.walletTrade.findMany>[0])=>{
    const rows=await t.walletTrade.findMany(args);pageSizes.push(rows.length);
    if(!inserted){inserted=true;await db.walletTrade.create({data:{walletId,tokenId,side:'BUY',signature:tag+'backfill',amountSol:1,at:to}});}
    return rows;
   }};
   return Reflect.get(t,k);
  }})),opts as never);
  return Reflect.get(target,key);
 }});
 const result=await readIntelligenceInputs(wrapped as PrismaClient,from,to);
 expect(result.pages).toBe(3);expect(pageSizes).toEqual([2000,2000,3]);
 expect(result.rows.map(r=>({id:r.id,amountSol:r.amountSol,tokenAmount:r.tokenAmount,evidence:r.evidence}))).toEqual(baseline);
 expect(result.wallets.some(w=>w.id===inactiveId)).toBe(false);
 expect(await db.walletTrade.count({where:{walletId,at:{gte:from,lte:to}}})).toBe(baseline.length+1);
});
