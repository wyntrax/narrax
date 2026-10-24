import type {FastifyInstance,FastifyRequest,FastifyReply} from 'fastify';
import {z} from 'zod';
import {Prisma} from '@narra/database';
import {TradeRequest,TradeAddress,TradeQuote,TradeReview,TradeRecord,TradePreview} from '@narra/shared';
import {TRADING_PAUSE_KEY,parsePause} from '@narra/worker-pipeline';
import {WSOL_MINT} from '@narra/solana';
import {makeAuthenticate,type AccountDeps} from './account';
import {canReadFeature,requireFeature} from './entitlements/access';
import {tradeResearch,fresh} from './trade-research';
import {SwapError,verifySignedSwap,type ManualSwapEngine} from './manual-swap-engine';

const json=(v:unknown)=>JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
type ManualSwap=Prisma.ManualSwapGetPayload<Record<string,never>>;
const Id=z.string().min(1).max(100);
const Ticket=z.object({mint:TradeAddress,hash:z.string(),at:z.string().datetime(),expiresAt:z.string().datetime()});
const fail=(code:string,status=409):never=>{throw new SwapError(code,status);};
const serialize=(r:ManualSwap)=>TradeRecord.parse({...r,createdAt:r.createdAt.toISOString(),expiresAt:r.expiresAt.toISOString(),quote:r.quote});

export function registerManualTradeRoutes(app:FastifyInstance,deps:Pick<AccountDeps,'db'|'verifier'|'now'>&{engine?:ManualSwapEngine}){
 const {db,engine}=deps,now=deps.now??(()=>new Date());
 const opts={preHandler:[makeAuthenticate(deps),requireFeature(db,'research.tokens',now)],config:{rateLimit:{max:20,timeWindow:'1 minute'}}};
 const ownOpts={...opts,preHandler:[makeAuthenticate(deps)]};
 const handle=(f:(req:FastifyRequest)=>Promise<unknown>)=>async(req:FastifyRequest,reply:FastifyReply)=>{
  reply.header('Cache-Control','private, no-store');
  try{return await f(req);}catch(e){
   if(e instanceof SwapError)return reply.code(e.status).send({error:e.code});
   if(e instanceof z.ZodError)return reply.code(400).send({error:'INVALID_INPUT'});
   // The table/column is missing. This is an operator problem, not a transient trade failure.
   if(e instanceof Prisma.PrismaClientKnownRequestError&&(e.code==='P2021'||e.code==='P2022')){req.log.error({err:e,msg:'manual_swap_schema_missing'},'manual swap schema is behind; apply migrations');return reply.code(503).send({error:'MIGRATION_REQUIRED'});}
   req.log.error({err:e,msg:'manual_swap_unavailable',url:req.url},'manual swap failed');
   return reply.code(503).send({error:'TRADE_UNAVAILABLE'});
  }
 };
 async function wallet(userId:string,address:string){if(!await db.linkedWallet.findFirst({where:{userId,chain:'solana',address}}))fail('VERIFIED_WALLET_REQUIRED',403);}
 async function available(){if(!engine||engine.enabled===false)fail('TRADING_DISABLED',503);const paused=await db.systemSetting.findUnique({where:{key:TRADING_PAUSE_KEY}});if(parsePause(paused?.value).paused)fail('TRADING_PAUSED');return engine!;}
 async function evidence(userId:string,id:string,mint:string,side:'BUY'|'SELL'){
  if(!await canReadFeature(db,userId,'research.tokens',now()))fail('FEATURE_LOCKED',403);
  const row=await db.auditLog.findFirst({where:{id,userId,action:'manual.research.review'}});if(!row)fail('REVIEW_REQUIRED');
  const ticket=Ticket.parse(row!.detail);if(ticket.mint!==mint||!fresh(new Date(ticket.at),now(),300000)||+now()>=Date.parse(ticket.expiresAt))fail('REVIEW_EXPIRED');
  const research=await tradeResearch(db,userId,mint,now());
  if(ticket.hash!==research.hash)fail('REVIEW_CHANGED');
  if(side==='BUY'&&research.data.buyBlockers.length)fail('BUY_EVIDENCE_REQUIRED');
  return {ticket,data:research.data,reviewId:id};
 }
 async function reconcile(row:ManualSwap){
  // Missing RPC evidence NEVER becomes a failed trade or permission to send another transaction.
  if(row.status==='SUBMITTED'&&row.signature&&engine){const status=await engine.status(row.signature);if(status!=='SUBMITTED'){await db.manualSwap.updateMany({where:{id:row.id,status:'SUBMITTED'},data:{status}});return {...row,status};}}
  if(row.status==='PREPARED'&&row.expiresAt<=now()){await db.manualSwap.updateMany({where:{id:row.id,status:'PREPARED'},data:{status:'EXPIRED'}});return {...row,status:'EXPIRED'};}
  return row;
 }
 app.get('/v1/manual-trades/config',ownOpts,handle(async req=>({enabled:!!engine&&engine.enabled!==false,chain:'solana:mainnet',wallets:(await db.linkedWallet.findMany({where:{userId:req.userId!,chain:'solana'},select:{address:true}})).map(w=>w.address)})));
 app.post('/v1/manual-trades/research',opts,handle(async req=>{
  const {mint}=z.object({mint:TradeAddress}).strict().parse(req.body);if(mint===WSOL_MINT)fail('INVALID_INPUT',400);
  const at=now(),expiresAt=new Date(+at+300000).toISOString(),research=await tradeResearch(db,req.userId!,mint,at);
  const row=await db.auditLog.create({data:{userId:req.userId!,action:'manual.research.review',detail:json({mint,hash:research.hash,at:at.toISOString(),expiresAt})}});
  return TradeReview.parse({...research.data,id:row.id,at:at.toISOString(),expiresAt});
 }));
 app.get('/v1/manual-trades/balances',opts,handle(async req=>{
  const q=z.object({wallet:TradeAddress,mint:TradeAddress}).parse(req.query);await wallet(req.userId!,q.wallet);
  const port=await available();return {...q,...await port.balances(q.wallet,q.mint),at:now().toISOString()};
 }));
 app.post('/v1/manual-trades/preview',opts,handle(async req=>{
  const input=TradeRequest.parse(req.body),userId=req.userId!,port=await available();
  await wallet(userId,input.wallet);const review=await evidence(userId,input.reviewId,input.mint,input.side);
  const started=now(),built=await port.prepare(input);
  if(+now()-+started>20000)fail('QUOTE_EXPIRED');
  await evidence(userId,input.reviewId,input.mint,input.side);
  const row=await db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`manual-swap:${userId}:${input.wallet}`},0))`;
   if(await tx.manualSwap.count({where:{userId,wallet:input.wallet,status:'SUBMITTED'}}))fail('PENDING_SWAP');
   await tx.manualSwap.updateMany({where:{userId,wallet:input.wallet,status:'PREPARED'},data:{status:'EXPIRED'}});
   return tx.manualSwap.create({data:{userId,wallet:input.wallet,mint:input.mint,side:input.side,transaction:built.transaction,quote:json(built.quote),review:json(review),lastValidBlockHeight:built.lastValidBlockHeight,createdAt:now(),expiresAt:new Date(+started+60000)}});
  });
  return TradePreview.parse({...serialize(row),transaction:row.transaction});
 }));
 app.post('/v1/manual-trades/submit',opts,handle(async req=>{
  const {id,signedTransaction}=z.object({id:Id,signedTransaction:z.string().min(1).max(1644).regex(/^[A-Za-z0-9+/]+={0,2}$/)}).strict().parse(req.body),userId=req.userId!;
  const record=await db.manualSwap.findFirst({where:{id,userId}});if(!record)fail('NOT_FOUND',404);
  const row=record!,signature=verifySignedSwap(row.transaction,signedTransaction,row.wallet);
  if(row.signature){if(row.signature!==signature)fail('INVALID_SIGNATURE');return serialize(await reconcile(row));}
  const port=await available();await wallet(userId,row.wallet);
  if(row.status!=='PREPARED'||row.expiresAt<=now())fail('QUOTE_EXPIRED',410);
  const review=z.object({reviewId:Id}).parse(row.review);await evidence(userId,review.reviewId,row.mint,row.side);
  await port.recheck(row.transaction,row.wallet,row.side,TradeQuote.parse(row.quote));
  await available();await wallet(userId,row.wallet);await evidence(userId,review.reviewId,row.mint,row.side);
  const claimed=await db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`manual-swap:${userId}:${row.wallet}`},0))`;
   if(await tx.manualSwap.count({where:{userId,wallet:row.wallet,status:'SUBMITTED',id:{not:id}}}))fail('PENDING_SWAP');
   return tx.manualSwap.updateMany({where:{id,userId,status:'PREPARED',expiresAt:{gt:now()},signature:null},data:{status:'SUBMITTED',signature}});
  });
  if(claimed.count){
   // Persist before network send. Timeout/crash remains pending; never auto-rebuild or sign again.
   try{const sent=await port.send(signedTransaction);if(sent!==signature)throw Error('signature mismatch');}catch{/* Send may have reached the network. */}
  }
  const latest=await db.manualSwap.findFirstOrThrow({where:{id,userId}});
  if(latest.signature!==signature)fail('QUOTE_EXPIRED',410);
  return serialize(latest);
 }));
 app.get('/v1/manual-trades',ownOpts,handle(async req=>({items:(await db.manualSwap.findMany({where:{userId:req.userId!},orderBy:{createdAt:'desc'},take:20})).map(serialize)})));
 app.get('/v1/manual-trades/:id',ownOpts,handle(async req=>{const {id}=z.object({id:Id}).parse(req.params);const row=await db.manualSwap.findFirst({where:{id,userId:req.userId!}});if(!row)fail('NOT_FOUND',404);return serialize(await reconcile(row!));}));
}
