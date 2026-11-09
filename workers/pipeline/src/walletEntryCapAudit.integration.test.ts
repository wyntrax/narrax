import { randomBytes, randomUUID } from 'node:crypto';
import bs58 from 'bs58';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createPrisma, Prisma } from '@narra/database';
import { assertTestDatabase } from '../../../scripts/test-database';
import { readEntryCapCoverageAudit } from './walletEntryCapAudit';
import { reconcileWalletValuations } from './walletValuationRepair';

const url=new URL(process.env.DATABASE_URL??'invalid:');assertTestDatabase(url);
const db=createPrisma(url.toString());url.searchParams.set('options','-c default_transaction_read_only=on -c statement_timeout=20000');
const reader=createPrisma(url.toString()),tag=randomUUID(),now=new Date('2065-01-01T12:00:00Z');
const prefix=`zzzz-entry-audit-${tag}`,address=bs58.encode(randomBytes(32)),walletId=`${prefix}-1`;
const tokens:string[]=[],keys:string[]=[],walletIds:string[]=[];
beforeAll(async()=>{
  await db.trackedWallet.create({data:{id:walletId,address,source:'MANUAL',active:true}});walletIds.push(walletId);
  for(const kind of ['recover','boundary','fallback','future','stale','fdv','invalid','existing','legacy','known','contaminated']){
    const token=await db.token.create({data:{mint:`${tag}-${kind}`,symbol:'AUDIT',name:kind}});tokens.push(token.id);
    const at=new Date(+now-(kind==='boundary'?900000:kind==='stale'?900001:kind==='future'?-1:60000));
    const metric=await db.tokenMetric.create({data:{tokenId:token.id,at,priceUsd:1,marketCapUsd:85000,liquidityUsd:10000,volume24hUsd:100}});
    if(kind!=='invalid'){
      const key=`research.marketMetric.${metric.id}`;keys.push(key);
      await db.systemSetting.create({data:{key,value:{metricId:metric.id,at:at.toISOString(),source:'dexscreener',marketCapIsFdv:kind==='fdv',pairAddress:'pair'}}});
    }
    if(kind==='fallback')await db.tokenMetric.create({data:{tokenId:token.id,at:new Date(+now-1000),priceUsd:1,marketCapUsd:90000,liquidityUsd:10000,volume24hUsd:100}});
    const known=kind==='known';
    await db.walletTrade.create({data:{id:`${prefix}-${kind}-buy`,walletId,tokenId:token.id,side:'BUY',amountSol:1,tokenAmount:1,at:now,signature:randomUUID(),
      marketCapUsd:known||kind==='existing'?85000:null,amountUsd:kind==='legacy'?99:null,
      evidence:known?{eventAt:now.toISOString(),market:{at:at.toISOString(),source:'dexscreener',marketCapIsFdv:false}}:Prisma.DbNull}});
    await db.walletTrade.create({data:{walletId,tokenId:token.id,side:'SELL',amountSol:2,tokenAmount:kind==='contaminated'?2:1,
      at:now,signature:randomUUID(),id:`${prefix}-${kind}-sell`}});
  }
  for(const [suffix,active,researchReview] of [['2',false,'PROVISIONAL'],['3',true,'REJECTED'],['4',true,'PROVISIONAL'],['5',true,'PROVISIONAL']] as const){
    const id=`${prefix}-${suffix}`;walletIds.push(id);
    await db.trackedWallet.create({data:{id,address:bs58.encode(randomBytes(32)),active,researchReview}});
  }
});
afterAll(async()=>{
  await db.trackedWallet.deleteMany({where:{id:{in:walletIds}}});
  await db.systemSetting.deleteMany({where:{key:{in:keys}}});await db.token.deleteMany({where:{id:{in:tokens}}});
  await reader.$disconnect();await db.$disconnect();
});
it('uses stored pre-trade provenance, retains unknown reasons and changes no rows under DB read-only enforcement',async()=>{
  const before=await db.walletTrade.findMany({where:{walletId},orderBy:{id:'asc'}});
  const settingsBefore=await db.systemSetting.findMany({where:{key:{in:keys}},orderBy:{key:'asc'}});
  const r=await readEntryCapCoverageAudit(reader,now,{wallet:address});
  expect(r.summary).toMatchObject({positions:10,knownBefore:1,unknownBefore:9,recoverablePositions:3,recoverableClosedPositions:3,knownAfterPreview:4,unknownAfterPreview:6,
    unknownEntryReasons:{RECOVERABLE:3,TRADE_BEFORE_MARKET_HISTORY:1,NO_MARKET_IN_WINDOW:1,FDV_ONLY:1,INVALID_MARKET_PROVENANCE:1,EXISTING_CAP_NOT_REPAIRABLE:1,LEGACY_VALUATION_GUARD:1}});
  expect(r.items[0]?.recoveries.every(x=>x.observedAt<=x.tradeAt)).toBe(true);
  expect(r.items[0]?.knownClosedPositionGain).toBe(3);
  expect(await db.walletTrade.findMany({where:{walletId},orderBy:{id:'asc'}})).toEqual(before);
  expect(await db.systemSetting.findMany({where:{key:{in:keys}},orderBy:{key:'asc'}})).toEqual(settingsBefore);
  expect(r.lookup.queries).toBeLessThanOrEqual(r.lookup.queryLimit);
});
it('matches the existing reconciliation preview for each recoverable entry',async()=>{
  const r=await readEntryCapCoverageAudit(reader,now,{wallet:address});
  for(const recovery of r.items[0]!.recoveries){
    // Entry IDs end in -buy; the previous ASCII key selects that exact first row.
    const after=recovery.entryTradeId.slice(0,-1)+'x';
    const preview=await reconcileWalletValuations(reader,now,{wallet:address,after,limit:1});
    expect(preview).toMatchObject({scanned:1,recoverableCaps:1,applied:0});
  }
});
it('paginates wallets by ID and excludes inactive and rejected identities',async()=>{
  const page=await readEntryCapCoverageAudit(reader,now,{afterWallet:walletId,walletLimit:1});
  expect(page.items[0]?.walletId).toBe(`${prefix}-4`);
  expect(page.walletPage).toMatchObject({hasMore:true,nextWalletCursor:`${prefix}-4`});
  const next=await readEntryCapCoverageAudit(reader,now,{afterWallet:page.walletPage.nextWalletCursor!,walletLimit:1});
  expect(next.items[0]?.walletId).toBe(`${prefix}-5`);
});
it('refuses a writable connection before reading candidate trades',async()=>{
  await expect(readEntryCapCoverageAudit(db,now,{wallet:address})).rejects.toThrow('requires a read-only connection');
});
