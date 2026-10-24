import {z} from 'zod';
import {TradeabilityQuoteSchema,TRADEABILITY_MAX_AGE_MS} from './tradeability';

const text=z.string().max(20000),date=z.string().datetime({offset:true}),number=z.number().finite().nullable();
/** Read boundary for frozen radar records. Never evaluates a new verdict. */
export const FrozenRadarSafetySchema=z.object({
 policyVersion:z.enum(['radar-safety-v1','radar-safety-v2']),mode:z.enum(['shadow','enforce']),status:z.enum(['PASS','BLOCK','UNKNOWN']),wouldBlock:z.boolean(),
 blockers:z.array(text).max(100),unknowns:z.array(text).max(100),warnings:z.array(text).max(100),
 checks:z.array(z.object({code:text,severity:z.enum(['CRITICAL','WARN']),status:z.enum(['PASS','BLOCK','UNKNOWN','WARN']),value:z.union([text,z.number().finite(),z.boolean(),z.null()]),threshold:z.union([text,z.number().finite(),z.null()]),detail:text.optional()})).min(1).max(100),
 facts:z.object({
  tokenId:text,mint:text,profile:z.enum(['trencher','holder']),route:z.enum(['NARRATIVE','SOCIAL']),matchKind:text,tier:text,score:z.number().finite(),
  metricId:text,holderMetricId:text,riskMetricId:text.nullable(),marketAt:date.nullable(),holdersAt:date.nullable(),riskAt:date.nullable(),
  priceUsd:number,marketCapUsd:number,liquidityUsd:number,volume24hUsd:number,holders:number,top10Pct:number,top10ExLpPct:number,devHoldingPct:number,
  riskFlags:z.array(text),priceGrowth1hPct:number,priceGrowth3hPct:number,narrativeManipulationRisk:number,lpBurnedPct:number,lpLocked:z.boolean().nullable(),
  bundlePct:number,sniperPct:number,insiderPct:number,uniqueBuyers24h:number,uniqueSellers24h:number,priceImpactPct:number,deployerPriorRugs:number,evidenceSource:text.nullable(),evidenceAt:date.nullable(),tradeabilityAt:date.nullable().optional(),tradeability:TradeabilityQuoteSchema.nullable().optional(),
 }),evaluatedAt:date,
}).superRefine((value,ctx)=>{
 const codes=(status:string)=>value.checks.filter(c=>c.status===status&&(status==='WARN'||c.severity==='CRITICAL')).map(c=>c.code).sort();
 const same=(a:string[],b:string[])=>JSON.stringify([...a].sort())===JSON.stringify(b);
 const expected=value.blockers.length?'BLOCK':value.unknowns.length?'UNKNOWN':'PASS';
 if(value.status!==expected||value.wouldBlock!==(value.status!=='PASS')||!same(value.blockers,codes('BLOCK'))||!same(value.unknowns,codes('UNKNOWN'))||!same(value.warnings,codes('WARN')))
  ctx.addIssue({code:z.ZodIssueCode.custom,message:'Inconsistent frozen safety verdict'});
  const q=value.facts.tradeability;
  if(value.policyVersion==='radar-safety-v2'){
   const checks=value.checks.filter(c=>c.code==='TRADEABILITY');
   if(checks.length!==1||checks[0]?.severity!=='CRITICAL')ctx.addIssue({code:z.ZodIssueCode.custom,message:'Missing or duplicated tradeability check'});
  }
 if(value.policyVersion==='radar-safety-v2'&&value.checks.some(c=>c.code==='TRADEABILITY'&&c.status==='PASS')){
  const age=q?Date.parse(value.evaluatedAt)-Date.parse(q.sourceAt):NaN;
  if(!q||q.mint!==value.facts.mint||q.priceImpactPct!==value.facts.priceImpactPct||Date.parse(q.sourceAt)!==Date.parse(value.facts.tradeabilityAt??'')||!Number.isFinite(age)||age<0||age>TRADEABILITY_MAX_AGE_MS)
   ctx.addIssue({code:z.ZodIssueCode.custom,message:'Missing or mismatched frozen quote provenance'});
 }
});
export const RadarSafetyViewSchema=z.object({
 state:z.enum(['RECORDED','NOT_RECORDED','INVALID']),alertId:text.nullable(),alertAt:date.nullable(),
 snapshot:FrozenRadarSafetySchema.nullable(),evidenceStale:z.boolean().nullable(),
});
export type RadarSafetyView=z.infer<typeof RadarSafetyViewSchema>;

/** Age stored evidence for display only; never changes a frozen verdict. */
export function radarSafetyEvidenceStale(snapshot:z.infer<typeof FrozenRadarSafetySchema>,now:number){
 const f=snapshot.facts;
 const stale=(at:string|null|undefined,max:number)=>{const ms=Date.parse(at??'');return !Number.isFinite(ms)||ms>now||now-ms>max;};
 return stale(f.marketAt,15*60000)||stale(f.holdersAt,60*60000)||stale(f.riskAt,60*60000)||(!!f.evidenceSource&&stale(f.evidenceAt,10*60000))||(f.priceImpactPct!=null&&stale(f.tradeabilityAt,TRADEABILITY_MAX_AGE_MS));
}
