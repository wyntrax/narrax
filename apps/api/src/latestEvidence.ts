import type {PrismaClient} from '@narra/database';
import type {z} from 'zod';
import {LATEST_EVIDENCE_MAX_AGE_MS,LatestEvidenceSchema,RugcheckObservationSchema,TradeabilityQuoteSchema,type LatestEvidence} from '@narra/shared';
import {evidence as MarketEvidenceSchema} from './marketEvidence';

const numeric=(v:unknown)=>v==null?null:Number(String(v));
const timestamp=(at:Date)=>Number.isFinite(+at)?at.toISOString():'';
/** Latest stored observations only. No provider requests, verdict calculation or historical snapshot writes. */
export async function latestEvidenceViews(db:PrismaClient,tokens:{id:string;mint:string}[],now:Date){
 const unique=[...new Map(tokens.map(t=>[t.id,t])).values()];
 if(!unique.length)return new Map<string,LatestEvidence>();
 const keys=unique.flatMap(t=>[`research.market.${t.id}`,`research.radarSafetyEvidence.${t.mint}`,`research.radarTradeability.${t.mint}`]);
 const [rows,settings]=await Promise.all([
  db.token.findMany({where:{id:{in:unique.map(t=>t.id)}},select:{id:true,mint:true,metrics:{orderBy:{at:'desc'},take:1},holders:{orderBy:{at:'desc'},take:1},risk:{orderBy:{at:'desc'},take:1}}}),
  db.systemSetting.findMany({where:{key:{in:keys}},select:{key:true,value:true}}),
 ]);
 const values=new Map(settings.map(r=>[r.key,r.value])),byId=new Map(rows.map(r=>[r.id,r]));
 const missing=()=>({state:'MISSING' as const,at:null,source:null,data:null});
 const invalid=()=>({...missing(),state:'INVALID' as const});
  const record=<T extends z.ZodTypeAny>(schema:T,data:unknown,at:string,source:string|null,maxAge:number,verified=true):z.infer<T>=>{
  const ms=Date.parse(at);
  if(!Number.isFinite(ms)||ms>+now)return invalid();
   const parsed=schema.safeParse({data,at,source,state:!verified?'UNVERIFIED':+now-ms>maxAge?'STALE':'FRESH'});
   return parsed.success?parsed.data:invalid();
 };
 return new Map(unique.map(t=>{
  const row=byId.get(t.id),m=row?.metrics[0],h=row?.holders[0],r=row?.risk[0];
  const marketMeta=MarketEvidenceSchema.safeParse(values.get(`research.market.${t.id}`));
  const marketVerified=marketMeta.success&&marketMeta.data.mint===t.mint&&marketMeta.data.metricId===m?.id&&Date.parse(marketMeta.data.at)===Number(m?.at);
  const rugKey=`research.radarSafetyEvidence.${t.mint}`,quoteKey=`research.radarTradeability.${t.mint}`;
  const rug=RugcheckObservationSchema.safeParse(values.get(rugKey)),quote=TradeabilityQuoteSchema.safeParse(values.get(quoteKey));
   const shape=LatestEvidenceSchema.shape,age=LATEST_EVIDENCE_MAX_AGE_MS;
   const value:LatestEvidence={checkedAt:now.toISOString(),
    market:m?record(shape.market,{priceUsd:numeric(m.priceUsd),marketCapUsd:numeric(m.marketCapUsd),liquidityUsd:numeric(m.liquidityUsd)},timestamp(m.at),marketVerified?'dexscreener':null,age.market,marketVerified):missing(),
    holders:h?record(shape.holders,{holders:h.holders,top10Pct:h.top10Pct,devHoldingPct:h.devHoldingPct},timestamp(h.at),'stored-holder-metric',age.holders):missing(),
    risk:r?record(shape.risk,{flags:r.flags},timestamp(r.at),'stored-risk-metric',age.risk):missing(),
    rugcheck:!values.has(rugKey)?missing():rug.success&&rug.data.mint===t.mint?record(shape.rugcheck,rug.data,rug.data.sourceAt,'rugcheck',age.rugcheck):invalid(),
    tradeability:!values.has(quoteKey)?missing():quote.success&&quote.data.mint===t.mint?record(shape.tradeability,quote.data,quote.data.sourceAt,'jupiter',age.tradeability):invalid(),
  };
   // Validate each observation independently: one bad holder row must not erase a valid quote.
   return [t.id,value] as const;
 }));
}
