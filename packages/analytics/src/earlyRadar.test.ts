import {describe,it,expect} from 'vitest';
import {radarEntry,measureEarlyHorizon,summarizeEarlyRadar,EARLY_OUTCOME_RULES,type RadarPoint,type RadarReportEvent} from './earlyRadar';
const at=new Date('2026-10-16T00:00:00Z'),hour=3600000;
const point=(offset=0,priceUsd:number|null=1,marketCapUsd:number|null=40000):RadarPoint=>({id:`p${offset}`,at:new Date(+at+offset),priceUsd,marketCapUsd,marketCapIsFdv:false,source:'fixture'});
describe('early radar outcome measurement',()=>{
  it('captures only finite fresh entry observations at or before the alert',()=>{
    expect(radarEntry(point(),at)).toMatchObject({entryPriceUsd:1,entryMarketCapUsd:40000,entryUnknownReason:null});
    for(const p of [null,point(1),point(-16*60000),point(0,NaN),point(0,0)])expect(radarEntry(p,at).entryPriceUsd).toBeNull();
    expect(radarEntry(point(0,1,null),at)).toMatchObject({entryPriceUsd:1,entryMarketCapUsd:null});
  });
  it('measures all three horizons without future or carried-forward readings',()=>{
    for(const h of EARLY_OUTCOME_RULES.horizonsHours){const target=new Date(+at+h*hour);
      expect(measureEarlyHorizon(1,target,point(h*hour,1.25,50000),target)).toMatchObject({status:'OBSERVED',returnPct:25,marketCapUsd:50000});
      expect(measureEarlyHorizon(1,target,point(h*hour,1.25),new Date(+target-1))).toMatchObject({status:'PENDING',returnPct:null});
      expect(measureEarlyHorizon(1,target,point(h*hour-1),new Date(+target+31*60000))).toMatchObject({status:'UNKNOWN',returnPct:null});
    }
  });
  it('distinguishes pending, missing horizons, missing entry, and measured zero return',()=>{
    const target=new Date(+at+hour);
    expect(measureEarlyHorizon(1,target,null,target)).toMatchObject({status:'PENDING'});
    expect(measureEarlyHorizon(1,target,null,new Date(+target+30*60000))).toMatchObject({status:'UNKNOWN',unknownReason:'NO_HORIZON_PRICE'});
    expect(measureEarlyHorizon(null,target,point(hour),target)).toMatchObject({status:'UNKNOWN',priceUsd:1,marketCapUsd:40000,returnPct:null,unknownReason:'NO_ENTRY_PRICE'});
    expect(measureEarlyHorizon(1,target,point(hour),target)).toMatchObject({status:'OBSERVED',returnPct:0});
    expect(measureEarlyHorizon(1,target,point(hour,Infinity),target).returnPct).toBeNull();
  });
  it('preserves FDV basis and unknown market cap independently of price',()=>{
    expect(measureEarlyHorizon(1,at,{...point(0,2,null),marketCapIsFdv:true},at)).toMatchObject({returnPct:100,marketCapUsd:null,marketCapIsFdv:true});
  });
});
const event=(id:string,offset=0,status='OBSERVED',ret:number|null=10):RadarReportEvent=>({id,tokenId:'one-token',alertedAt:new Date(+at+offset),profile:'trencher',tier:'WATCH',route:'SOCIAL',matchKind:'MINT',entryPriceUsd:1,measurements:[{horizonHours:24,status,returnPct:ret}]});
describe('early radar cohort reports',()=>{
  it('does not replace unknown or pending observations with later winners',()=>{
    const group=summarizeEarlyRadar([event('a',0,'UNKNOWN',null),event('b',6*hour),event('c',25*hour,'PENDING',null)])[0]!;
    expect(group.horizons[1]).toMatchObject({raw:3,independent:2,overlapExcluded:1,known:0,unknown:1,pending:1,unknownRate:1,returns:{n:0,mean:null,sufficient:false}});
  });
  it('keeps profile, tier, source route and ticker-only attribution separate',()=>{
    const base=event('a');const groups=summarizeEarlyRadar([base,{...base,id:'b',profile:'holder'},{...base,id:'c',tier:'STRONG'},{...base,id:'d',route:'NARRATIVE',matchKind:'NAME'},{...base,id:'e',matchKind:'TICKER_ONLY'}]);
    expect(groups).toHaveLength(5);for(const g of groups)expect(g.horizons[1]!.returns.sufficient).toBe(false);
  });
  it('uses seven-day overlap and the existing independent-sample evidence gates',()=>{
    const rows=Array.from({length:30},(_,i)=>({...event(`${i}`,i*hour),tokenId:`token-${i}`,measurements:[{horizonHours:168,status:'OBSERVED',returnPct:i}]}));
    expect(summarizeEarlyRadar(rows)[0]!.horizons[2]).toMatchObject({known:30,returns:{n:30,distinctTokens:30,sufficient:true}});
    expect(summarizeEarlyRadar([event('a'),event('b',24*hour)])[0]!.horizons[2]!.independent).toBe(1);
  });
});
