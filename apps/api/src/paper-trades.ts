import {randomUUID} from 'node:crypto';
import {marketTokenImages} from './marketEvidence';
import type {FastifyInstance,FastifyRequest,FastifyReply} from 'fastify';
import {Prisma,type PrismaClient} from '@narra/database';
import {z} from 'zod';
import {AgentDecisionSchema,isSolanaAddress,type AgentDecision} from '@narra/shared';
import {evaluateRisk} from '@narra/risk';
import {isQuoteFresh,WSOL_MINT,type JupiterClient,type Quote} from '@narra/solana';
import {MAX_DECISION_AGE_MS,PAPER_FEE_SOL,openPositionKey,paperBuyFill,paperSellFill,sellUnits} from '@narra/trading';
import {captureEntryContext,makeExecutionStore,makePaperPorts,type PreTradeState} from '@narra/worker-pipeline';
import {makeAuthenticate,type AccountDeps} from './account';

const Id=z.string().min(1).max(100);
const Request=z.discriminatedUnion('side',[
 z.object({side:z.literal('BUY'),mint:z.string().refine(isSolanaAddress),sizeSol:z.number().finite().min(.000001).max(10)}).strict(),
 z.object({side:z.literal('SELL'),positionId:Id,fractionPct:z.number().int().min(1).max(100)}).strict(),
]);
type Request=z.infer<typeof Request>;
const Ticket=z.object({request:Request,sizeSol:z.number(),exitFraction:z.number(),decisionId:z.string().nullable(),minOut:z.string().regex(/^\d{1,40}$/),expiresAt:z.string().datetime(),position:z.object({id:Id,units:z.string(),cost:z.string()}).nullable()});
const TTL_MS=60_000;
// Manual-surface freshness windows. Conservative starting values, not validated strategy performance.
const INPUT_MAX_AGE_MS=15*60_000,HOLDER_MAX_AGE_MS=6*3_600_000,MIN_HOLDERS=50;
class PaperError extends Error{constructor(readonly code:string,readonly status=409){super(code);}}
function fail(code:string,status=409):never{throw new PaperError(code,status);}
const noChain={getSolBalance:async():Promise<never>=>fail('PAPER_ONLY'),getPortfolioValueSol:async():Promise<never>=>fail('PAPER_ONLY'),getTokenBaseUnits:async():Promise<never>=>fail('PAPER_ONLY')};
const json=(value:unknown)=>JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const num=(value:{toString():string})=>Number(value.toString());
const positive=(value:number)=>Number.isFinite(value)&&value>0;

/** Quote-only capabilities: no queue, wallet, signing, swap-build or transaction-send port. */
export function registerPaperTradeRoutes(app:FastifyInstance,deps:Pick<AccountDeps,'db'|'verifier'|'now'>&{quotes?:Pick<JupiterClient,'getQuote'>}){
 const {db}=deps,now=deps.now??(()=>new Date());
 const opts={preHandler:makeAuthenticate(deps),config:{rateLimit:{max:20,timeWindow:'1 minute'}}};
 const handle=(work:(userId:string,body:unknown)=>Promise<unknown>)=>async(req:FastifyRequest,reply:FastifyReply)=>{
  try{return await work(req.userId!,req.body);}catch(error){
   if(error instanceof PaperError){await db.auditLog.create({data:{userId:req.userId!,action:'paper.manual.rejected',detail:{code:error.code}}}).catch(()=>undefined);return reply.code(error.status).send({error:error.code});}
   req.log.error({err:error},'manual paper trade failed');return reply.code(503).send({error:'PAPER_UNAVAILABLE'});
  }
 };
 async function state(tx:PrismaClient,userId:string,request:Request,key:string,at:Date){
  const user=await tx.user.findUnique({where:{id:userId}});if(user?.mode!=='PAPER')fail('PAPER_MODE_REQUIRED');
  const position=request.side==='SELL'?await tx.position.findFirst({where:{id:request.positionId,userId,status:'OPEN',simulated:true,mode:'PAPER'},include:{token:true}}):null;
  if(request.side==='SELL'&&!position)fail('NOT_FOUND',404);
  if(position?.baseUnits==null&&request.side==='SELL')fail('PAPER_AMOUNT_UNKNOWN');
  const token=position?.token??await tx.token.findUnique({where:{mint:request.side==='BUY'?request.mint:''}});if(!token)fail('NOT_FOUND',404);
  const evidence=request.side==='BUY'?await tx.agentDecision.findFirst({where:{analysis:{opportunity:{tokenId:token.id}},OR:[{userId:null},{userId}]},orderBy:[{createdAt:'desc'},{id:'desc'}]}):null;
  let decision:AgentDecision;
  if(request.side==='BUY'){
   const parsed=AgentDecisionSchema.safeParse(evidence?.payload);
   if(!evidence||evidence.action!=='BUY'||!parsed.success||parsed.data.action!=='BUY'||evidence.createdAt>at||+at-+evidence.createdAt>MAX_DECISION_AGE_MS)fail('PAPER_BUY_EVIDENCE_REQUIRED');
   decision={...parsed.data,confidence:Math.min(parsed.data.confidence,evidence.confidence)};
  }else{
   // Exit-only governor branches do not consume confidence. This is not an AI recommendation.
   decision={action:request.fractionPct===100?'SELL':'REDUCE',confidence:0,reasonCodes:['MANUAL_PAPER'],positiveSignals:[],negativeSignals:[],risks:[],suggestedPositionSizePct:request.fractionPct,entry:{maxSlippageBps:300,maxPriceImpactPct:3},exit:{stopLossPct:null,takeProfitPct:null,trailingStopPct:null},invalidationConditions:[],summary:'User-requested paper exit'};
  }
  const job={userId,idempotencyKey:key,mint:token.mint,decision};
  let pre:PreTradeState;
  try{pre=await makeExecutionStore(tx,noChain,()=>at).loadPreTradeState(job);}catch{fail('PAPER_INPUTS_UNAVAILABLE');}
  if(pre.context.mode!=='PAPER')fail('PAPER_ONLY');
  const metric=await tx.tokenMetric.findFirst({where:{tokenId:token.id},orderBy:{at:'desc'}});
  if(!metric||!positive(num(metric.priceUsd))||metric.at>at||+at-+metric.at>INPUT_MAX_AGE_MS)fail('PAPER_PRICE_UNAVAILABLE');
  if(request.side==='BUY'){
   const [opportunity,consensus,existing]=await Promise.all([
    tx.opportunity.findFirst({where:{tokenId:token.id},orderBy:{createdAt:'desc'}}),tx.consensusSignal.findFirst({where:{tokenId:token.id},orderBy:{at:'desc'}}),tx.position.findFirst({where:{userId,tokenId:token.id,status:'OPEN'}}),
   ]);
   if(existing)fail('PAPER_POSITION_EXISTS');
   const holders=await tx.tokenHolderMetric.findFirst({where:{tokenId:token.id},orderBy:{at:'desc'}});
   if(!holders||holders.at>at||+at-+holders.at>HOLDER_MAX_AGE_MS)fail('PAPER_INPUTS_UNAVAILABLE');
   if(holders.holders<MIN_HOLDERS)fail('HOLDERS_TOO_LOW');
   if(!opportunity||!consensus||opportunity.createdAt>at||consensus.at>at||+at-+opportunity.createdAt>MAX_DECISION_AGE_MS||+at-+consensus.at>INPUT_MAX_AGE_MS)fail('PAPER_INPUTS_UNAVAILABLE');
   if(!positive(pre.context.portfolio.totalValueSol))fail('PAPER_INPUTS_UNAVAILABLE');
   decision.suggestedPositionSizePct=request.sizeSol/pre.context.portfolio.totalValueSol*100;
   if(decision.suggestedPositionSizePct>100)fail('INSUFFICIENT_BALANCE');
   pre.context.portfolio.walletBalanceSol-=PAPER_FEE_SOL;
  }
  return {token,position,decision,decisionId:evidence?.id??null,pre,priceUsd:num(metric.priceUsd)};
 }
 async function reviewed(tx:PrismaClient,userId:string,request:Request,key:string){
  if(!deps.quotes)fail('PAPER_QUOTES_UNAVAILABLE',503);
  const s=await state(tx,userId,request,key,now());
  const check=(quote:{priceImpactPct:number;expectedSlippageBps:number})=>{
   const risk=evaluateRisk(s.decision,{...s.pre.context,quote},s.pre.limits,s.pre.systemLimits);
   if(!risk.approved||risk.route!=='SIMULATE')fail(risk.violations[0]?.code??'PAPER_RISK_REJECTED');return risk;
  };
  const first=check({priceImpactPct:0,expectedSlippageBps:0});
  const amount=request.side==='BUY'?BigInt(Math.floor(first.sizeSol*1e9)):sellUnits(s.position!.baseUnits!.toFixed(0),first.exitFraction);
  if(amount<=0n)fail('ZERO_AMOUNT');
  let quote:Quote;
  try{quote=await deps.quotes!.getQuote({inputMint:request.side==='BUY'?WSOL_MINT:s.token.mint,outputMint:request.side==='BUY'?s.token.mint:WSOL_MINT,amount,slippageBps:first.maxSlippageBps});}catch{fail('PAPER_QUOTES_UNAVAILABLE',503);}
  if(!isQuoteFresh(quote,now())||quote.inputMint!==(request.side==='BUY'?WSOL_MINT:s.token.mint)||quote.outputMint!==(request.side==='BUY'?s.token.mint:WSOL_MINT)||quote.inAmount!==amount.toString()||!/^\d{1,40}$/.test(quote.outAmount)||BigInt(quote.outAmount)<=0n||!quote.otherAmountThreshold||!/^\d{1,40}$/.test(quote.otherAmountThreshold)||BigInt(quote.otherAmountThreshold)<=0n||BigInt(quote.otherAmountThreshold)>BigInt(quote.outAmount)||!Number.isFinite(quote.priceImpactPct)||quote.priceImpactPct<0||!Number.isInteger(quote.slippageBps)||quote.slippageBps<0)fail('PAPER_QUOTE_INVALID',503);
  const risk=check({priceImpactPct:quote.priceImpactPct,expectedSlippageBps:quote.slippageBps});
  const minimum=(BigInt(quote.outAmount)*BigInt(10_000-risk.maxSlippageBps))/10_000n;
  if(BigInt(quote.otherAmountThreshold!)<minimum)fail('PAPER_QUOTE_INVALID',503);
  return {...s,quote,risk,positionVersion:s.position?{id:s.position.id,units:s.position.baseUnits!.toFixed(0),cost:s.position.sizeSol.toString()}:null};
 }
 app.get('/v1/paper-trades/account',opts,handle(async userId=>{
  const user=await db.user.findUnique({where:{id:userId},include:{permission:true}}),p=user?.permission,at=now();
  return {mode:user?.mode??null,balanceSol:await makePaperPorts(db).balanceSol(userId),feeSol:PAPER_FEE_SOL,quotesAvailable:!!deps.quotes,entryPermission:!!p?.aiTradingEnabled&&!p.revokedAt&&(!p.delegatedUntil||p.delegatedUntil>at),paused:p?.agentPaused??false};
 }));
 app.post('/v1/paper-trades/preview',opts,handle(async(userId,body)=>{
  const parsed=Request.safeParse(body);if(!parsed.success)fail('INVALID_INPUT',400);
  const s=await reviewed(db,userId,parsed.data,`paper-preview:${randomUUID()}`);
  const expiresAt=new Date(+now()+TTL_MS).toISOString();
  const ticket=Ticket.parse({request:parsed.data,sizeSol:s.risk.sizeSol,exitFraction:s.risk.exitFraction,decisionId:s.decisionId,minOut:s.quote.otherAmountThreshold,expiresAt,position:s.positionVersion});
   const record=await db.auditLog.create({data:{userId,action:'paper.manual.preview',detail:json(ticket)}});
   const images=await marketTokenImages(db,[s.token]);
   return {previewId:record.id,expiresAt,side:parsed.data.side,mint:s.token.mint,symbol:s.token.symbol,name:s.token.name,imageUrl:images.get(s.token.id)??null,sizeSol:s.risk.sizeSol,requestedSizeSol:parsed.data.side==='BUY'?parsed.data.sizeSol:null,fractionPct:s.risk.exitFraction*100,estimatedProceedsSol:parsed.data.side==='SELL'?Number(s.quote.outAmount)/1e9:null,feeSol:PAPER_FEE_SOL,priceImpactPct:s.quote.priceImpactPct,slippageBps:s.risk.maxSlippageBps,simulated:true};
 }));
 app.post('/v1/paper-trades/confirm',opts,handle(async(userId,body)=>{
  const parsed=z.object({previewId:Id,paperAcknowledged:z.literal(true)}).strict().safeParse(body);if(!parsed.success)fail('INVALID_INPUT',400);
  return db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`execution:${userId}`},0))`;
   const record=await tx.auditLog.findFirst({where:{id:parsed.data.previewId,userId,action:'paper.manual.preview'}});if(!record)fail('NOT_FOUND',404);
   const key=`manual-paper:${record.id}`;
   const prior=await tx.order.findUnique({where:{idempotencyKey:key},include:{trade:true}});
   if(prior){if(prior.userId!==userId||!prior.simulated||!prior.trade)fail('PAPER_UNAVAILABLE',503);return {orderId:prior.id,positionId:prior.trade.positionId,side:prior.side,simulated:true,replayed:true};}
   // Mode/permission/profile edits cannot race the final quote and commit.
   await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${userId} FOR SHARE`;
   await tx.$queryRaw`SELECT "id" FROM "TradingPermission" WHERE "userId"=${userId} FOR SHARE`;
   await tx.$queryRaw`SELECT "id" FROM "RiskProfile" WHERE "userId"=${userId} FOR SHARE`;
   await tx.$queryRaw`SELECT "key" FROM "SystemSetting" WHERE "key" IN ('system.trading_paused','risk.system_limits') FOR SHARE`;
   const ticket=Ticket.safeParse(record.detail);if(!ticket.success)fail('PAPER_UNAVAILABLE',503);
   if(+now()>=Date.parse(ticket.data.expiresAt))fail('PAPER_PREVIEW_EXPIRED',410);
   const s=await reviewed(tx as unknown as PrismaClient,userId,ticket.data.request,key);
   if(+now()>=Date.parse(ticket.data.expiresAt))fail('PAPER_PREVIEW_EXPIRED',410);
   if(s.risk.sizeSol!==ticket.data.sizeSol||s.risk.exitFraction!==ticket.data.exitFraction||s.decisionId!==ticket.data.decisionId||JSON.stringify(s.positionVersion)!==JSON.stringify(ticket.data.position)||BigInt(s.quote.outAmount)<BigInt(ticket.data.minOut))fail('PAPER_REVIEW_CHANGED');
   const at=now(),request=ticket.data.request,orderId=randomUUID();let positionId=s.position?.id??randomUUID();
   const fill=request.side==='BUY'?paperBuyFill({sizeSol:s.risk.sizeSol,marketPriceUsd:s.priceUsd,quote:s.quote}):paperSellFill({position:{baseUnits:s.position!.baseUnits!.toFixed(0),costSol:num(s.position!.sizeSol)},exitFraction:s.risk.exitFraction,marketPriceUsd:s.priceUsd,quote:s.quote});
   const entry=request.side==='BUY'?await captureEntryContext(tx as unknown as PrismaClient,s.token.id,s.decision.exit,at):null;
   await tx.riskDecision.create({data:{userId,idempotencyKey:key,decisionId:s.decisionId,approved:true,route:s.risk.route,sizeSol:s.risk.sizeSol,violations:json(s.risk.violations),adjustments:json(s.risk.adjustments)}});
   await tx.order.create({data:{id:orderId,userId,tokenId:s.token.id,decisionId:s.decisionId,idempotencyKey:key,side:request.side,mode:'MANUAL',status:'CONFIRMED',sizeSol:'proceedsSol'in fill?fill.proceedsSol:fill.sizeSol,simulated:true,createdAt:at}});
   if('baseUnits'in fill){
    await tx.position.create({data:{id:positionId,userId,tokenId:s.token.id,mode:'PAPER',simulated:true,entryPriceUsd:fill.fillPriceUsd,sizeSol:fill.sizeSol,entrySizeSol:fill.sizeSol,baseUnits:fill.baseUnits,openKey:openPositionKey(userId,s.token.id),entryContext:json(entry),openedAt:at}});
   }else{
    positionId=s.position!.id;
    const updated=await tx.position.updateMany({where:{id:positionId,userId,status:'OPEN',simulated:true,baseUnits:s.position!.baseUnits,sizeSol:s.position!.sizeSol},data:fill.closes?{status:'CLOSED',closedAt:at,openKey:null,baseUnits:'0',sizeSol:0}:{baseUnits:fill.remainingUnits,sizeSol:fill.remainingCostSol}});
    if(updated.count!==1)fail('PAPER_REVIEW_CHANGED');
   }
   await tx.trade.create({data:{userId,orderId,positionId,side:request.side,mode:'MANUAL',reason:request.side==='BUY'?'Manual paper buy':'Manual paper position close',expectedPriceUsd:fill.expectedPriceUsd,actualPriceUsd:fill.fillPriceUsd,slippageBps:fill.slippageBps,realizedPnlSol:fill.realizedPnlSol,simulated:true,amountSol:'proceedsSol'in fill?fill.proceedsSol:fill.sizeSol,feeSol:fill.feeSol,baseUnits:'unitsSold'in fill?fill.unitsSold:fill.baseUnits,signature:`paper:${orderId}`,executedAt:at}});
   await tx.executionAttempt.create({data:{orderId,quote:json({inputMint:s.quote.inputMint,outputMint:s.quote.outputMint,inAmount:s.quote.inAmount,outAmount:s.quote.outAmount,fetchedAt:s.quote.fetchedAt}),priceImpactPct:s.quote.priceImpactPct,slippageBps:s.quote.slippageBps}});
   await tx.auditLog.create({data:{userId,action:'paper.manual.filled',detail:json({previewId:record.id,orderId,positionId,side:request.side,simulated:true})}});
   return {orderId,positionId,side:request.side,simulated:true,replayed:false};
  },{timeout:15_000,maxWait:5000});
 }));
}
