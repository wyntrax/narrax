import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createPrisma, Prisma, type PrismaClient } from '@narra/database';
import { snapshot } from '@narra/market-data';
import { assertTestDatabase } from '../../../scripts/test-database';
import { storeMarketSnapshot } from './marketSnapshot';
import { SOL_HISTORY_PREFIX } from './walletResearchEvidence';
import { reconcileWalletValuations } from './walletValuationRepair';

assertTestDatabase(new URL(process.env.DATABASE_URL??'invalid:'));
const db=createPrisma(),tag=randomUUID(),now=new Date('2060-01-01T12:00:00Z'),observed=new Date(+now-60000);
const address=`repair-${tag}`,tokens:string[]=[],keys:string[]=[],trades:string[]=[];
let walletId:string;
beforeAll(async()=>{
 walletId=(await db.trackedWallet.create({data:{address,source:'MANUAL',active:true}})).id;
 const key=`${SOL_HISTORY_PREFIX}${observed.toISOString()}`;keys.push(key);
 await db.systemSetting.create({data:{key,value:{priceUsd:150,at:observed.toISOString(),source:'dexscreener'}}});
 for(const kind of ['recover','future','fdv','stale','preserve','legacy']){
  const token=await db.token.create({data:{mint:`${tag}-${kind}`,name:kind,symbol:'TEST'}});tokens.push(token.id);
  const at=kind==='future'?new Date(+now+1000):kind==='stale'?new Date(+now-900001):observed;
  const metric=await db.$transaction(tx=>storeMarketSnapshot(tx,token.id,snapshot(token.mint,{marketCapUsd:85000,marketCapIsFdv:kind==='fdv'}),'dexscreener',at));
  keys.push(`research.market.${token.id}`,`research.marketMetric.${metric.id}`);
  if(kind==='recover')await db.tokenMetric.create({data:{tokenId:token.id,at:new Date(+now-1000),priceUsd:1,marketCapUsd:99999,liquidityUsd:20000,volume24hUsd:100}});
  const preserve=kind==='preserve';
  const row=await db.walletTrade.create({data:{walletId,tokenId:token.id,side:'BUY',amountSol:'1',tokenAmount:'10',at:now,signature:randomUUID(),
   amountUsd:preserve||kind==='legacy'?99:null,evidence:kind==='legacy'?Prisma.DbNull:{version:1,eventAt:now.toISOString(),market:null,sol:preserve?{priceUsd:99,at:observed.toISOString(),source:'original'}:null,reasons:['NO_CONTEMPORANEOUS_MARKET',...(preserve?[]:['NO_CONTEMPORANEOUS_SOL'])]}}});
  trades.push(row.id);
 }
});
it('does not overwrite a valuation written concurrently after the repair read',async()=>{
 const concurrent=await db.trackedWallet.create({data:{address:`${address}-concurrent`,source:'MANUAL',active:true}});
 const row=await db.walletTrade.create({data:{walletId:concurrent.id,tokenId:tokens[0]!,side:'BUY',amountSol:'1',at:now,signature:randomUUID()}});
 const raced={tokenMetric:db.tokenMetric,systemSetting:db.systemSetting,walletTrade:{
  findMany:db.walletTrade.findMany.bind(db.walletTrade),
  updateMany:async(args:Prisma.WalletTradeUpdateManyArgs)=>{
   await db.walletTrade.update({where:{id:row.id},data:{amountUsd:123}});
   return db.walletTrade.updateMany(args);
  },
 }} as unknown as PrismaClient;
 try{
  expect(await reconcileWalletValuations(raced,now,{wallet:concurrent.address,apply:true})).toMatchObject({conflicts:1,applied:0});
  const saved=await db.walletTrade.findUniqueOrThrow({where:{id:row.id}});
  expect(Number(saved.amountUsd)).toBe(123);expect(saved.marketCapUsd).toBeNull();expect(saved.evidence).toBeNull();
 }finally{await db.trackedWallet.delete({where:{id:concurrent.id}});}
});
afterAll(async()=>{
 await db.trackedWallet.deleteMany({where:{id:walletId}});
 await db.systemSetting.deleteMany({where:{key:{in:keys}}});
 await db.token.deleteMany({where:{id:{in:tokens}}});await db.$disconnect();
});
it('previews bounded pages without writes, then repairs only missing contemporaneous values idempotently',async()=>{
 const before=await db.walletTrade.findMany({where:{walletId},orderBy:{id:'asc'}});
 const preview=await reconcileWalletValuations(db,now,{wallet:address});
 expect(preview).toMatchObject({scanned:6,changed:5,applied:0,recoverableCaps:2,legacySkipped:1});
 expect(await db.walletTrade.findMany({where:{walletId},orderBy:{id:'asc'}})).toEqual(before);
 const page=await reconcileWalletValuations(db,now,{wallet:address,limit:2});
 expect(page.nextCursor).toBeTruthy();
 expect((await reconcileWalletValuations(db,now,{wallet:address,after:page.nextCursor!,limit:2})).scanned).toBe(2);
 expect(await reconcileWalletValuations(db,now,{wallet:address,apply:true})).toMatchObject({applied:5,conflicts:0});
 const rows=await Promise.all(trades.map(id=>db.walletTrade.findUniqueOrThrow({where:{id}})));
 expect(Number(rows[0]!.marketCapUsd)).toBe(85000);expect(Number(rows[0]!.amountUsd)).toBe(150);
 for(const i of [1,2,3])expect(rows[i]!.marketCapUsd).toBeNull();
 expect(rows[1]!.evidence).toMatchObject({reasons:expect.arrayContaining(['TRADE_BEFORE_MARKET_HISTORY'])});
 expect(rows[2]!.evidence).toMatchObject({reasons:['FDV_ONLY']});
 expect(rows[3]!.evidence).toMatchObject({reasons:expect.arrayContaining(['NO_MARKET_IN_WINDOW'])});
 expect(Number(rows[4]!.amountUsd)).toBe(99);expect(rows[4]!.evidence).toMatchObject({sol:{source:'original',priceUsd:99}});
 expect(rows[5]!.evidence).toBeNull();
 expect(await reconcileWalletValuations(db,now,{wallet:address,apply:true})).toMatchObject({changed:0,applied:0,legacySkipped:1});
});
