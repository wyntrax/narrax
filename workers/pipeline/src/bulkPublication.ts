import {randomUUID} from 'node:crypto';
import {Prisma,type PrismaClient} from '@narra/database';

// Keep JSON encoding and individual statements bounded. Callers include every
// returned lazy operation in their existing atomic publication transaction.
export const PUBLICATION_BATCH_SIZE=100;
export function bulkSettings(db:PrismaClient,rows:{key:string;value:Prisma.InputJsonValue}[]):Prisma.PrismaPromise<unknown>[] {
 const ops:Prisma.PrismaPromise<unknown>[]=[];
 for(let i=0;i<rows.length;i+=PUBLICATION_BATCH_SIZE){
  const batch=rows.slice(i,i+PUBLICATION_BATCH_SIZE);
  // These singleton-owned keys have no referencing foreign keys. Replace only
  // this batch, inside the caller's atomic transaction. Use Prisma's JSON codec
  // for byte-equivalent numeric serialization to the former per-row upserts.
  ops.push(db.systemSetting.deleteMany({where:{key:{in:batch.map(r=>r.key)}}}),db.systemSetting.createMany({data:batch}));
 }
 return ops;
}
export type ProfilePublication=Pick<Prisma.WalletProfileUncheckedCreateInput,'walletId'|'score'|'leaderScore'|'style'|'medianHoldSeconds'|'bestPattern'|'weakPattern'>;
export function bulkProfiles(db:PrismaClient,rows:ProfilePublication[]):Prisma.PrismaPromise<unknown>[] {
 const ops:Prisma.PrismaPromise<unknown>[]=[];
 for(let i=0;i<rows.length;i+=PUBLICATION_BATCH_SIZE){
  const payload=JSON.stringify(rows.slice(i,i+PUBLICATION_BATCH_SIZE).map(r=>({id:randomUUID(),...r})));
  ops.push(db.$executeRaw`INSERT INTO "WalletProfile" (id,"walletId",score,"leaderScore",style,"medianHoldSeconds","bestPattern","weakPattern","updatedAt")
   SELECT r.id,r."walletId",r.score,r."leaderScore",r.style::"WalletStyle",r."medianHoldSeconds",r."bestPattern",r."weakPattern",clock_timestamp()
   FROM jsonb_to_recordset(${payload}::jsonb) AS r(id text,"walletId" text,score double precision,"leaderScore" double precision,style text,"medianHoldSeconds" integer,"bestPattern" text,"weakPattern" text)
   ON CONFLICT ("walletId") DO UPDATE SET score=EXCLUDED.score,"leaderScore"=EXCLUDED."leaderScore",style=EXCLUDED.style,
    "medianHoldSeconds"=EXCLUDED."medianHoldSeconds","bestPattern"=EXCLUDED."bestPattern","weakPattern"=EXCLUDED."weakPattern","updatedAt"=EXCLUDED."updatedAt"`);
 }
 return ops;
}
export function bulkCreatorRoles(db:PrismaClient,rows:Pick<Prisma.NarrativeCreatorUncheckedCreateInput,'narrativeId'|'creatorId'|'role'>[]):Prisma.PrismaPromise<unknown>[] {
 const ops:Prisma.PrismaPromise<unknown>[]=[];
 for(let i=0;i<rows.length;i+=PUBLICATION_BATCH_SIZE){
  const payload=JSON.stringify(rows.slice(i,i+PUBLICATION_BATCH_SIZE).map(r=>({id:randomUUID(),...r})));
  ops.push(db.$executeRaw`INSERT INTO "NarrativeCreator" (id,"narrativeId","creatorId",role)
   SELECT r.id,r."narrativeId",r."creatorId",r.role::"CreatorRole"
   FROM jsonb_to_recordset(${payload}::jsonb) AS r(id text,"narrativeId" text,"creatorId" text,role text)
   ON CONFLICT ("narrativeId","creatorId") DO UPDATE SET role=EXCLUDED.role`);
 }
 return ops;
}
