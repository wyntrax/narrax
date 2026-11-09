import {randomUUID} from 'node:crypto';
import {afterAll,afterEach,expect,it,vi} from 'vitest';
import {createPrisma,Prisma} from '@narra/database';
import {assertTestDatabase} from '../../../scripts/test-database';
import {refreshResearchHistory,selectResearchHistoryWallets,HISTORY_ATTEMPT_PREFIX,HISTORY_RETRY_MS,HISTORY_REFRESH_MS} from './walletResearchHistory';
import {collectWalletHistory,type WalletHistoryOptions,WalletHistoryError} from './walletHistory';

assertTestDatabase(new URL(process.env.DATABASE_URL??'invalid:'));
const db=createPrisma(),tag=`history-fair-${randomUUID()}`;
// Predates other fixtures: only this cohort is eligible for scheduling at this clock.
const now=new Date('2001-01-01T12:00:00Z'),ids:string[]=[];
const setting=(key:string,value:Prisma.InputJsonValue,at:Date)=>db.systemSetting.upsert({where:{key},create:{key,value,updatedAt:at},update:{value,updatedAt:at}});
async function wallet(name:string,at=new Date(+now-3600000)){
 const w=await db.trackedWallet.create({data:{id:`${tag}-${name}`,address:`${tag}-${name}`,createdAt:at,active:true,source:'MANUAL'}});ids.push(w.id);return w;
}
const checkpoint=(at:Date,capped=true)=>({checkedAt:at.toISOString(),capped,nextBefore:capped?'old-cursor':null,
 scanFrom:new Date(+at-30*86400000).toISOString(),scanTo:at.toISOString(),coveredFrom:new Date(+at-30*86400000).toISOString(),coveredTo:at.toISOString(),scanned:300,accepted:250,skipped:0});
afterEach(async()=>{
 await db.systemSetting.deleteMany({where:{key:{in:ids.flatMap(id=>[`wallet.history.${id}`,HISTORY_ATTEMPT_PREFIX+id])}}});
 await db.trackedWallet.deleteMany({where:{id:{in:ids}}});ids.length=0;
});
afterAll(()=>db.$disconnect());

it('resumes old checkpoints under continuous two-wallet admission without exceeding the existing page budget',async()=>{
 const old=[await wallet('old-a'),await wallet('old-b')];
 for(const w of old)await setting(`wallet.history.${w.id}`,checkpoint(w.createdAt),w.createdAt);
 const collect=vi.fn(async(_address:string,opts:WalletHistoryOptions)=>({events:[],scanned:300,skipped:0,capped:true,
  nextBefore:`cursor-${collect.mock.calls.length}`,coveredFrom:(opts.since??new Date(+opts.now!-30*86400000)).toISOString(),coveredTo:opts.now!.toISOString(),
  pagesRead:3,searchHops:0,oldestObservedAt:new Date(+opts.now!-collect.mock.calls.length*60000).toISOString(),newestObservedAt:null,scannedThroughAt:new Date(+opts.now!-collect.mock.calls.length*60000).toISOString()}));
 for(let cycle=0;cycle<6;cycle++){
  const at=new Date(+now+cycle*HISTORY_RETRY_MS);
  await wallet(`new-${cycle}-a`,at);await wallet(`new-${cycle}-b`,at);
  const before=collect.mock.calls.length;
  const result=await refreshResearchHistory(db,'test-key',at,collect);
  expect(result).toMatchObject({scanned:2,failures:0,pagesRead:6});
  expect(collect.mock.calls.length-before).toBe(2);
 }
 expect(collect.mock.calls.slice(0,2).map(c=>c[0])).toEqual(old.map(w=>w.address));
 for(const w of old){
  const calls=collect.mock.calls.filter(c=>c[0]===w.address);
  expect(calls.length).toBeGreaterThanOrEqual(2);
  expect(calls[0]![1]).toMatchObject({before:'old-cursor',now:w.createdAt,maxPages:3});
  expect(calls[1]![1].before).toMatch(/^cursor-/);
  const h=(await db.systemSetting.findUniqueOrThrow({where:{key:`wallet.history.${w.id}`}})).value as Record<string,unknown>;
  expect(h.scanned).toBeGreaterThan(300);expect(h.verifiedCoveredFrom).toBeNull();expect(h.verifiedCoveredTo).toBeNull();
 }
 expect(collect.mock.calls.every(c=>c[1].maxPages===3)).toBe(true);
});

it('excludes cooling completed wallets before allocating slots and ignores inactive/rejected/future wallets',async()=>{
 const complete=await wallet('complete'),partial=await wallet('partial'),fresh=await wallet('fresh'),inactive=await wallet('inactive'),rejected=await wallet('rejected');
 await wallet('future',new Date(+now+60000));
 await db.trackedWallet.update({where:{id:inactive.id},data:{active:false}});
 await db.trackedWallet.update({where:{id:rejected.id},data:{researchReview:'REJECTED'}});
 await setting(`wallet.history.${complete.id}`,checkpoint(now,false),now);
 await setting(`wallet.history.${partial.id}`,checkpoint(new Date(+now-3600000)),new Date(+now-3600000));
 expect(new Set((await selectResearchHistoryWallets(db,now)).map(w=>w.id))).toEqual(new Set([partial.id,fresh.id]));
 await setting(HISTORY_ATTEMPT_PREFIX+partial.id,{status:'RUNNING'},now);
 await setting(HISTORY_ATTEMPT_PREFIX+fresh.id,{status:'FAILED'},now);
 expect(await selectResearchHistoryWallets(db,now)).toEqual([]);
 expect((await selectResearchHistoryWallets(db,new Date(+now+HISTORY_RETRY_MS))).some(w=>w.id===partial.id)).toBe(true);
 expect((await selectResearchHistoryWallets(db,new Date(+now+HISTORY_REFRESH_MS))).some(w=>w.id===complete.id)).toBe(true);
});

it('rotates failed and interrupted attempts, retains checkpoints, and exposes only safe error codes',async()=>{
 const failed=await wallet('a-failed'),other=await wallet('b-other');
 const old=checkpoint(failed.createdAt);await setting(`wallet.history.${failed.id}`,old,failed.createdAt);
 const collect=vi.fn().mockRejectedValueOnce(new WalletHistoryError('RATE_LIMITED',0,429)).mockRejectedValueOnce(new Error('secret-provider-url'));
 expect(await refreshResearchHistory(db,'test-key',now,collect)).toMatchObject({failures:2,scanned:0});
 expect((await db.systemSetting.findUniqueOrThrow({where:{key:`wallet.history.${failed.id}`}})).value).toEqual(old);
 const attempt=(await db.systemSetting.findUniqueOrThrow({where:{key:HISTORY_ATTEMPT_PREFIX+failed.id}})).value;
 expect(attempt).toMatchObject({status:'FAILED',errorCode:'RATE_LIMITED',httpStatus:429,consecutiveFailures:1});
 expect(await selectResearchHistoryWallets(db,new Date(+now+HISTORY_RETRY_MS-1))).toEqual([]);
 expect((await selectResearchHistoryWallets(db,new Date(+now+HISTORY_RETRY_MS))).map(w=>w.id)).toEqual([failed.id,other.id]);
 const newcomer=await wallet('c-new',new Date(+now+1));
 expect((await selectResearchHistoryWallets(db,new Date(+now+1000))).map(w=>w.id)).toEqual([newcomer.id]);
 expect(JSON.stringify(await db.systemSetting.findMany({where:{key:{in:ids.map(id=>HISTORY_ATTEMPT_PREFIX+id)}}}))).not.toContain('secret-provider-url');
});
it('persists search-only continuation as partial, then resumes it without claiming observed dates',async()=>{
 const w=await wallet('search-gap'),cursors=['2'.repeat(88),'3'.repeat(88),'4'.repeat(88)];
 const fetch=vi.fn();
 for(const cursor of cursors)fetch.mockResolvedValueOnce(new Response(JSON.stringify({error:`Failed to find events within the search period. To continue search, query the API again with the \`before-signature\` parameter set to ${cursor}.`}),{status:404}));
 const collect=(address:string,opts:WalletHistoryOptions)=>collectWalletHistory(address,{...opts,fetch});
 expect(await refreshResearchHistory(db,'test-key',now,collect)).toMatchObject({scanned:1,capped:1,failures:0,pagesRead:0,searchHops:3});
 const key=`wallet.history.${w.id}`;
 expect((await db.systemSetting.findUniqueOrThrow({where:{key}})).value).toMatchObject({capped:true,nextBefore:cursors[2],scanned:0,verifiedCoveredFrom:null,verifiedCoveredTo:null,oldestObservedAt:null,scannedThroughAt:null,searchHops:3});
 fetch.mockResolvedValueOnce(new Response('',{status:503}));
 expect(await refreshResearchHistory(db,'test-key',new Date(+now+HISTORY_RETRY_MS),collect)).toMatchObject({failures:1});
 expect((await db.systemSetting.findUniqueOrThrow({where:{key}})).value).toMatchObject({nextBefore:cursors[2],searchHops:3});
 fetch.mockResolvedValueOnce(new Response('[]'));
 expect(await refreshResearchHistory(db,'test-key',new Date(+now+2*HISTORY_RETRY_MS),collect)).toMatchObject({resumed:1,scanned:1,capped:0,failures:0});
 expect(new URL(String(fetch.mock.calls[4]![0])).searchParams.get('before')).toBe(cursors[2]);
 expect((await db.systemSetting.findUniqueOrThrow({where:{key}})).value).toMatchObject({capped:false,scanned:0,nextBefore:null,verifiedCoveredTo:now.toISOString(),scannedThroughAt:null,searchHops:3});
});
