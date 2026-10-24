import {randomBytes,randomUUID} from 'node:crypto';
import bs58 from 'bs58';
import {afterAll,afterEach,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import {createPrisma} from '@narra/database';
import {WSOL_MINT,type Quote,type QuoteRequest} from '@narra/solana';
import {makePaperPorts,makeExecutionStore,runExecution} from '@narra/worker-pipeline';
import {buildApp} from './app';
import {assertTestDatabase} from '../../../scripts/test-database';

assertTestDatabase(new URL(process.env.DATABASE_URL??'invalid:'));
const db=createPrisma(),tag=`manual-paper-${randomUUID()}`;
let at=new Date(),userId:string,otherId:string,mint:string,tokenId:string,decisionId:string,seq=0;
const ids:string[]=[],tokens:string[]=[];
const payload={action:'BUY' as const,confidence:.95,reasonCodes:['SMART_MONEY'],positiveSignals:[],negativeSignals:[],risks:[],suggestedPositionSizePct:1,entry:{maxSlippageBps:100,maxPriceImpactPct:1},exit:{stopLossPct:30,takeProfitPct:100,trailingStopPct:null},invalidationConditions:[],summary:'Test evidence'};
let modifier:(quote:Quote)=>Quote=q=>q;
const quotes={getQuote:vi.fn(async(req:QuoteRequest):Promise<Quote>=>{
 const out=req.inputMint===WSOL_MINT?req.amount*1000n:req.amount/1000n;
 return modifier({inputMint:req.inputMint,outputMint:req.outputMint,inAmount:req.amount.toString(),outAmount:out.toString(),otherAmountThreshold:(out*BigInt(10000-req.slippageBps)/10000n).toString(),priceImpactPct:0,slippageBps:req.slippageBps,fetchedAt:at,raw:{}});
})};
const enqueue=vi.fn();
let app:Awaited<ReturnType<typeof buildApp>>;
const req=(path:string,body?:unknown,who='owner')=>app.inject({method:body===undefined?'GET':'POST',url:`/v1/paper-trades/${path}`,headers:{authorization:`Bearer ${who}`},remoteAddress:`192.0.2.${++seq%200+1}`,...(body===undefined?{}:{payload:body as object})});
const preview=async(body:unknown)=>{const r=await req('preview',body);expect(r.statusCode,r.body).toBe(200);return r.json();};
const confirm=(id:string,who='owner')=>req('confirm',{previewId:id,paperAcknowledged:true},who);
async function seedToken(){
 const token=await db.token.create({data:{mint:bs58.encode(randomBytes(32)),symbol:'PAPER',name:tag}});tokens.push(token.id);
 await db.tokenMetric.create({data:{tokenId:token.id,priceUsd:1,marketCapUsd:1e6,liquidityUsd:600000,volume24hUsd:500000,at}});
 await db.tokenHolderMetric.create({data:{tokenId:token.id,holders:100,top10Pct:10,smartWalletHolders:5,at}});
 await db.consensusSignal.create({data:{tokenId:token.id,score:90,walletCount:5,independentEntities:5,leaderCount:2,at}});
 const opp=await db.opportunity.create({data:{tokenId:token.id,score:90,narrativeScore:90,smartMoneyScore:90,liquidityScore:90,momentumScore:90,ogScore:90,riskScore:10,createdAt:at}});
 const a=await db.agentAnalysis.create({data:{opportunityId:opp.id,model:'fixture'}});
 const d=await db.agentDecision.create({data:{analysisId:a.id,confidence:.95,action:'BUY',payload,createdAt:at}});
 return {token,decision:d};
}
beforeAll(async()=>{app=await buildApp({account:{db,verifier:{verify:async who=>({privyUserId:who==='owner'?`${tag}:${userId}`:`${tag}:${otherId}`})},now:()=>at},paperQuotes:quotes,enqueueExecution:enqueue});});
beforeEach(async()=>{
 at=new Date('2032-01-01T12:00:00Z');modifier=q=>q;quotes.getQuote.mockClear();enqueue.mockClear();
 for(const who of ['owner','other']){const id=randomUUID();ids.push(id);await db.user.create({data:{id,privyUserId:`${tag}:${id}`,mode:'PAPER',permission:{create:{aiTradingEnabled:true}},riskProfile:{create:{preset:'BALANCED'}}}});if(who==='owner')userId=id;else otherId=id;}
 const s=await seedToken();mint=s.token.mint;tokenId=s.token.id;decisionId=s.decision.id;
});
afterEach(async()=>{
 await db.auditLog.deleteMany({where:{userId:{in:ids}}});await db.riskDecision.deleteMany({where:{userId:{in:ids}}});
 await db.user.deleteMany({where:{id:{in:ids}}});await db.token.deleteMany({where:{id:{in:tokens}}});ids.length=0;tokens.length=0;
});
afterAll(async()=>{await app.close();await db.$disconnect();});

it('requires authentication, exposes only virtual account state and never touches a queue',async()=>{
 expect((await app.inject('/v1/paper-trades/account')).statusCode).toBe(401);
 expect((await app.inject({method:'POST',url:'/v1/paper-trades/preview',payload:{side:'BUY',mint,sizeSol:.1}})).statusCode).toBe(401);
 expect((await req('account')).json()).toMatchObject({mode:'PAPER',balanceSol:10,feeSol:.002,quotesAvailable:true,entryPermission:true});expect(enqueue).not.toHaveBeenCalled();
});
it('preview creates no ledger entries; confirm fills exactly once under concurrent requests and replay survives expiry',async()=>{
 const p=await preview({side:'BUY',mint,sizeSol:.1});
 expect(await db.order.count({where:{userId}})).toBe(0);expect(await db.position.count({where:{userId}})).toBe(0);
 const [a,b]=await Promise.all([confirm(p.previewId),confirm(p.previewId)]);expect(a.statusCode,a.body).toBe(200);expect(b.statusCode,b.body).toBe(200);
 expect(a.json().orderId).toBe(b.json().orderId);expect([a.json().replayed,b.json().replayed].sort()).toEqual([false,true]);
 const order=await db.order.findFirstOrThrow({where:{userId},include:{trade:true}});expect(order).toMatchObject({mode:'MANUAL',simulated:true,status:'CONFIRMED'});expect(order.trade).toMatchObject({simulated:true,mode:'MANUAL',reason:'Manual paper buy'});
 expect(await db.trade.count({where:{userId}})).toBe(1);expect(await makePaperPorts(db).balanceSol(userId)).toBe(9.898);expect(enqueue).not.toHaveBeenCalled();
 at=new Date(+at+120000);expect((await confirm(p.previewId)).json()).toMatchObject({orderId:order.id,replayed:true});
});
it('partial and full closes update remaining cost/units atomically and record fees/P&L',async()=>{
 const buy=await preview({side:'BUY',mint,sizeSol:.1});const filled=(await confirm(buy.previewId)).json();
 const p=await preview({side:'SELL',positionId:filled.positionId,fractionPct:25});expect(p.estimatedProceedsSol).toBe(.025);
 expect((await confirm(p.previewId)).statusCode).toBe(200);
 let position=await db.position.findUniqueOrThrow({where:{id:filled.positionId}});expect(position.sizeSol.toString()).toBe('0.075');expect(position.baseUnits!.toFixed(0)).toBe('75000000000');expect(position.status).toBe('OPEN');
 at=new Date(+at+121000);
 const rest=await preview({side:'SELL',positionId:filled.positionId,fractionPct:100});expect((await confirm(rest.previewId)).statusCode).toBe(200);
 position=await db.position.findUniqueOrThrow({where:{id:filled.positionId}});expect(position.status).toBe('CLOSED');expect(position.openKey).toBeNull();expect(position.sizeSol.toString()).toBe('0');expect(await db.trade.count({where:{userId,simulated:true}})).toBe(3);
 expect(await makePaperPorts(db).balanceSol(userId)).toBe(9.994);
});
it('requires the explicit paper acknowledgement and refuses client-supplied identity, quote, mode or risk overrides',async()=>{
 for(const extra of [{userId:otherId},{mode:'AUTO'},{quote:{}},{confidence:1},{slippageBps:9999}])expect((await req('preview',{side:'BUY',mint,sizeSol:.1,...extra})).statusCode).toBe(400);
 const p=await preview({side:'BUY',mint,sizeSol:.1});expect((await req('confirm',{previewId:p.previewId})).statusCode).toBe(400);expect((await req('confirm',{previewId:p.previewId,paperAcknowledged:true,userId})).statusCode).toBe(400);
 expect(await db.trade.count({where:{userId}})).toBe(0);
});
it.each(['AUTO','SEMI_AUTO','SHADOW'] as const)('never fills from %s mode',async mode=>{await db.user.update({where:{id:userId},data:{mode}});expect((await req('preview',{side:'BUY',mint,sizeSol:.1})).json().error).toBe('PAPER_MODE_REQUIRED');expect(quotes.getQuote).not.toHaveBeenCalled();});
it('does not reveal or use another user’s preview or position, and refuses real/legacy positions',async()=>{
 const p=await preview({side:'BUY',mint,sizeSol:.1});expect((await confirm(p.previewId,'other')).statusCode).toBe(404);
 const result=(await confirm(p.previewId)).json();expect((await req('preview',{side:'SELL',positionId:result.positionId,fractionPct:100},'other')).statusCode).toBe(404);
 await db.position.update({where:{id:result.positionId},data:{simulated:false,mode:'AUTO'}});expect((await req('preview',{side:'SELL',positionId:result.positionId,fractionPct:100})).statusCode).toBe(404);
 await db.position.update({where:{id:result.positionId},data:{simulated:true,mode:'PAPER',baseUnits:null}});expect((await req('preview',{side:'SELL',positionId:result.positionId,fractionPct:100})).json().error).toBe('PAPER_AMOUNT_UNKNOWN');
});
it('rejects expired reviews without fills',async()=>{const p=await preview({side:'BUY',mint,sizeSol:.1});at=new Date(+at+60001);expect((await confirm(p.previewId)).statusCode).toBe(410);expect(await db.order.count({where:{userId}})).toBe(0);});
it.each(['permission','mode','profile'] as const)('rechecks %s after preview rather than trusting the ticket',async change=>{
 const p=await preview({side:'BUY',mint,sizeSol:.1});
 if(change==='permission')await db.tradingPermission.update({where:{userId},data:{aiTradingEnabled:false}});
 if(change==='mode')await db.user.update({where:{id:userId},data:{mode:'AUTO'}});
 if(change==='profile')await db.riskProfile.update({where:{userId},data:{maxPerTradeSol:.01}});
 expect((await confirm(p.previewId)).statusCode).toBe(409);expect(await db.order.count({where:{userId}})).toBe(0);
});
it('requires another review for adverse quote movement',async()=>{
 const p=await preview({side:'BUY',mint,sizeSol:.1});modifier=q=>({...q,outAmount:(BigInt(q.outAmount)/2n).toString(),otherAmountThreshold:(BigInt(q.otherAmountThreshold!)/2n).toString()});
 expect((await confirm(p.previewId)).json().error).toBe('PAPER_REVIEW_CHANGED');expect(await db.trade.count({where:{userId}})).toBe(0);
});
it.each(['stale','wrongMint','wrongAmount','noMinimum','impact'] as const)('rejects invalid provider quote: %s',async kind=>{
 modifier=q=>({...q,...(kind==='stale'?{fetchedAt:new Date(+at-6000)}:kind==='wrongMint'?{inputMint:mint}:kind==='wrongAmount'?{inAmount:'1'}:kind==='noMinimum'?{otherAmountThreshold:null}:{priceImpactPct:90})});
 expect((await req('preview',{side:'BUY',mint,sizeSol:.1})).statusCode).not.toBe(200);expect(await db.order.count({where:{userId}})).toBe(0);
});
it('fails closed on missing/stale evidence and holders below the unchanged floor',async()=>{
 await db.agentDecision.update({where:{id:decisionId},data:{createdAt:new Date(+at-601000)}});expect((await req('preview',{side:'BUY',mint,sizeSol:.1})).json().error).toBe('PAPER_BUY_EVIDENCE_REQUIRED');
 await db.agentDecision.update({where:{id:decisionId},data:{createdAt:at}});await db.tokenHolderMetric.updateMany({where:{tokenId},data:{holders:49}});expect((await req('preview',{side:'BUY',mint,sizeSol:.1})).json().error).toBe('HOLDERS_TOO_LOW');
 expect(quotes.getQuote).not.toHaveBeenCalled();
});
it('shows a risk-clamped size in the review, never silently fills the requested larger amount',async()=>{const p=await preview({side:'BUY',mint,sizeSol:1});expect(p.sizeSol).toBe(.25);expect(p.requestedSizeSol).toBe(1);expect((await confirm(p.previewId)).statusCode).toBe(200);expect((await db.order.findFirstOrThrow({where:{userId}})).sizeSol.toString()).toBe('0.25');});
it('concurrent distinct tickets cannot open duplicate positions',async()=>{const a=await preview({side:'BUY',mint,sizeSol:.1}),b=await preview({side:'BUY',mint,sizeSol:.1});const results=await Promise.all([confirm(a.previewId),confirm(b.previewId)]);expect(results.map(r=>r.statusCode).sort()).toEqual([200,409]);expect(await db.position.count({where:{userId}})).toBe(1);});
it('shares the per-user execution lock with worker paper fills, preserving aggregate allocation limits',async()=>{
 await db.riskProfile.update({where:{userId},data:{maxDailyAllocationSol:.15}});
 const another=await seedToken(),p=await preview({side:'BUY',mint,sizeSol:.1});
 let release!:()=>void,entered!:()=>void;const enteredQuote=new Promise<void>(r=>{entered=r;}),wait=new Promise<void>(r=>{release=r;});
 quotes.getQuote.mockImplementationOnce(async input=>{entered();await wait;const out=input.amount*1000n;return {inputMint:input.inputMint,outputMint:input.outputMint,inAmount:input.amount.toString(),outAmount:out.toString(),otherAmountThreshold:(out*99n/100n).toString(),priceImpactPct:0,slippageBps:input.slippageBps,fetchedAt:at,raw:{}};});
 const manual=confirm(p.previewId);await enteredQuote;
 const noChain={getSolBalance:async()=>{throw Error('no chain');},getPortfolioValueSol:async()=>{throw Error('no chain');},getTokenBaseUnits:async()=>{throw Error('no chain');}};
 const worker=runExecution(db,{userId,idempotencyKey:`worker:${randomUUID()}`,mint:another.token.mint,decisionId:another.decision.id,decision:payload},{jupiter:quotes,...makeExecutionStore(db,noChain,()=>at),now:()=>at});
 release();expect((await manual).statusCode).toBe(200);expect((await worker).status).toBe('simulated');
 const total=await db.order.aggregate({where:{userId,side:'BUY'},_sum:{sizeSol:true}});expect(Number(total._sum.sizeSol)).toBe(.15);expect(enqueue).not.toHaveBeenCalled();
});
