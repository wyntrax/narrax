import {randomUUID} from 'node:crypto';
import {afterAll,expect,it} from 'vitest';
import {createPrisma,type Prisma} from '@narra/database';
import {evaluateRadarSafety,type RadarSafetyFacts} from '@narra/token-intel';
import {assertTestDatabase} from '../../../scripts/test-database';
import {radarSafetyViews} from './radarSafetyView';
import {testTradeability} from '../../../scripts/test-tradeability';

assertTestDatabase(new URL(process.env.DATABASE_URL??'invalid:'));
const db=createPrisma(),tag=`safety-view-${randomUUID()}`,now=new Date('2026-10-23T12:00:00Z');
const token={id:`${tag}-token`,mint:`${tag}-mint`};
const facts:RadarSafetyFacts={tokenId:token.id,mint:token.mint,profile:'trencher',route:'NARRATIVE',matchKind:'NAME',tier:'WATCH',score:60,metricId:'metric',holderMetricId:'holders',riskMetricId:'risk',priceUsd:.01,marketCapUsd:50000,liquidityUsd:20000,volume24hUsd:30000,holders:500,top10Pct:20,devHoldingPct:0,riskFlags:[],marketAt:now,holdersAt:now,riskAt:now,priceGrowth1hPct:0,priceGrowth3hPct:0,narrativeManipulationRisk:0,top10ExLpPct:10,lpBurnedPct:100,bundlePct:0,sniperPct:0,insiderPct:0,uniqueBuyers24h:100,uniqueSellers24h:80,priceImpactPct:1,deployerPriorRugs:0};
const alerts:string[]=[],keys:string[]=[];
async function alert(at:Date,snapshot:unknown,userId?:string){
 const a=await db.alert.create({data:{kind:'EARLY_RADAR_TRENCHER',priority:'WATCH',refType:'TOKEN',refId:token.id,title:'Test',body:'Stored text',createdAt:at,userId}});alerts.push(a.id);
 if(snapshot!==undefined){const key=`research.radarSafety.${a.id}`;keys.push(key);await db.systemSetting.create({data:{key,value:snapshot as Prisma.InputJsonValue}});}
 return a;
}
afterAll(async()=>{await db.systemSetting.deleteMany({where:{key:{in:keys}}});await db.alert.deleteMany({where:{id:{in:alerts}}});await db.user.deleteMany({where:{privyUserId:tag}});await db.$disconnect();});
it('reads exact frozen evidence, ages it without rescoring, and ignores private and future alerts',async()=>{
  const snapshot=evaluateRadarSafety({...facts,tradeabilityAt:now,tradeability:testTradeability(token.mint,now)},now),a=await alert(now,snapshot);
 const user=await db.user.create({data:{privyUserId:tag}});
 await alert(new Date(+now+1000),{secret:'private'},user.id);
 await alert(new Date(+now+86400000),{status:'PASS'});
 const fresh=(await radarSafetyViews(db,[token,token],new Date(+now+2000))).get(token.id)!;
 expect(fresh).toMatchObject({state:'RECORDED',alertId:a.id,evidenceStale:false,snapshot});
 const older=(await radarSafetyViews(db,[token],new Date(+now+16*60000))).get(token.id)!;
 expect(older.evidenceStale).toBe(true);expect(older.snapshot).toEqual(snapshot);expect(older.snapshot?.status).toBe('PASS');
 expect(JSON.stringify(older)).not.toContain('private');
});
it('does not borrow an older snapshot for a legacy alert or a token with no alert',async()=>{
 const a=await alert(new Date(+now+20*60000),undefined);
 const map=await radarSafetyViews(db,[token,{id:'missing',mint:'missing'}],new Date(+now+21*60000));
 expect(map.get(token.id)).toMatchObject({state:'NOT_RECORDED',alertId:a.id,snapshot:null});
 expect(map.get('missing')).toMatchObject({state:'NOT_RECORDED',alertId:null,snapshot:null});
});
it('ages a tradeability quote separately from the other evidence',async()=>{
 const at=new Date(+now+40*60000);
  await alert(at,evaluateRadarSafety({...facts,marketAt:at,holdersAt:at,riskAt:at,tradeabilityAt:at,tradeability:testTradeability(token.mint,at)},at));
 expect((await radarSafetyViews(db,[token],new Date(+now+49*60000))).get(token.id)?.evidenceStale).toBe(false);
 expect((await radarSafetyViews(db,[token],new Date(+now+51*60000))).get(token.id)?.evidenceStale).toBe(true);
});
it('rejects mismatched identities, fabricated PASS summaries and malformed snapshots without falling back',async()=>{
 let seq=30;
 for(const invalid of [{status:'PASS'},{...evaluateRadarSafety({...facts,mint:'wrong'},now)},{...evaluateRadarSafety({...facts,top10Pct:90},now),status:'PASS',wouldBlock:false}]){
  const at=new Date(+now+seq++*60000);await alert(at,{...invalid,evaluatedAt:at.toISOString()});
  expect((await radarSafetyViews(db,[token],at)).get(token.id)).toMatchObject({state:'INVALID',snapshot:null});
 }
});
it('requires v2 quote provenance while retaining historical v1 verdicts without rescoring',async()=>{
 const at=new Date(+now+50*60000);
 const good=evaluateRadarSafety({...facts,marketAt:at,holdersAt:at,riskAt:at,tradeabilityAt:at,tradeability:testTradeability(token.mint,at)},at);
 const missingQuote={...good,facts:{...good.facts,tradeability:null,tradeabilityAt:null}};
 await alert(at,missingQuote);
 expect((await radarSafetyViews(db,[token],at)).get(token.id)?.state).toBe('INVALID');
 const later=new Date(+at+1000),legacy={...missingQuote,policyVersion:'radar-safety-v1',evaluatedAt:later.toISOString()};
 await alert(later,legacy);
 expect((await radarSafetyViews(db,[token],later)).get(token.id)).toMatchObject({state:'RECORDED',evidenceStale:true,snapshot:{status:'PASS',policyVersion:'radar-safety-v1'}});
});

it('rejects unrecognized policies and removed critical quote checks',async()=>{
 const at=new Date(+now+60*60000),good=evaluateRadarSafety({...facts,tradeabilityAt:at,tradeability:testTradeability(token.mint,at),marketAt:at,holdersAt:at,riskAt:at},at);
 const variants=[{...good,policyVersion:'radar-safety-v3',facts:{...good.facts,tradeability:null}},
  {...good,checks:good.checks.filter(c=>c.code!=='TRADEABILITY')}];
 for(const [index,value] of variants.entries()){
  const time=new Date(+at+index*1000);await alert(time,{...value,evaluatedAt:time.toISOString()});
  expect((await radarSafetyViews(db,[token],time)).get(token.id)?.state).toBe('INVALID');
 }
});
