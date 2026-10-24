import {dedupeEvents,describeReturns} from './stats';

/** Operational starting values, not tuned on outcomes. Gross price returns are not executable PnL. */
export const EARLY_OUTCOME_RULES={horizonsHours:[1,24,168] as const,entryToleranceMs:15*60000,horizonToleranceMs:30*60000,recheckMs:5*60000};
export interface RadarPoint {id:string;at:Date;priceUsd:number|null;marketCapUsd:number|null;marketCapIsFdv:boolean|null;source:string|null}
export const positive=(n:number|null|undefined):number|null=>n!=null&&Number.isFinite(n)&&n>0?n:null;
export function radarEntry(point:RadarPoint|null,alertedAt:Date){
  const valid=point&&Number.isFinite(+point.at)&&+point.at<=+alertedAt&&+alertedAt-+point.at<=EARLY_OUTCOME_RULES.entryToleranceMs;
  return {entryMetricId:valid?point.id:null,entryAt:valid?point.at:null,entryPriceUsd:valid?positive(point.priceUsd):null,entryMarketCapUsd:valid?positive(point.marketCapUsd):null,entryMarketCapIsFdv:valid?point.marketCapIsFdv:null,entrySource:valid?point.source:null,entryUnknownReason:valid&&positive(point.priceUsd)!=null?null:'NO_FRESH_ENTRY_PRICE'};
}
export function measureEarlyHorizon(entryPriceUsd:number|null,targetAt:Date,point:RadarPoint|null,now:Date){
  const usable=point&&+point.at>=+targetAt&&+point.at<=+targetAt+EARLY_OUTCOME_RULES.horizonToleranceMs&&+point.at<=+now&&positive(point.priceUsd)!=null;
  const empty={metricId:null,observedAt:null,priceUsd:null,marketCapUsd:null,marketCapIsFdv:null,source:null,returnPct:null};
  if(!usable)return {...empty,status:+now>=+targetAt+EARLY_OUTCOME_RULES.horizonToleranceMs?'UNKNOWN':'PENDING',unknownReason:+now>=+targetAt+EARLY_OUTCOME_RULES.horizonToleranceMs?'NO_HORIZON_PRICE':'NOT_YET'};
  const entry=positive(entryPriceUsd),ret=entry==null?null:(point.priceUsd!/entry-1)*100;
  const returnPct=ret!=null&&Number.isFinite(ret)?ret:null;
  return {metricId:point.id,observedAt:point.at,priceUsd:point.priceUsd,marketCapUsd:positive(point.marketCapUsd),marketCapIsFdv:point.marketCapIsFdv,source:point.source,returnPct,status:returnPct==null?'UNKNOWN':'OBSERVED',unknownReason:returnPct==null?'NO_ENTRY_PRICE':null};
}

export interface RadarReportEvent {id:string;tokenId:string;alertedAt:Date;profile:string;tier:string;route:string;matchKind:string;entryPriceUsd:number|null;measurements:{horizonHours:number;status:string;returnPct:number|null}[]}
/** Deduplicate BEFORE dropping unknowns: a later winning alert cannot replace an earlier missing outcome. */
export function summarizeEarlyRadar(events:RadarReportEvent[]){
  const groups=new Map<string,RadarReportEvent[]>();
  for(const event of [...events].sort((a,b)=>+a.alertedAt-+b.alertedAt||a.id.localeCompare(b.id))){
    const key=JSON.stringify([event.profile,event.tier,event.route,event.matchKind]);
    groups.set(key,[...(groups.get(key)??[]),event]);
  }
  return [...groups.entries()].map(([key,rows])=>{
    const [profile,tier,route,matchKind]=JSON.parse(key) as string[];
    return {profile,tier,route,matchKind,alerts:rows.length,horizons:EARLY_OUTCOME_RULES.horizonsHours.map(hours=>{
      const independent=dedupeEvents(rows.map(r=>({...r,at:r.alertedAt})),hours*3600000);
      const measurements=independent.map(e=>({e,m:e.measurements.find(m=>m.horizonHours===hours)}));
      const known=measurements.filter(x=>x.m?.status==='OBSERVED'&&x.m.returnPct!=null&&Number.isFinite(x.m.returnPct));
      const pending=measurements.filter(x=>x.m?.status==='PENDING').length;
      const unknown=measurements.length-known.length-pending;
      return {hours,raw:rows.length,independent:independent.length,overlapExcluded:rows.length-independent.length,known:known.length,pending,unknown,unknownRate:known.length+unknown?unknown/(known.length+unknown):null,returns:describeReturns(known.map(x=>({tokenId:x.e.tokenId,ret:x.m!.returnPct!})))};
    })};
  });
}
