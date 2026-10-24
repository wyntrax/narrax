import type {PrismaClient} from '@narra/database';
import {SOCIAL_RULES,computeNarrativeMetrics,groupBuzzByNarrative,type MentionPoint} from '@narra/narrative';

/** Fail closed on unknown authors, ambiguous tickers and too-small manipulation samples.
 * Related-token attribution intentionally has a lower bar and is left untouched. */
export async function socialOpportunityEvidence(db:PrismaClient,narrativeId:string,tokens:readonly {id:string;mint:string;symbol:string}[],now:Date){
 const since=new Date(+now-SOCIAL_RULES.lookbackHours*3600000);
 const [posts,mentions]=await Promise.all([
  db.narrativeMention.findMany({where:{narrativeId,at:{gte:since,lte:now}},select:{narrativeId:true,platform:true,externalId:true},take:SOCIAL_RULES.maxRows}),
  db.tokenMention.findMany({where:{at:{gte:since,lte:now},creatorId:{not:null},OR:tokens.flatMap(t=>[{refKind:'MINT',ref:t.mint},{refKind:'CASHTAG',ref:t.symbol.toUpperCase()}])},take:SOCIAL_RULES.maxRows}),
 ]);
 const groups=groupBuzzByNarrative(posts,mentions,{...SOCIAL_RULES,minCreators:0,minMentions:0}).get(narrativeId)??[];
 const out=new Map<string,{accounts:number;posts:number;manipulationRisk:number}>();
 for(const t of tokens){
  const points=new Map<string,MentionPoint>();
  for(const g of groups){
   if(g.kind==='MINT'?g.ref!==t.mint:g.ref!==t.symbol.toUpperCase())continue;
   if(g.kind==='CASHTAG'){
    const matches=await db.token.findMany({where:{symbol:{equals:g.ref,mode:'insensitive'},blacklisted:false,metrics:{some:{at:{gte:new Date(+now-24*3600000)}}}},select:{id:true},take:2});
    if(matches.length!==1||matches[0]!.id!==t.id)continue;
   }
   for(const p of g.points)points.set(`${p.platform}:${p.externalId}`,{...p,creator:`${p.platform}:${p.creator}`});
  }
  const sample=[...points.values()],accounts=new Set(sample.map(p=>p.creator)).size;
  if(accounts<SOCIAL_RULES.minCreators||sample.length<SOCIAL_RULES.minMentions)continue;
  const metrics=computeNarrativeMetrics(sample,now);
  if(metrics.organicKnown&&metrics.manipulationRisk<60)out.set(t.id,{accounts,posts:sample.length,manipulationRisk:metrics.manipulationRisk});
 }
 return out;
}
