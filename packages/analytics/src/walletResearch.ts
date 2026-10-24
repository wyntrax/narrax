import {dedupeEvents,describeReturns} from './stats';

export interface WalletFlowOutcome {
  id:string;tokenId:string;createdAt:Date;side:'BUY'|'SELL';
  measurements:{horizonHours:number;status:string;returnPct:number|null}[];
}
/** Deduplicate overlapping token windows BEFORE selecting known outcomes.
 * BUY/SELL are separate cohorts; neither is executable wallet PnL. */
export function summarizeWalletResearch(rows:WalletFlowOutcome[]){
 return (['BUY','SELL'] as const).map(side=>({side,horizons:[1,4,24].map(hours=>{
  const group=rows.filter(r=>r.side===side).sort((a,b)=>+a.createdAt-+b.createdAt||a.id.localeCompare(b.id));
  const independent=dedupeEvents(group.map(r=>({...r,at:r.createdAt})),hours*3600000);
  const marks=independent.map(r=>({row:r,mark:r.measurements.find(m=>m.horizonHours===hours)}));
  const known=marks.filter(({mark})=>mark?.status==='MEASURED'&&mark.returnPct!==null&&Number.isFinite(mark.returnPct));
  const pending=marks.filter(({mark})=>mark?.status==='PENDING').length;
  const unknown=marks.length-known.length-pending;
  return {hours,raw:group.length,independent:marks.length,overlapExcluded:group.length-marks.length,known:known.length,pending,unknown,unknownRate:known.length+unknown?unknown/(known.length+unknown):null,returns:describeReturns(known.map(({row,mark})=>({tokenId:row.tokenId,ret:mark!.returnPct!})))};
 })}));
}
