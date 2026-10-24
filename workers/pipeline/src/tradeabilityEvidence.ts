import {z} from 'zod';
import type {Prisma,PrismaClient} from '@narra/database';
import {isSolanaAddress,TradeabilityQuoteSchema,TRADEABILITY_USDC_MINT,TRADEABILITY_MAX_AGE_MS,type TradeabilityQuote} from '@narra/shared';
import {JupiterClient,type Quote,type QuoteRequest} from '@narra/solana';
import {radarSafetyModeFromEnv} from '@narra/token-intel';

/** Canonical USDC mint. The ticket is priced in dollars so it does not drift with SOL. */
export const USDC_MINT=TRADEABILITY_USDC_MINT;
export const TRADEABILITY_PREFIX='research.radarTradeability.';
export const TRADEABILITY_TICKET_USD=50;
export const TRADEABILITY_TTL_MS=TRADEABILITY_MAX_AGE_MS;
export const TRADEABILITY_MAX_PER_RUN=3;
const USDC_DECIMALS=6,SLIPPAGE_BPS=50,DEFAULT_SPACING_MS=500;

/** A quote is evidence of executable depth at one time. It is not a price prediction or a safety verdict. */
export type TradeabilityEvidence=TradeabilityQuote;
export interface TradeabilitySource{
 /** Reset the per-run request budget. Call once at the start of each scan. */
 begin():void;
 get(mint:string,now?:Date):Promise<TradeabilityEvidence|null>;
}
interface QuoteLike{getQuote(req:QuoteRequest):Promise<Quote>}
export interface TradeabilitySourceOptions{
 quote?:QuoteLike;
 enabled?:boolean;
 maxPerRun?:number;
 cacheTtlMs?:number;
 spacingMs?:number;
}

const Cache=TradeabilityQuoteSchema;
const Route=z.object({routePlan:z.array(z.object({swapInfo:z.object({ammKey:z.string().min(1),inputMint:z.string().min(1),outputMint:z.string().min(1),inAmount:z.string().regex(/^[1-9]\d*$/),outAmount:z.string().regex(/^[1-9]\d*$/)})})).min(1).max(100)});
const cacheKey=(mint:string)=>`${TRADEABILITY_PREFIX}${mint}`;
const fresh=(at:string,now:Date,ttlMs:number)=>{const ms=Date.parse(at);return Number.isFinite(ms)&&ms<=+now&&+now-ms<=ttlMs;};

/**
 * Bounded tradeability enrichment for candidates that already reached the radar safety gate.
 * It asks Jupiter for a $50 USDC buy so the recorded price impact is a real executable quote,
 * never a liquidity-derived guess. Missing, failed, stale or over-budget lookups stay null
 * (UNKNOWN in the gate). Quotes are cached per mint for ten minutes and never retried into a
 * different result.
 */
export function makeTradeabilitySource(db:PrismaClient,opts:TradeabilitySourceOptions={}):TradeabilitySource|null{
 const enabled=opts.enabled??(process.env.RADAR_TRADEABILITY_EVIDENCE?.trim().toLowerCase()!=='off');
 if(!enabled||radarSafetyModeFromEnv()==='off')return null;
 const quote=opts.quote??new JupiterClient({timeoutMs:6000,priceImpactFormat:'fraction'});
 const configured=Number(opts.maxPerRun??process.env.RADAR_TRADEABILITY_MAX_PER_RUN??TRADEABILITY_MAX_PER_RUN);
 const maxPerRun=Number.isInteger(configured)&&configured>=1&&configured<=10?configured:TRADEABILITY_MAX_PER_RUN;
 const cacheTtlMs=opts.cacheTtlMs??TRADEABILITY_TTL_MS,spacingMs=opts.spacingMs??DEFAULT_SPACING_MS;
 const ticketAmount=BigInt(TRADEABILITY_TICKET_USD)*10n**BigInt(USDC_DECIMALS);
  let used=0,lastCall:number|null=null;
  let pacing=Promise.resolve();
 const inflight=new Map<string,Promise<TradeabilityEvidence|null>>();

 const readCache=async(mint:string,now:Date):Promise<TradeabilityEvidence|null>=>{
  const row=await db.systemSetting.findUnique({where:{key:cacheKey(mint)}});
  const parsed=Cache.safeParse(row?.value);
  if(!parsed.success||parsed.data.mint!==mint||!fresh(parsed.data.sourceAt,now,cacheTtlMs))return null;
  return parsed.data;
 };
 const fetchOne=async(mint:string,at?:Date):Promise<TradeabilityEvidence|null>=>{
   // Serialize start slots across different mints (and scan boundaries), not just duplicate-mint requests.
   const slot=pacing.then(async()=>{
    const wait=lastCall===null?0:spacingMs-(Date.now()-lastCall);
    if(wait>0)await new Promise(resolve=>setTimeout(resolve,wait));
    lastCall=Date.now();
   });
   pacing=slot.catch(()=>{});
   await slot;
  let result:Quote;
  try{
   result=await quote.getQuote({inputMint:USDC_MINT,outputMint:mint,amount:ticketAmount,slippageBps:SLIPPAGE_BPS});
  }catch{return null;}
  const route=Route.safeParse(result.raw);
  if(result.inputMint!==USDC_MINT||result.outputMint!==mint||!route.success||!Number.isFinite(+result.fetchedAt))return null;
  const parsed=Cache.safeParse({version:1,mint,source:'jupiter',sourceAt:result.fetchedAt.toISOString(),direction:'BUY',inputMint:result.inputMint,inAmount:result.inAmount,outAmount:result.outAmount,otherAmountThreshold:result.otherAmountThreshold,slippageBps:result.slippageBps,routeCount:route.data.routePlan.length,ticketUsdc:TRADEABILITY_TICKET_USD,priceImpactPct:result.priceImpactPct});
  if(!parsed.success||!fresh(parsed.data.sourceAt,at??new Date(),cacheTtlMs))return null;
  const value=parsed.data;
  await db.systemSetting.upsert({where:{key:cacheKey(mint)},create:{key:cacheKey(mint),value:value as unknown as Prisma.InputJsonValue},update:{value:value as unknown as Prisma.InputJsonValue}});
  return value;
 };

 return {
   begin(){used=0;},
  async get(mint,at){
   if(!isSolanaAddress(mint)||mint===USDC_MINT)return null;
   const now=at??new Date(),pending=inflight.get(mint);
   if(pending)return pending;
   const p=(async()=>{
    const cached=await readCache(mint,now);
    if(cached)return cached;
    if(used>=maxPerRun)return null;
    used++;
    return fetchOne(mint,at);
   })().catch(()=>null);
   inflight.set(mint,p);
   try{return await p;}finally{if(inflight.get(mint)===p)inflight.delete(mint);}
  },
 };
}
