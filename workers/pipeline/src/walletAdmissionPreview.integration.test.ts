import { randomBytes, randomUUID } from 'node:crypto';
import bs58 from 'bs58';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createPrisma, Prisma } from '@narra/database';
import { assertTestDatabase } from '../../../scripts/test-database';
import { readWalletAdmissionPreview } from './walletAdmissionPreviewRead';

const url=new URL(process.env.DATABASE_URL??'invalid:');assertTestDatabase(url);
const db=createPrisma(url.toString());url.searchParams.set('options','-c default_transaction_read_only=on -c statement_timeout=20000');const reader=createPrisma(url.toString());
const key='wallet.discovery.emerging',tag=randomUUID(),now=new Date('2040-01-01T12:00:00Z');
const addresses=Array.from({length:6},()=>bs58.encode(randomBytes(32)));
let saved:Awaited<ReturnType<typeof db.systemSetting.findUnique>>,beforeCount=0;
beforeAll(async()=>{
 saved=await db.systemSetting.findUnique({where:{key}});
 beforeCount=await db.trackedWallet.count({where:{source:'DISCOVERED',active:true,researchReview:{not:'REJECTED'}}});
 await db.trackedWallet.createMany({data:[
  {address:addresses[0]!,label:tag,source:'DISCOVERED',active:true,researchReview:'PROVISIONAL'},
  {address:addresses[1]!,label:tag,source:'DISCOVERED',active:false,researchReview:'PROVISIONAL'},
  {address:addresses[2]!,label:tag,source:'MANUAL',active:true,researchReview:'APPROVED'},
 ]});
 await db.walletCandidate.create({data:{address:addresses[3]!,status:'REJECTED',score:1,winnerTokens:0}});
 const items=addresses.map(address=>({address,scannedTokens:2,spend:{version:1,observedTokens:2,matchedTokens:2,unknownTokens:0,medianMatchedQuoteSol:'0.01',unknownReasons:{}}}));
 const value={checkedAt:now.toISOString(),total:items.length,capped:false,items};
 await db.systemSetting.upsert({where:{key},create:{key,value},update:{value}});
});
afterAll(async()=>{
 if(saved)await db.systemSetting.upsert({where:{key},create:{...saved,value:saved.value??Prisma.JsonNull},update:{value:saved.value??Prisma.JsonNull,updatedAt:saved.updatedAt}});
 else await db.systemSetting.deleteMany({where:{key}});
 await db.trackedWallet.deleteMany({where:{address:{in:addresses}}});await db.walletCandidate.deleteMany({where:{address:{in:addresses}}});
 await reader.$disconnect();await db.$disconnect();
});
it('reads a consistent preview under DB-enforced read-only mode, without changing tracked wallets or settings',async()=>{
 const before=await db.systemSetting.findUniqueOrThrow({where:{key}});
 const trackedBefore=await db.trackedWallet.findMany({where:{address:{in:addresses}},orderBy:{address:'asc'}});
 const r=await readWalletAdmissionPreview(reader,now,{explorationSlots:0});
 expect(r.readOnly).toBe(true);expect(r.capacity.occupied).toBe(beforeCount+1);
 expect(r.items.slice(0,3).every(w=>w.exclusions.includes('ALREADY_TRACKED'))).toBe(true);
 expect(r.items[3]?.exclusions).toContain('REJECTED');
 expect(r.proposal.assumingFreeSlots.slice().sort()).toEqual(addresses.slice(4).sort());
 expect(r.incumbentSummary.missingOrInvalidPerformance).toBeGreaterThanOrEqual(1);
 expect(await db.systemSetting.findUniqueOrThrow({where:{key}})).toEqual(before);
 expect(await db.trackedWallet.findMany({where:{address:{in:addresses}},orderBy:{address:'asc'}})).toEqual(trackedBefore);
 expect(await db.trackedWallet.count({where:{address:{in:addresses.slice(4)}}})).toBe(0);
});
it('refuses a read-write database connection before generating a plan',async()=>{
 await expect(readWalletAdmissionPreview(db,now)).rejects.toThrow('requires a read-only connection');
});
