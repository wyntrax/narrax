import {randomUUID} from 'node:crypto';
import {afterAll,describe,expect,it} from 'vitest';
import {createPrisma} from '@narra/database';
import {assertTestDatabase} from '../../../scripts/test-database';
import {createEarlyRadarAlert,trackEarlyRadarOutcomes,earlyRadarReport} from './earlyRadarTracking';
import {resolveTokens} from './tokenResolution';
import {FixtureMarketData,WSOL_MINT,snapshot} from '@narra/market-data';
import {refreshMarketData} from './marketData';

const url=new URL(process.env.DATABASE_URL??'invalid:');assertTestDatabase(url);
const db=createPrisma(url.toString()),tag=`radar-${randomUUID()}`,at=new Date('2026-10-16T00:00:00Z'),H=3600000;
const tokens:string[]=[],narratives:string[]=[];
async function fixture(){
  const token=await db.token.create({data:{mint:`${tag}-${tokens.length}`,symbol:'RADAR',name:'Radar test',createdOnChainAt:new Date(+at-24*H)}});tokens.push(token.id);
  const metric=await db.tokenMetric.create({data:{tokenId:token.id,priceUsd:1,marketCapUsd:40000,liquidityUsd:12000,volume24hUsd:50000,at}});
  const holders=await db.tokenHolderMetric.create({data:{tokenId:token.id,holders:500,top10Pct:20,devHoldingPct:2,smartWalletHolders:5,at}});
  await db.systemSetting.create({data:{key:`research.market.${token.id}`,value:{metricId:metric.id,source:'dexscreener',marketCapIsFdv:false}}});
  return {token,metric,holders,input:{tokenId:token.id,mint:token.mint,profile:'trencher' as const,tier:'WATCH' as const,route:'SOCIAL' as const,matchKind:'MINT' as const,score:60,metricId:metric.id,holderMetricId:holders.id,title:'Research alert',body:'Research only'}};
}
async function metrics(tokenId:string,hours:number,priceUsd:number){return db.tokenMetric.create({data:{tokenId,at:new Date(+at+hours*H),priceUsd,marketCapUsd:priceUsd*40000,liquidityUsd:12000,volume24hUsd:50000}});}
afterAll(async()=>{
  const observations=await db.tokenMetric.findMany({where:{tokenId:{in:tokens}},select:{id:true}});
  const alerts=await db.alert.findMany({where:{refId:{in:[...tokens,...narratives]}},select:{id:true}});
  await db.systemSetting.deleteMany({where:{key:{in:[
    ...observations.map(m=>`research.marketMetric.${m.id}`),
    ...alerts.map(a=>`research.radarSafety.${a.id}`),
    ...tokens.flatMap(id=>['trencher','holder'].map(p=>`research.radarSafetyBlocked.${id}.${p}`)),
  ]}}});
  await db.alert.deleteMany({where:{refId:{in:[...tokens,...narratives]}}});
  await db.narrative.deleteMany({where:{id:{in:narratives}}});
  await db.token.deleteMany({where:{id:{in:tokens}}});
  await db.systemSetting.deleteMany({where:{key:{in:tokens.map(id=>`research.market.${id}`)}}});
  await db.$disconnect();
});
describe('early radar frozen outcomes on isolated PostgreSQL',()=>{
  it.each(['market-old','holders-old','market-future','holders-future','unverified','wrong-market','wrong-holder','zero-price'] as const)('rejects %s atomically without an alert, outcome or cooldown',async mode=>{
    const {token,metric,holders,input}=await fixture();
    const reasons={ 'market-old':'MARKET_STALE','holders-old':'HOLDERS_STALE','market-future':'MARKET_FUTURE','holders-future':'HOLDERS_FUTURE',unverified:'MARKET_UNVERIFIED','wrong-market':'MARKET_MISSING','wrong-holder':'HOLDERS_MISSING','zero-price':'MARKET_INVALID' };
    if(mode==='market-old')await db.tokenMetric.update({where:{id:metric.id},data:{at:new Date(+at-5*H)}});
    if(mode==='holders-old')await db.tokenHolderMetric.update({where:{id:holders.id},data:{at:new Date(+at-5*H)}});
    if(mode==='market-future')await db.tokenMetric.update({where:{id:metric.id},data:{at:new Date(+at+1)}});
    if(mode==='holders-future')await db.tokenHolderMetric.update({where:{id:holders.id},data:{at:new Date(+at+1)}});
    if(mode==='zero-price')await db.tokenMetric.update({where:{id:metric.id},data:{priceUsd:0}});
    if(mode==='unverified')await db.systemSetting.delete({where:{key:`research.market.${token.id}`}});
    const other=mode==='wrong-market'||mode==='wrong-holder'?await fixture():null;
    const request={...input,metricId:mode==='wrong-market'?other!.metric.id:input.metricId,holderMetricId:mode==='wrong-holder'?other!.holders.id:input.holderMetricId};
    expect(await createEarlyRadarAlert(db,request,at)).toEqual({created:false,reason:reasons[mode]});
    expect(await db.alert.count({where:{refId:token.id}})).toBe(0);
    expect(await db.earlyRadarOutcome.count({where:{tokenId:token.id}})).toBe(0);
    await db.tokenMetric.update({where:{id:metric.id},data:{at,priceUsd:1}});
    await db.tokenHolderMetric.update({where:{id:holders.id},data:{at}});
    const value={metricId:metric.id,source:'dexscreener',marketCapIsFdv:false};
    await db.systemSetting.upsert({where:{key:`research.market.${token.id}`},create:{key:`research.market.${token.id}`,value},update:{value}});
    expect(await createEarlyRadarAlert(db,input,at)).toMatchObject({created:true});
  });
  it('cannot substitute newer rows for the stale metric and holder records that were scored',async()=>{
    const {token,metric,holders,input}=await fixture();
    await metrics(token.id,5,2);
    await db.tokenHolderMetric.create({data:{tokenId:token.id,holders:500,top10Pct:20,at:new Date(+at+5*H)}});
    expect(await createEarlyRadarAlert(db,input,new Date(+at+5*H))).toEqual({created:false,reason:'MARKET_STALE'});
    await db.tokenMetric.update({where:{id:metric.id},data:{at:new Date(+at+5*H)}});
    expect(await createEarlyRadarAlert(db,{...input,holderMetricId:holders.id},new Date(+at+5*H))).toEqual({created:false,reason:'HOLDERS_STALE'});
  });
  it('uses publication wall time by default instead of accepting an old run timestamp',async()=>{
    const {input}=await fixture();
    expect(await createEarlyRadarAlert(db,input)).toEqual({created:false,reason:'MARKET_STALE'});
  });
  it('retains exact per-observation source evidence across an intervening refresh',async()=>{
    const {token,metric,input}=await fixture();
    await db.systemSetting.create({data:{key:`research.marketMetric.${metric.id}`,value:{metricId:metric.id,source:'dexscreener',marketCapIsFdv:false}}});
    const newer=await metrics(token.id,.01,2);
    await db.systemSetting.update({where:{key:`research.market.${token.id}`},data:{value:{metricId:newer.id,source:'dexscreener',marketCapIsFdv:true}}});
    expect(await createEarlyRadarAlert(db,input,new Date(+at+60000))).toMatchObject({created:true});
    expect(await db.earlyRadarOutcome.findFirst({where:{tokenId:token.id}})).toMatchObject({entryMetricId:metric.id,entrySource:'dexscreener',entryPriceUsd:1,entryMarketCapIsFdv:false});
  });
  it('atomically captures one alert and three horizons across concurrent discovery routes',async()=>{
    const {token,metric,input}=await fixture();
    const results=await Promise.all([createEarlyRadarAlert(db,input,at),createEarlyRadarAlert(db,{...input,route:'NARRATIVE',matchKind:'NAME'},at)]);
    expect(results.filter(r=>r.created)).toHaveLength(1);
    expect(results.find(r=>!r.created)).toEqual({created:false,reason:'DUPLICATE'});
    const alerts=await db.alert.findMany({where:{refId:token.id},include:{earlyRadarOutcome:{include:{measurements:true}}}});
    expect(alerts).toHaveLength(1);const o=alerts[0]!.earlyRadarOutcome!;
    expect(o).toMatchObject({entryMetricId:metric.id,entryAt:at,entryPriceUsd:1,entryMarketCapUsd:40000,entryMarketCapIsFdv:false,entrySource:'dexscreener',score:60});
    expect(o.measurements.map(m=>m.horizonHours).sort((a,b)=>a-b)).toEqual([1,24,168]);
    await metrics(token.id,.1,9);
    expect((await db.earlyRadarOutcome.findUniqueOrThrow({where:{id:o.id}})).entryPriceUsd).toBe(1);
  });
  it('freezes a shadow safety snapshot and blocks only when enforcement is explicit',async()=>{
    const prior=process.env.RADAR_SAFETY_MODE;
    try{
      const shadow=await fixture();
      process.env.RADAR_SAFETY_MODE='shadow';
      const created=await createEarlyRadarAlert(db,shadow.input,at);
      expect(created).toMatchObject({created:true});
      if(!created.created)throw Error('shadow alert was not created');
      expect(created.safety).toMatchObject({policyVersion:'radar-safety-v2',mode:'shadow',status:'UNKNOWN'});
      expect(created.safety?.unknowns).toEqual(expect.arrayContaining(['TOP10_EX_LP','LP_CONTROL','BUNDLE_SNIPER_INSIDER','ORGANIC_EVIDENCE','RISK_EVIDENCE','TRADEABILITY']));
      const alert=await db.alert.findFirstOrThrow({where:{refId:shadow.token.id}});
      expect(alert.body).toMatch(/Safety evidence: UNKNOWN/);
      expect(alert.body).toMatch(/Shadow mode: recorded, not enforced/);
      const snapshot=await db.systemSetting.findUniqueOrThrow({where:{key:`research.radarSafety.${alert.id}`}});
      expect(snapshot.value).toMatchObject({status:'UNKNOWN',mode:'shadow',facts:expect.objectContaining({tokenId:shadow.token.id,profile:'trencher'})});

      const blocked=await fixture();
      process.env.RADAR_SAFETY_MODE='enforce';
      const enforcement=await createEarlyRadarAlert(db,blocked.input,at);
      expect(enforcement).toMatchObject({created:false,reason:'SAFETY_BLOCKED',safety:expect.objectContaining({status:'UNKNOWN'})});
      expect(await db.alert.count({where:{refId:blocked.token.id}})).toBe(0);
      expect(await db.earlyRadarOutcome.count({where:{tokenId:blocked.token.id}})).toBe(0);
      const decision=await db.systemSetting.findUniqueOrThrow({where:{key:`research.radarSafetyBlocked.${blocked.token.id}.trencher`}});
      expect(decision.value).toMatchObject({status:'UNKNOWN',mode:'enforce'});
    }finally{
      if(prior===undefined)delete process.env.RADAR_SAFETY_MODE;else process.env.RADAR_SAFETY_MODE=prior;
    }
  });
  it('allows a complete safety PASS under explicit enforcement',async()=>{
    const prior=process.env.RADAR_SAFETY_MODE;
    const {token,input}=await fixture();
    await db.tokenRiskMetric.create({data:{tokenId:token.id,riskScore:0,flags:[],at}});
    process.env.RADAR_SAFETY_MODE='enforce';
    try{
      const created=await createEarlyRadarAlert(db,{...input,safetyContext:{
        priceGrowth1hPct:10,priceGrowth3hPct:20,narrativeManipulationRisk:20,top10ExLpPct:15,
        lpBurnedPct:100,lpLocked:null,bundlePct:0,sniperPct:0,insiderPct:0,
        uniqueBuyers24h:100,uniqueSellers24h:90,priceImpactPct:1,deployerPriorRugs:0,tradeabilityAt:at.toISOString(),tradeability:testTradeability(token.mint,at),
      }},at);
      expect(created).toMatchObject({created:true,safety:expect.objectContaining({status:'PASS',blockers:[],unknowns:[],facts:expect.objectContaining({tradeabilityAt:at.toISOString(),priceImpactPct:1})})});
      if(!created.created)throw Error('complete safety evidence was withheld');
      expect(created.safety?.checks.find(c=>c.code==='TRADEABILITY')).toMatchObject({status:'PASS',value:1});
      expect(created.safety?.warnings).toContain('AUTHORITY_NOT_PROVEN');
      expect((await db.alert.findFirstOrThrow({where:{refId:token.id}})).body).toMatch(/Safety evidence: PASS/);
    }finally{
      if(prior===undefined)delete process.env.RADAR_SAFETY_MODE;else process.env.RADAR_SAFETY_MODE=prior;
    }
  });
  it('records a confirmed concentration blocker in shadow without changing publication',async()=>{
    const prior=process.env.RADAR_SAFETY_MODE;
    const {token,holders,input}=await fixture();
    await db.tokenHolderMetric.update({where:{id:holders.id},data:{top10Pct:40}});
    process.env.RADAR_SAFETY_MODE='shadow';
    try{
      const created=await createEarlyRadarAlert(db,input,at);
      expect(created).toMatchObject({created:true,safety:expect.objectContaining({status:'BLOCK',blockers:expect.arrayContaining(['TOP10_CONCENTRATION'])})});
      expect(await db.alert.count({where:{refId:token.id}})).toBe(1);
    }finally{
      if(prior===undefined)delete process.env.RADAR_SAFETY_MODE;else process.env.RADAR_SAFETY_MODE=prior;
    }
  });
  it('measures 1h, 24h and 7d prices/caps without lookahead and leaves terminal results immutable',async()=>{
    const {token,input}=await fixture();await createEarlyRadarAlert(db,input,at);
    const alert=await db.alert.findFirstOrThrow({where:{refId:token.id}}),only=[alert.id];
    const p1=await metrics(token.id,1,2);await metrics(token.id,24,3);await metrics(token.id,168,.5);
    expect((await trackEarlyRadarOutcomes(db,{only,now:()=>new Date(+at+H-1)})).measured).toBe(0);
    expect((await trackEarlyRadarOutcomes(db,{only,now:()=>new Date(+at+H)})).observed).toBe(1);
    await db.tokenMetric.update({where:{id:p1.id},data:{priceUsd:99}});
    expect((await trackEarlyRadarOutcomes(db,{only,now:()=>new Date(+at+168*H)})).observed).toBe(2);
    const result=await db.earlyRadarOutcome.findUniqueOrThrow({where:{alertId:alert.id},include:{measurements:{orderBy:{horizonHours:'asc'}}}});
    expect(result.measurements.map(m=>[m.horizonHours,m.returnPct,m.marketCapUsd])).toEqual([[1,100,80000],[24,200,120000],[168,-50,20000]]);
    expect((await trackEarlyRadarOutcomes(db,{only,now:()=>new Date(+at+169*H)})).measured).toBe(0);
    expect(await db.opportunity.count({where:{tokenId:token.id}})).toBe(0);
    expect(await db.order.count({where:{tokenId:token.id}})).toBe(0);
    expect(await db.position.count({where:{tokenId:token.id}})).toBe(0);
  });
  it('finalizes unavailable windows as unknown and does not backfill winners later',async()=>{
    const {token,input}=await fixture();await createEarlyRadarAlert(db,{...input,matchKind:'TICKER_ONLY'},at);
    const alert=await db.alert.findFirstOrThrow({where:{refId:token.id}}),only=[alert.id];
    expect((await trackEarlyRadarOutcomes(db,{only,now:()=>new Date(+at+169*H)})).unknown).toBe(3);
    await metrics(token.id,1,5);await trackEarlyRadarOutcomes(db,{only,now:()=>new Date(+at+170*H)});
    const row=await db.earlyRadarOutcome.findUniqueOrThrow({where:{alertId:alert.id},include:{measurements:true}});
    expect(row.measurements.every(m=>m.returnPct===null&&m.status==='UNKNOWN'&&m.unknownReason==='NO_HORIZON_PRICE')).toBe(true);
    const report=await earlyRadarReport(db,at,at);
    const group=report.groups.find(g=>g.matchKind==='TICKER_ONLY')!;
    expect(group.horizons[0]).toMatchObject({unknown:1,known:0,returns:{sufficient:false,mean:null}});
  });
  it('retains legacy alerts without inventing their original entry, tier or route',async()=>{
    const {token}=await fixture();
    const alert=await db.alert.create({data:{kind:'EARLY_RADAR_HOLDER',priority:'IMPORTANT',title:'old from social buzz',body:'STRONG score 99',refType:'TOKEN',refId:token.id,createdAt:at}});
    await metrics(token.id,1,2);
    await trackEarlyRadarOutcomes(db,{only:[alert.id],now:()=>new Date(+at+2*H)});
    const outcome=await db.earlyRadarOutcome.findUniqueOrThrow({where:{alertId:alert.id},include:{measurements:true}});
    expect(outcome).toMatchObject({profile:'holder',tier:'UNKNOWN',route:'UNKNOWN',entryPriceUsd:null,entryUnknownReason:'LEGACY_NO_SNAPSHOT'});
    expect(outcome.measurements.find(m=>m.horizonHours===1)).toMatchObject({priceUsd:2,marketCapUsd:80000,returnPct:null,status:'UNKNOWN',unknownReason:'NO_ENTRY_PRICE'});
  });
  it('captures narrative-found candidates below the main floors without creating an opportunity',async()=>{
    const {token}=await fixture();const word=`radar${randomUUID().replace(/[^a-z]/g,'')}`;
    await db.token.update({where:{id:token.id},data:{symbol:word.toUpperCase(),name:word}});
    await db.tokenHolderMetric.create({data:{tokenId:token.id,holders:500,top10Pct:20,devHoldingPct:2,smartWalletHolders:5,at}});
    const narrative=await db.narrative.create({data:{name:word,slug:word,stage:'ACCELERATING',score:95,velocity:500,organicScore:95,firstDetectedAt:new Date(+at-24*H)}});narratives.push(narrative.id);
    await resolveTokens(db,at);
    const outcomes=await db.earlyRadarOutcome.findMany({where:{tokenId:token.id}});
    expect(outcomes.length).toBeGreaterThan(0);
    expect(outcomes.every(o=>o.route==='NARRATIVE'&&o.matchKind==='NAME'&&o.entryPriceUsd===1)).toBe(true);
    expect(await db.opportunity.count({where:{tokenId:token.id}})).toBe(0);
  },20_000); // This resolver scans the shared isolated fixture database, like the multi-pass case below.

  it('reports stale narrative evidence without publishing, then allows newly refreshed inputs',async()=>{
    const {token,metric,holders}=await fixture();const word=`fresh${randomUUID().replace(/[^a-z]/g,'')}`;
    await db.token.update({where:{id:token.id},data:{symbol:word.toUpperCase(),name:word}});
    const narrative=await db.narrative.create({data:{name:word,slug:word,stage:'ACCELERATING',score:95,velocity:500,organicScore:95,firstDetectedAt:new Date(+at-24*H)}});narratives.push(narrative.id);
    await db.tokenMetric.update({where:{id:metric.id},data:{at:new Date(+at-5*H)}});
    expect((await resolveTokens(db,at)).evidenceSkipped.MARKET_STALE).toBeGreaterThan(0);
    expect(await db.earlyRadarOutcome.count({where:{tokenId:token.id}})).toBe(0);
    await db.tokenMetric.update({where:{id:metric.id},data:{at}});
    await db.tokenHolderMetric.update({where:{id:holders.id},data:{at:new Date(+at-5*H)}});
    expect((await resolveTokens(db,at)).evidenceSkipped.HOLDERS_STALE).toBeGreaterThan(0);
    expect(await db.earlyRadarOutcome.count({where:{tokenId:token.id}})).toBe(0);
    await db.tokenHolderMetric.update({where:{id:holders.id},data:{at}});
    await resolveTokens(db,at);
    expect(await db.earlyRadarOutcome.count({where:{tokenId:token.id}})).toBeGreaterThan(0);
   // Scans accumulate in the shared isolated test database; three full resolution passes exceed the default.
  },20_000);

  it('keeps pricing a token with an open measurement even when the per-run cap would starve it',async()=>{
    // Two older, plain tokens fill a cap of 2 first (the refresh set is id-ordered). The radar token is created last, so it has the highest id.
    const fillers:{mint:string}[]=[];
    for(let i=0;i<2;i++){
      const t=await db.token.create({data:{mint:`${tag}-fill-${i}`,symbol:'FILL',name:'Filler'}});tokens.push(t.id);fillers.push(t);
      await db.tokenMetric.create({data:{tokenId:t.id,priceUsd:1,marketCapUsd:40000,liquidityUsd:12000,volume24hUsd:50000,at}});
    }
    const {token,input}=await fixture();
    expect(await createEarlyRadarAlert(db,input,at)).toMatchObject({created:true});
    // A shared test database keeps older PENDING measurements from earlier runs, and the priority step takes the nearest-due
    // first. Clear them so this token's open measurement is the only one competing, which is what this case is about.
    const outcome=await db.earlyRadarOutcome.findFirstOrThrow({where:{tokenId:token.id}});
    await db.earlyRadarMeasurement.deleteMany({where:{status:'PENDING',outcomeId:{not:outcome.id}}});
    const now=new Date(+at+2*H);
    const quotes=new FixtureMarketData({snapshots:[snapshot(WSOL_MINT,{symbol:'SOL',name:'Wrapped SOL',priceUsd:150}),snapshot(token.mint,{symbol:'RADAR',priceUsd:2,marketCapUsd:80000}),...fillers.map(f=>snapshot(f.mint,{symbol:'FILL',priceUsd:1}))]});
    const summary=await refreshMarketData(db,{quotes,info:null,launches:null},now,{maxTokens:2});
    expect(summary.tokensConsidered).toBeLessThanOrEqual(2);
    // Newly priced at `now`: the open 24h/7d measurements will have a stored price to read.
    expect(await db.tokenMetric.count({where:{tokenId:token.id,at:now}})).toBe(1);
  });
});
import {testTradeability} from '../../../scripts/test-tradeability';
