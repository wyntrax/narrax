import { randomBytes, randomUUID } from 'node:crypto';
import bs58 from 'bs58';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createPrisma, Prisma } from '@narra/database';
import { WalletRankingPage } from '@narra/shared';
import { assertTestDatabase } from '../../../scripts/test-database';
import { intakeEmergingWallets, WALLET_INTAKE_KEY } from '../../../workers/pipeline/src/walletCandidateIntake';
import { recomputeWalletIntelligence } from '../../../workers/pipeline/src/walletIntelligence';
import { buildApp } from './app';

const target=new URL(process.env.DATABASE_URL??'invalid:');assertTestDatabase(target);
const db=createPrisma(target.toString()),tag=`ranking-${randomUUID()}`,now=new Date('2040-01-01T12:00:00Z');
const address=()=>bs58.encode(randomBytes(32)),a=address(),b=address(),rejected=address();
const keys=['wallet.discovery.emerging',WALLET_INTAKE_KEY,'entitlements.features'];
let saved:Awaited<ReturnType<typeof db.systemSetting.findMany>>=[],app:Awaited<ReturnType<typeof buildApp>>,walletId:string;
const users:string[]=[],tokenIds:string[]=[],ownKeys:string[]=[];
const setting=(key:string,value:Prisma.InputJsonValue)=>db.systemSetting.upsert({where:{key},create:{key,value},update:{value}});
beforeAll(async()=>{
 saved=await db.systemSetting.findMany({where:{key:{in:keys}}});
 await setting('entitlements.features',{});
 for(const role of ['admin','none','early']){
  const user=await db.user.create({data:{privyUserId:`${tag}-${role}`,isAdmin:role==='admin'}});users.push(user.id);
  if(role==='early'){
   await db.linkedWallet.create({data:{userId:user.id,chain:'solana',address:address(),verifiedAt:now}});
   await db.accessGrant.create({data:{userId:user.id,source:'EARLY_ACCESS',tier:'EARLY_ACCESS',status:'ACTIVE'}});
  }
 }
 await db.walletCandidate.create({data:{address:rejected,status:'REJECTED',score:20,winnerTokens:0}});
 await setting('wallet.discovery.emerging',{checkedAt:now.toISOString(),items:[{address:rejected,scannedTokens:6},{address:a,scannedTokens:4},{address:b,scannedTokens:3}]});
 app=await buildApp({account:{db,now:()=>now,verifier:{verify:async token=>({privyUserId:`${tag}-${token}`})}}});
},30000);
afterAll(async()=>{
 await app?.close();
 const wallets=await db.trackedWallet.findMany({where:{address:{in:[a,b,rejected]}},select:{id:true}});
 await db.systemSetting.deleteMany({where:{key:{in:[...keys,...ownKeys,...wallets.flatMap(w=>['performance','research','history','intelligence'].map(s=>`wallet.${s}.${w.id}`))]}}});
 for(const row of saved)await db.systemSetting.create({data:{...row,value:row.value===null?Prisma.JsonNull:row.value as Prisma.InputJsonValue}});
 await db.trackedWallet.deleteMany({where:{address:{in:[a,b,rejected]}}});
 await db.walletCandidate.deleteMany({where:{address:rejected}});
 await db.token.deleteMany({where:{id:{in:tokenIds}}});
 await db.user.deleteMany({where:{id:{in:users}}});await db.$disconnect();
},30000);
it('automatically admits repeat early buyers without requiring token winners, preserves rejections and deduplicates',async()=>{
 expect(await intakeEmergingWallets(db,now)).toMatchObject({added:2,reason:'EVALUATION_ONLY'});
 expect(await intakeEmergingWallets(db,now)).toMatchObject({added:0});
 const wallet=await db.trackedWallet.findUniqueOrThrow({where:{address:a}});walletId=wallet.id;
 expect(wallet).toMatchObject({researchReview:'PROVISIONAL',source:'DISCOVERED',active:true});
 expect(await db.trackedWallet.findUnique({where:{address:rejected}})).toBeNull();
 await setting('wallet.discovery.emerging',{checkedAt:new Date(+now-2*3600000).toISOString(),items:[{address:address(),scannedTokens:5}]});
 expect(await intakeEmergingWallets(db,now)).toMatchObject({added:0,reason:'NO_FRESH_DISCOVERY'});
});
it('persists real computed performance and returns ranked small-cap evidence without granting research approval',async()=>{
 for(let i=0;i<5;i++)tokenIds.push((await db.token.create({data:{mint:address(),symbol:'TEST',name:tag}})).id);
 for(let i=0;i<25;i++){
  const at=new Date(+now-(25-i)*12*3600000),exit=new Date(+at+3600000),tokenId=tokenIds[i%5]!;
  await db.walletTrade.createMany({data:[{walletId,tokenId,side:'BUY',at,amountSol:'1',tokenAmount:'100',marketCapUsd:'85000',signature:randomUUID(),
   evidence:{eventAt:at.toISOString(),market:{at:at.toISOString(),source:'dexscreener',marketCapIsFdv:false}}},
   {walletId,tokenId,side:'SELL',at:exit,amountSol:'2',tokenAmount:'100',signature:randomUUID()}]});
 }
 const historyKey=`wallet.history.${walletId}`;ownKeys.push(historyKey);
 await setting(historyKey,{checkedAt:now.toISOString(),coveredFrom:new Date(+now-30*86400000).toISOString(),coveredTo:now.toISOString(),capped:false,skipped:0,windowDays:30});
 await recomputeWalletIntelligence(db,now);
 const response=await app.inject({method:'GET',url:'/v1/smart-money/rankings?band=UNDER_100K',headers:{authorization:'Bearer admin'}});
 expect(response.statusCode).toBe(200);
 const result=WalletRankingPage.parse(response.json()),item=result.items.find(w=>w.address===a)!;
 expect(item).toMatchObject({status:'REVIEW_READY',review:'PROVISIONAL',historyComplete:true,performance:{closedPositions:25,closedTokens:5,winRate:1,realisedPnlSol:'25',medianCloseSeconds:3600}});
 expect((await db.trackedWallet.findUniqueOrThrow({where:{id:walletId}})).researchReview).toBe('PROVISIONAL');
});
it('enforces authentication, tier access and admin bypass, and validates query bands',async()=>{
 const get=(who?:string,query='')=>app.inject({method:'GET',url:`/v1/smart-money/rankings${query}`,headers:who?{authorization:`Bearer ${who}`}:{}});
 expect((await get()).statusCode).toBe(401);
 expect((await get('none')).statusCode).toBe(403);
 expect((await get('early')).statusCode).toBe(200);
  expect((await get('admin','?band=made-up')).statusCode).toBe(400);
  expect((await get('admin','?minMedianPositionSol=-1')).statusCode).toBe(400);
  expect((await get('admin','?status=APPROVED')).statusCode).toBe(400);
 await setting('entitlements.features',{'research.smart_money':{requiredTier:'PRO'}});
 expect((await get('early')).statusCode).toBe(403);
 expect((await get('admin')).statusCode).toBe(200);
});
it('filters before limiting, exposes group counts and recomputes readiness with the selected size threshold',async()=>{
 const get=(query:string)=>app.inject({method:'GET',url:`/v1/smart-money/rankings?band=UNDER_100K&${query}`,headers:{authorization:'Bearer admin'}});
 const ready=WalletRankingPage.parse((await get('status=REVIEW_READY&limit=1')).json());
 expect(ready.items[0]?.address).toBe(a);expect(ready.counts?.reviewReady).toBeGreaterThanOrEqual(1);
 const strict=WalletRankingPage.parse((await get('status=OBSERVING&minMedianPositionSol=2')).json());
 expect(strict.items.find(w=>w.address===a)?.reasons).toContain('SMALL_POSITIONS');
 expect(strict.minMedianPositionSol).toBe(2);
 expect(WalletRankingPage.parse((await get('status=REVIEW_READY&minMedianPositionSol=2')).json()).items.some(w=>w.address===a)).toBe(false);
});
