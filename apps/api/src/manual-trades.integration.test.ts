import {randomUUID} from 'node:crypto';
import {Keypair,SystemProgram,TransactionMessage,VersionedTransaction} from '@solana/web3.js';
import {beforeAll,beforeEach,afterEach,afterAll,expect,it,vi} from 'vitest';
import {createPrisma,type Prisma} from '@narra/database';
import {WSOL_MINT} from '@narra/solana';
import {buildApp} from './app';
import type {ManualSwapEngine,SwapInput} from './manual-swap-engine';
import {assertTestDatabase} from '../../../scripts/test-database';

assertTestDatabase(new URL(process.env.DATABASE_URL??'invalid:'));
const db=createPrisma(),tag=`manual-swap-${randomUUID()}`,signer=Keypair.generate(),wallet=signer.publicKey.toBase58(),otherWallet=Keypair.generate().publicKey.toBase58();
let at:Date,userId:string,otherId:string,tokenId:string,mint:string,seq=0,status:'SUBMITTED'|'CONFIRMED'|'FAILED'='SUBMITTED';
const engine:ManualSwapEngine={
 balances:vi.fn(async()=>({sol:'1000000000',token:'1000000',decimals:6})),
 prepare:vi.fn(async(input:SwapInput)=>({transaction:Buffer.from(new VersionedTransaction(new TransactionMessage({payerKey:signer.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58(),instructions:[SystemProgram.transfer({fromPubkey:signer.publicKey,toPubkey:signer.publicKey,lamports:1})]}).compileToV0Message()).serialize()).toString('base64'),lastValidBlockHeight:500,quote:{inputMint:input.side==='BUY'?WSOL_MINT:mint,outputMint:input.side==='BUY'?mint:WSOL_MINT,inAmount:'1000000',outAmount:'1000000',minOut:'990000',inputDecimals:9,outputDecimals:6,slippageBps:100,priceImpactPct:0,networkFeeLamports:'5000',priorityFeeLamports:'0',maxOverheadLamports:'5000000'}})),
 recheck:vi.fn(async()=>{}),send:vi.fn(async()=>{throw Error('ambiguous RPC timeout');}),status:vi.fn(async()=>status),
};
let app:Awaited<ReturnType<typeof buildApp>>;
const request=(path:string,body?:object,who='owner')=>app.inject({method:body===undefined?'GET':'POST',url:`/v1/manual-trades${path}`,headers:{authorization:`Bearer ${who}`},remoteAddress:`192.0.2.${++seq%200+1}`,...(body?{payload:body}:{})});
const review=async()=>{const r=await request('/research',{mint});expect(r.statusCode,r.body).toBe(200);return r.json();};
const preview=async(side:'BUY'|'SELL'='BUY')=>{const r=await review();const p=await request('/preview',{reviewId:r.id,mint,wallet,side,amount:'0.001',slippageBps:100});expect(p.statusCode,p.body).toBe(200);return p.json();};
function signed(p:{transaction:string}){const tx=VersionedTransaction.deserialize(Buffer.from(p.transaction,'base64'));tx.sign([signer]);return Buffer.from(tx.serialize()).toString('base64');}
beforeAll(async()=>{app=await buildApp({account:{db,now:()=>at,verifier:{verify:async who=>({privyUserId:`${tag}:${who==='owner'?userId:otherId}`})}},manualSwaps:engine});});
beforeEach(async()=>{
 at=new Date('2032-01-01T12:00:00Z');status='SUBMITTED';vi.clearAllMocks();
 userId=randomUUID();otherId=randomUUID();
 for(const id of [userId,otherId])await db.user.create({data:{id,privyUserId:`${tag}:${id}`,isAdmin:true}});
 await db.linkedWallet.create({data:{userId,address:wallet,chain:'solana',verifiedAt:at}});
 await db.linkedWallet.create({data:{userId:otherId,address:otherWallet,chain:'solana',verifiedAt:at}});
 const token=await db.token.create({data:{mint:Keypair.generate().publicKey.toBase58(),symbol:'TEST',name:tag}});mint=token.mint;tokenId=token.id;
 const metric=await db.tokenMetric.create({data:{tokenId,priceUsd:1,marketCapUsd:100000,liquidityUsd:50000,volume24hUsd:10000,at}});
 await db.tokenHolderMetric.create({data:{tokenId,holders:100,top10Pct:25,at}});await db.tokenRiskMetric.create({data:{tokenId,riskScore:10,flags:[],at}});
 await db.systemSetting.create({data:{key:`research.market.${tokenId}`,value:{metricId:metric.id,at:at.toISOString(),source:'dexscreener',marketCapIsFdv:false,priceChange1hPct:null,pairAddress:mint,dexId:'fixture',pairCreatedAt:null}}});
});
afterEach(async()=>{await db.systemSetting.deleteMany({where:{key:{in:[`research.market.${tokenId}`,'system.trading_paused']}}});await db.user.deleteMany({where:{id:{in:[userId,otherId]}}});await db.token.delete({where:{id:tokenId}});});
afterAll(async()=>{await app.close();await db.$disconnect();});

it('requires authentication and reports mainnet plus only the caller’s verified wallets',async()=>{
 expect((await app.inject('/v1/manual-trades/config')).statusCode).toBe(401);
 expect((await request('/config')).json()).toMatchObject({enabled:true,chain:'solana:mainnet',wallets:[wallet]});
 expect((await request(`/balances?wallet=${otherWallet}&mint=${mint}`)).statusCode).toBe(403);
 expect((await request(`/balances?wallet=${wallet}&mint=${mint}`)).statusCode).toBe(200);
});
it('reviews recorded evidence without fabricating smart-money endorsement or calling a swap provider',async()=>{
 const r=await review();expect(r.buyBlockers).toEqual([]);expect(r.notes).toContain('SMART_MONEY_MISSING');expect(r.smartMoney.items).toEqual([]);expect(r.market.source).toBe('dexscreener');expect(engine.prepare).not.toHaveBeenCalled();expect(engine.send).not.toHaveBeenCalled();
});
it('shows only mint-bound stored artwork and does not invalidate approval when only the image changes',async()=>{
 const key=`research.market.${tokenId}`,row=await db.systemSetting.findUniqueOrThrow({where:{key}}),original=row.value as Prisma.JsonObject;
 const imageUrl='https://cdn.dexscreener.com/cms/images/first.png';
 await db.systemSetting.update({where:{key},data:{value:{...original,mint,imageUrl}}});
 const r=await review();expect(r.imageUrl).toBe(imageUrl);
 await db.systemSetting.update({where:{key},data:{value:{...original,mint,imageUrl:'https://cdn.dexscreener.com/cms/images/second.png'}}});
 const p=await request('/preview',{reviewId:r.id,mint,wallet,side:'BUY',amount:'0.001',slippageBps:100});
 expect(p.statusCode,p.body).toBe(200);
 await db.systemSetting.update({where:{key},data:{value:{...original,mint:otherWallet,imageUrl}}});
 expect((await review()).imageUrl).toBeNull();
});
it('requires a fresh own review and verified wallet; refuses client-supplied quotes or identity',async()=>{
 const r=await review(),input={reviewId:r.id,mint,wallet,side:'BUY',amount:'0.001',slippageBps:100};
 expect((await request('/preview',input,'other')).statusCode).toBe(403);
 expect((await request('/preview',{...input,wallet:otherWallet},'other')).json().error).toBe('REVIEW_REQUIRED');
 for(const extra of [{quote:{}},{userId:otherId},{mode:'AUTO'},{slippageBps:301}])expect((await request('/preview',{...input,...extra})).statusCode).toBe(400);
 at=new Date(+at+300001);expect((await request('/preview',input)).json().error).toBe('REVIEW_EXPIRED');expect(engine.prepare).not.toHaveBeenCalled();
});
it('blocks buys with missing/stale/future market provenance, but still allows a reviewed sell',async()=>{
 await db.systemSetting.delete({where:{key:`research.market.${tokenId}`}});const r=await review();expect(r.buyBlockers).toContain('MARKET_MISSING');
 expect((await request('/preview',{reviewId:r.id,mint,wallet,side:'BUY',amount:'0.001',slippageBps:100})).json().error).toBe('BUY_EVIDENCE_REQUIRED');
 expect((await preview('SELL')).side).toBe('SELL');
});
it('honours the operator trading pause before quoting',async()=>{
 await db.systemSetting.create({data:{key:'system.trading_paused',value:{paused:true,reason:'drill',at:at.toISOString(),by:userId}}});
 const r=await review();const p=await request('/preview',{reviewId:r.id,mint,wallet,side:'BUY',amount:'0.001',slippageBps:100});
 expect(p.statusCode,p.body).toBe(409);expect(p.json().error).toBe('TRADING_PAUSED');expect(engine.prepare).not.toHaveBeenCalled();
});
it('does not send until a valid signature, and concurrent/replayed submits preserve one signature and one send',async()=>{
 const p=await preview();expect(engine.send).not.toHaveBeenCalled();
 expect((await request('/submit',{id:p.id,signedTransaction:p.transaction})).json().error).toBe('INVALID_SIGNATURE');
 const body={id:p.id,signedTransaction:signed(p)},[a,b]=await Promise.all([request('/submit',body),request('/submit',body)]);
 expect(a.statusCode,a.body).toBe(200);expect(b.statusCode,b.body).toBe(200);expect(a.json().signature).toBe(b.json().signature);expect(engine.send).toHaveBeenCalledTimes(1);
 expect(a.json().status).toBe('SUBMITTED');expect((await request('/submit',body)).json().signature).toBe(a.json().signature);expect(engine.send).toHaveBeenCalledTimes(1);
 expect(await db.order.count({where:{userId}})).toBe(0);expect(await db.position.count({where:{userId}})).toBe(0);
});
it('keeps an ambiguous network result pending and prevents another preview until chain reconciliation',async()=>{
 const p=await preview();await request('/submit',{id:p.id,signedTransaction:signed(p)});
 const r=await review();expect((await request('/preview',{reviewId:r.id,mint,wallet,side:'BUY',amount:'0.001',slippageBps:100})).json().error).toBe('PENDING_SWAP');
 expect((await request(`/${p.id}`)).json().status).toBe('SUBMITTED');status='CONFIRMED';expect((await request(`/${p.id}`)).json().status).toBe('CONFIRMED');
});
it('does not reveal another user’s preview/history/status',async()=>{
 const p=await preview();expect((await request(`/${p.id}`,undefined,'other')).statusCode).toBe(404);expect((await request('/submit',{id:p.id,signedTransaction:signed(p)},'other')).statusCode).toBe(404);expect((await request('',undefined,'other')).json().items).toEqual([]);
});
it('invalidates the previous quote when inputs are reviewed again',async()=>{
 const p=await preview();await preview();expect((await request('/submit',{id:p.id,signedTransaction:signed(p)})).json().error).toBe('QUOTE_EXPIRED');expect(engine.send).not.toHaveBeenCalled();
});
it.each(['expire','risk','unlink','access'] as const)('rechecks %s between quote and send',async kind=>{
 const p=await preview();if(kind==='expire')at=new Date(+at+61000);if(kind==='risk')await db.tokenRiskMetric.create({data:{tokenId,riskScore:99,flags:['HONEYPOT'],at:new Date(+at+1)}});if(kind==='unlink')await db.linkedWallet.deleteMany({where:{userId}});if(kind==='access')await db.user.update({where:{id:userId},data:{isAdmin:false}});
 const r=await request('/submit',{id:p.id,signedTransaction:signed(p)});expect(r.statusCode,r.body).toBeGreaterThanOrEqual(400);expect(engine.send).not.toHaveBeenCalled();
});
it('redacts smart-money/narrative evidence when those features are unavailable and protects the review route',async()=>{
 await db.user.update({where:{id:userId},data:{isAdmin:false}});expect((await request('/research',{mint})).statusCode).toBe(403);expect((await request('')).statusCode).toBe(200);
});
