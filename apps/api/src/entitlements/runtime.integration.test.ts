import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {exportSPKI,generateKeyPair} from 'jose';
import {createPrisma,Prisma} from '@narra/database';
import {updateLocalSettings,resetAuthSettings} from './settings';
import {createRuntimeSettings} from '../runtime-settings';
import {grantEarlyAccess} from './grants';
import {entitlementTrace} from './access';
import type {checkPrivyKey} from '../privy-key';

import { assertTestDatabase } from '../../../../scripts/test-database';
const url=new URL(process.env.DATABASE_URL??'invalid:');
assertTestDatabase(url);
const db=createPrisma(url.toString()),tag=`runtime-${randomUUID()}`;
const keys=['auth.privy_app_id','auth.privy_verification_key','api.cors_origins','early_access.enabled','early_access.seat_cap','early_access.invite_required'];
let saved:Awaited<ReturnType<typeof db.systemSetting.findMany>>,pem:string;
const admin=`${tag}-admin`,member=`${tag}-member`,newcomer=`${tag}-new`,reason=tag;
beforeAll(async()=>{
  saved=await db.systemSetting.findMany({where:{key:{in:keys}}});pem=await exportSPKI((await generateKeyPair('ES256')).publicKey);
  await db.systemSetting.deleteMany({where:{key:{in:keys}}});
  for(const id of [admin,member,newcomer])await db.user.create({data:{id,privyUserId:id,isAdmin:id===admin}});
  for(const [index,id] of [member,newcomer].entries())await db.linkedWallet.create({data:{userId:id,chain:'solana',address:`${tag}-${index}`,verifiedAt:new Date()}});
});
afterAll(async()=>{
  if(saved){
    await db.auditLog.deleteMany({where:{OR:[{userId:{in:[admin,member,newcomer]}},{detail:{path:['reason'],equals:reason}}]}});
    await db.user.deleteMany({where:{id:{in:[admin,member,newcomer]}}});
    await db.systemSetting.deleteMany({where:{key:{in:keys}}});
    for(const row of saved)await db.systemSetting.create({data:{...row,value:row.value===null?Prisma.JsonNull:row.value}});
  }
  await db.$disconnect();
});
describe('audited runtime settings on scratch Postgres',()=>{
  const input=()=>({'auth.privy_app_id':'runtime-app','auth.privy_verification_key':pem});
  it('refuses mismatches and unreachable Privy without writing any part of a batch',async()=>{
    for(const error of ['PRIVY_KEY_MISMATCH','PRIVY_UNREACHABLE'] as const){
      await expect(updateLocalSettings(db,admin,{...input(),'api.cors_origins':['https://new.example']},reason,{checkPrivy:async()=>({ok:false,error})})).rejects.toMatchObject({code:error});
      expect(await db.systemSetting.count({where:{key:{in:keys}}})).toBe(0);
      expect(await db.auditLog.count({where:{userId:admin}})).toBe(0);
    }
  });
  it('requires admin, a reason and an allowed key',async()=>{
    const checkPrivy=vi.fn<typeof checkPrivyKey>().mockResolvedValue({ok:true});
    await expect(updateLocalSettings(db,member,input(),reason,{checkPrivy})).rejects.toMatchObject({code:'FORBIDDEN'});
    await expect(updateLocalSettings(db,admin,input(),' ',{checkPrivy})).rejects.toMatchObject({code:'INVALID_INPUT'});
    await expect(updateLocalSettings(db,admin,{'EXECUTOR_MAX_SOL':1},reason)).rejects.toMatchObject({code:'INVALID_INPUT'});
    expect(checkPrivy).not.toHaveBeenCalled();
  });
  it('audits explicit overrides and invalidates cached values, but cannot override malformed keys',async()=>{
    const runtime=createRuntimeSettings(db,{PRIVY_APP_ID:'env-app'});await runtime.read();
    await updateLocalSettings(db,admin,input(),reason,{overridePrivyCheck:true,checkPrivy:async()=>({ok:false,error:'PRIVY_UNREACHABLE'})});
    expect((await runtime.read()).privyAppId).toEqual({value:'runtime-app',source:'database'});
    const audits=await db.auditLog.findMany({where:{userId:admin}});
    expect(audits).toHaveLength(2);
    for(const row of audits)expect(row.detail).toMatchObject({before:null,reason,overridePrivyCheck:true,verification:'PRIVY_UNREACHABLE'});
    await expect(updateLocalSettings(db,admin,input(),reason,{overridePrivyCheck:true,checkPrivy:async()=>({ok:false,error:'INVALID_PRIVY_KEY'})})).rejects.toMatchObject({code:'INVALID_PRIVY_KEY'});
  });
  it('checks the effective pair for a single-field update, and atomically resets both auth keys with an audit',async()=>{
    const checkPrivy=vi.fn<typeof checkPrivyKey>().mockResolvedValue({ok:true});
    await updateLocalSettings(db,admin,{'auth.privy_app_id':'next-app'},reason,{checkPrivy});
    // Compare booleans so a failing assertion cannot print key material.
    expect(checkPrivy.mock.calls.length).toBe(1);expect(checkPrivy.mock.calls[0]?.[0]==='next-app').toBe(true);expect(checkPrivy.mock.calls[0]?.[1]===pem.trim()).toBe(true);
    const runtime=createRuntimeSettings(db,{PRIVY_APP_ID:'env-app'});await runtime.read();
    await resetAuthSettings(db,reason);expect((await runtime.read()).privyAppId.source).toBe('environment');
    expect(await db.systemSetting.count({where:{key:{startsWith:'auth.'}}})).toBe(0);
    expect(await db.auditLog.count({where:{action:'entitlements.setting_reset',detail:{path:['reason'],equals:reason}}})).toBe(2);
  });
  it('closing early access rejects a new join but preserves the existing grant and effective tier',async()=>{
    const at=new Date();
    await updateLocalSettings(db,admin,{'early_access.enabled':true,'early_access.seat_cap':100,'early_access.invite_required':false},reason);
    const grant=await grantEarlyAccess(db,member,{tier:'EARLY_ACCESS',validUntil:null,reason},null,at);
    await updateLocalSettings(db,admin,{'early_access.enabled':false},reason);
    await expect(grantEarlyAccess(db,newcomer,{tier:'EARLY_ACCESS',validUntil:null,reason},null,at)).rejects.toMatchObject({code:'EARLY_ACCESS_DISABLED'});
    expect((await db.accessGrant.findUniqueOrThrow({where:{id:grant.id}})).status).toBe('ACTIVE');
    const trace=await entitlementTrace(db,member,at);
    expect(trace.effectiveTier).toBe('EARLY_ACCESS');expect(trace.grants.find(g=>g.id===grant.id)).toMatchObject({eligible:true,reasonCode:'ACTIVE'});
  });
});
