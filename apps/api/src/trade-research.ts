import {createHash} from 'node:crypto';
import type {PrismaClient} from '@narra/database';
import {canReadFeature} from './entitlements/access';
import {marketEvidence,marketTokenImage,observation} from './marketEvidence';

const n=(value:{toString():string})=>Number(value.toString());
export const fresh=(at:Date,now:Date,ms:number)=>+at<=+now&&+now-+at<=ms;
/** Stored, source-backed evidence only. No generated recommendation and no provider collection side effects. */
export async function tradeResearch(db:PrismaClient,userId:string,mint:string,now:Date){
 const [token,narrativeAccess,smartAccess]=await Promise.all([
  db.token.findUnique({where:{mint},include:{metrics:{orderBy:{at:'desc'},take:1},holders:{orderBy:{at:'desc'},take:1},risk:{orderBy:{at:'desc'},take:1}}}),
  canReadFeature(db,userId,'research.narratives',now),canReadFeature(db,userId,'research.smart_money',now),
 ]);
 const metric=token?.metrics[0],holder=token?.holders[0],risk=token?.risk[0];
 const evidence=token?(await marketEvidence(db,[token.id])).get(token.id):undefined;
 const source=token?observation(evidence,metric?.id,now):null;
 const market=metric&&source?{at:metric.at.toISOString(),source:source.source,priceUsd:n(metric.priceUsd),liquidityUsd:n(metric.liquidityUsd),volume24hUsd:n(metric.volume24hUsd),marketCapUsd:n(metric.marketCapUsd),marketCapIsFdv:source.marketCapIsFdv,fresh:!source.stale&&fresh(metric.at,now,900000)}:null;
 const holders=holder?{at:holder.at.toISOString(),count:holder.holders,top10Pct:holder.top10Pct,fresh:fresh(holder.at,now,3600000)}:null;
 const riskEvidence=risk?{at:risk.at.toISOString(),flags:risk.flags,fresh:fresh(risk.at,now,3600000)}:null;
 const [narratives,flows]=await Promise.all([
  token&&narrativeAccess?db.narrativeTokenRelation.findMany({where:{tokenId:token.id,relation:{notIn:['UNRELATED','SUSPICIOUS']}},take:5,orderBy:[{confidence:'desc'},{id:'asc'}],include:{narrative:{select:{slug:true,name:true}}}}):[],
  token&&smartAccess?db.walletResearchSignal.findMany({where:{tokenId:token.id},orderBy:[{createdAt:'desc'},{id:'desc'}],take:5}):[],
 ]);
 const buyBlockers:string[]=[],notes:string[]=[];
 if(!token)buyBlockers.push('NOT_INDEXED');
 if(token?.blacklisted)buyBlockers.push('BLACKLISTED');
 if(!market?.fresh||!(market.priceUsd>0))buyBlockers.push('MARKET_MISSING');
 if(!market||market.liquidityUsd<20000)buyBlockers.push('LIQUIDITY_LOW');
 if(!holders?.fresh||holders.count<50)buyBlockers.push('HOLDERS_MISSING');
 if(!riskEvidence?.fresh)buyBlockers.push('RISK_MISSING');
 if(risk?.flags.some(f=>/HONEYPOT|FREEZE|MINT_AUTHORITY/i.test(f)))buyBlockers.push('RISK_FLAGS');
 if(holders?.fresh&&holders.top10Pct>50)notes.push('CONCENTRATED');
 if(!narratives.length)notes.push(narrativeAccess?'NARRATIVE_MISSING':'NARRATIVE_LOCKED');
 if(!flows.some(f=>fresh(f.createdAt,now,3600000)))notes.push(smartAccess?'SMART_MONEY_MISSING':'SMART_MONEY_LOCKED');
 const data={mint,symbol:token?.symbol??mint.slice(0,6),name:token?.name??'',buyBlockers,notes,market,holders,risk:riskEvidence,narratives:{access:narrativeAccess,items:narratives.map(r=>({...r.narrative,relation:r.relation,confidence:r.confidence}))},smartMoney:{access:smartAccess,items:flows.map(f=>({id:f.id,at:f.createdAt.toISOString(),side:f.side,wallets:f.walletCount,entities:f.independentEntities,netSol:n(f.netFlowSol),fresh:fresh(f.createdAt,now,3600000)}))}};
 // Decorative artwork is not approval evidence; a CDN change must not alter the review ticket hash.
 return {data:{...data,imageUrl:marketTokenImage(evidence,mint)},hash:createHash('sha256').update(JSON.stringify(data)).digest('hex')};
}
