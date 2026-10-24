import {Prisma,type PrismaClient} from '@narra/database';
import {FrozenRadarSafetySchema,radarSafetyEvidenceStale,type RadarSafetyView} from '@narra/shared';

const empty=():RadarSafetyView=>({state:'NOT_RECORDED',alertId:null,alertAt:null,snapshot:null,evidenceStale:null});
/** Latest public radar alert per requested token. No rescoring, provider calls or legacy backfill. */
export async function radarSafetyViews(db:PrismaClient,tokens:{id:string;mint:string}[],now:Date){
 const unique=[...new Map(tokens.map(t=>[t.id,t])).values()];
 const result=new Map(unique.map(t=>[t.id,empty()]));
 if(!unique.length)return result;
 const alerts=await db.$queryRaw<{id:string;refId:string;createdAt:Date;kind:string}[]>(Prisma.sql`
  SELECT DISTINCT ON ("refId") "id", "refId", "createdAt", "kind" FROM "Alert"
  WHERE "userId" IS NULL AND "refType" = 'TOKEN' AND "refId" IN (${Prisma.join(unique.map(t=>t.id))})
   AND "kind" IN ('EARLY_RADAR_TRENCHER','EARLY_RADAR_HOLDER') AND "createdAt" <= ${now}
  ORDER BY "refId", "createdAt" DESC, "id" DESC
 `);
 const rows=alerts.length?await db.systemSetting.findMany({where:{key:{in:alerts.map(a=>`research.radarSafety.${a.id}`)}}}):[];
 const values=new Map(rows.map(r=>[r.key,r.value]));
 const mints=new Map(unique.map(t=>[t.id,t.mint]));
 for(const alert of alerts){
  const key=`research.radarSafety.${alert.id}`,base={...empty(),alertId:alert.id,alertAt:alert.createdAt.toISOString()};
  if(!values.has(key)){result.set(alert.refId,base);continue;}
  const parsed=FrozenRadarSafetySchema.safeParse(values.get(key));
  if(!parsed.success||parsed.data.facts.tokenId!==alert.refId||parsed.data.facts.mint!==mints.get(alert.refId)||Date.parse(parsed.data.evaluatedAt)!==+alert.createdAt||parsed.data.facts.profile!==(alert.kind==='EARLY_RADAR_TRENCHER'?'trencher':'holder')){
   result.set(alert.refId,{...base,state:'INVALID'});continue;
  }
   const snapshot=parsed.data;
   const evidenceStale=radarSafetyEvidenceStale(snapshot,+now);
  result.set(alert.refId,{...base,state:'RECORDED',snapshot,evidenceStale});
 }
 return result;
}
