import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {createPrisma} from '@narra/database';
import {assertTestDatabase} from '../../../scripts/test-database';
import {bulkSettings,bulkProfiles,bulkCreatorRoles} from './bulkPublication';

assertTestDatabase(new URL(process.env.DATABASE_URL!));
const db=createPrisma(),tag=`publication-${randomUUID()}`;
let walletId:string,narrativeId:string,creatorId:string;
beforeAll(async()=>{
 walletId=(await db.trackedWallet.create({data:{address:tag}})).id;
 narrativeId=(await db.narrative.create({data:{name:tag,slug:tag}})).id;
 creatorId=(await db.creator.create({data:{platform:'test',handle:tag}})).id;
});
afterAll(async()=>{
 await db.systemSetting.deleteMany({where:{key:{startsWith:tag}}});
 await db.trackedWallet.delete({where:{id:walletId}});
 await db.narrative.delete({where:{id:narrativeId}});
 await db.creator.delete({where:{id:creatorId}});
 await db.$disconnect();
});
it('publishes bounded batches with JSON fidelity, preserves IDs and unmodified profile fields',async()=>{
 const rows=Array.from({length:205},(_,i)=>({key:`${tag}.${i}`,value:{text:"quoted ' ; --",decimal:'0.000000001',nested:[null,true,i]}}));
 const old=await db.walletProfile.create({data:{walletId,score:1,leaderScore:2,typicalEntryMcMin:123,strongestNarrative:'keep',bestPattern:'old'}});
 const role=await db.narrativeCreator.create({data:{narrativeId,creatorId,role:'EARLY_AMPLIFIER'}});
 const settingOps=bulkSettings(db,rows);expect(settingOps).toHaveLength(6);
 await db.$transaction([...settingOps,...bulkProfiles(db,[{walletId,score:80,leaderScore:50,style:'FOLLOWER',medianHoldSeconds:123,bestPattern:null,weakPattern:'loss'}]),...bulkCreatorRoles(db,[{narrativeId,creatorId,role:'ORIGINATOR'}])]);
 expect(await db.systemSetting.count({where:{key:{startsWith:tag}}})).toBe(205);
 expect((await db.systemSetting.findUniqueOrThrow({where:{key:rows[0]!.key}})).value).toEqual(rows[0]!.value);
 const updated=await db.walletProfile.findUniqueOrThrow({where:{walletId}});
 expect(updated).toMatchObject({id:old.id,score:80,leaderScore:50,style:'FOLLOWER',medianHoldSeconds:123,strongestNarrative:'keep',bestPattern:null,weakPattern:'loss'});
 expect(updated.typicalEntryMcMin?.toString()).toBe('123');
 expect(await db.narrativeCreator.findUniqueOrThrow({where:{id:role.id}})).toMatchObject({role:'ORIGINATOR'});
 await db.$transaction(bulkSettings(db,[{key:rows[0]!.key,value:{replacement:true}}]));
 expect((await db.systemSetting.findUniqueOrThrow({where:{key:rows[0]!.key}})).value).toEqual({replacement:true});
});
it('uses the same JSON number serialization as existing Prisma settings writes',async()=>{
 const value={observedDays:2.3077430555555556,profitFactor:15.206435479624151,roi:0.031331012040955196,decimal:'0.000000001'};
 const expected=await db.systemSetting.create({data:{key:`${tag}.codec-old`,value}});
 await db.$transaction(bulkSettings(db,[{key:`${tag}.codec-new`,value}]));
 expect((await db.systemSetting.findUniqueOrThrow({where:{key:`${tag}.codec-new`}})).value).toEqual(expected.value);
});
it('rolls back all batches and profile changes on a later constraint failure',async()=>{
 const key=`${tag}.rollback`;
 const profile=await db.walletProfile.findUniqueOrThrow({where:{walletId}});
 const ops=[...bulkSettings(db,[{key,value:{mustNotPublish:true}}]),...bulkProfiles(db,[{walletId,score:0,leaderScore:0,style:'UNKNOWN',medianHoldSeconds:null,bestPattern:null,weakPattern:null}]),
  db.walletMetric.createMany({data:[{walletId:'nonexistent-'+tag,window:'30D',winRate:0,pnlSol:0,closedTrades:0,avgRoi:0,medianRoi:0,maxDrawdown:0}]})];
 await expect(db.$transaction(ops)).rejects.toThrow();
 expect(await db.systemSetting.findUnique({where:{key}})).toBeNull();
 expect(await db.walletProfile.findUniqueOrThrow({where:{walletId}})).toEqual(profile);
});
it('creates profiles and roles without dropping their schema defaults',async()=>{
 await db.walletProfile.deleteMany({where:{walletId}});await db.narrativeCreator.deleteMany({where:{narrativeId}});
 await db.$transaction([...bulkProfiles(db,[{walletId,score:10,leaderScore:20,style:'UNKNOWN',medianHoldSeconds:null,bestPattern:null,weakPattern:null}]),...bulkCreatorRoles(db,[{narrativeId,creatorId,role:'EARLY_AMPLIFIER'}])]);
 expect(await db.walletProfile.findUniqueOrThrow({where:{walletId}})).toMatchObject({score:10,typicalEntryMcMin:null,typicalEntryMcMax:null,strongestNarrative:null});
 expect(await db.narrativeCreator.count({where:{narrativeId,creatorId}})).toBe(1);
});
