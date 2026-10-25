import type {Prisma,PrismaClient} from '@narra/database';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {requireAdminActor} from './common';
import {updateLocalSettings} from './settings';

afterEach(()=>vi.unstubAllEnvs());
const owner={privyUserId:'did:privy:owner',email:'owner@example.com',isAdmin:false};
function transaction(actor:typeof owner|null){
 const findUnique=vi.fn().mockResolvedValue(actor);
 return {tx:{user:{findUnique}} as unknown as Prisma.TransactionClient,findUnique};
}
describe('entitlement transaction admin policy',()=>{
 it('allows an environment-listed Privy user without promoting its database flag',async()=>{
  vi.stubEnv('ADMIN_PRIVY_USER_ID','did:privy:owner');vi.stubEnv('ADMIN_EMAIL','');
  const {tx,findUnique}=transaction(owner);
  await expect(requireAdminActor(tx,'internal-owner-id')).resolves.toBeUndefined();
  expect(findUnique).toHaveBeenCalledWith({where:{id:'internal-owner-id'},select:{isAdmin:true,privyUserId:true,email:true}});
  expect(owner.isAdmin).toBe(false);
 });
 it('allows the configured verified-email identity without a database admin flag',async()=>{
  vi.stubEnv('ADMIN_PRIVY_USER_ID','');vi.stubEnv('ADMIN_EMAIL',' OWNER@EXAMPLE.COM ');
  await expect(requireAdminActor(transaction(owner).tx,'owner')).resolves.toBeUndefined();
 });
 it('rejects stale database admins when an environment allowlist is configured',async()=>{
  vi.stubEnv('ADMIN_PRIVY_USER_ID','did:privy:someone-else');vi.stubEnv('ADMIN_EMAIL','');
  await expect(requireAdminActor(transaction({...owner,isAdmin:true}).tx,'owner')).rejects.toMatchObject({code:'FORBIDDEN',status:403});
 });
 it('rechecks the current allowlist rather than trusting an earlier HTTP decision',async()=>{
  vi.stubEnv('ADMIN_EMAIL','');vi.stubEnv('ADMIN_PRIVY_USER_ID','did:privy:owner');
  const {tx}=transaction(owner);
  await expect(requireAdminActor(tx,'owner')).resolves.toBeUndefined();
  vi.stubEnv('ADMIN_PRIVY_USER_ID','did:privy:someone-else');
  await expect(requireAdminActor(tx,'owner')).rejects.toMatchObject({code:'FORBIDDEN',status:403});
 });
 it('uses the database flag only without configured environment admins and rejects missing users',async()=>{
  vi.stubEnv('ADMIN_PRIVY_USER_ID','');vi.stubEnv('ADMIN_EMAIL','');
  await expect(requireAdminActor(transaction({...owner,isAdmin:true}).tx,'owner')).resolves.toBeUndefined();
  await expect(requireAdminActor(transaction(owner).tx,'owner')).rejects.toMatchObject({code:'FORBIDDEN',status:403});
  await expect(requireAdminActor(transaction(null).tx,'missing')).rejects.toMatchObject({code:'FORBIDDEN',status:403});
 });
 it.each([true,false])('settings save applies the transaction policy and audits only an allowed actor (allowed=%s)',async(allowed)=>{
  vi.stubEnv('ADMIN_PRIVY_USER_ID','did:privy:owner');vi.stubEnv('ADMIN_EMAIL','');
  const upsert=vi.fn().mockResolvedValue({}),create=vi.fn().mockResolvedValue({});
  const tx={
   user:{findUnique:vi.fn().mockResolvedValue(allowed?owner:{...owner,privyUserId:'did:privy:stale-admin',isAdmin:true})},
   $executeRaw:vi.fn().mockResolvedValue(0),
   systemSetting:{findUnique:vi.fn().mockResolvedValue(null),upsert},
   auditLog:{create},
  } as unknown as Prisma.TransactionClient;
  const db={$transaction:vi.fn(async(work:(tx:Prisma.TransactionClient)=>Promise<void>)=>work(tx))} as unknown as PrismaClient;
  const value={'research.chat':{requiredTier:'EARLY_ACCESS',min_entitlement_age_hours:24}};
  const save=updateLocalSettings(db,'actor',{'entitlements.features':value},'Early access rollout');
  if(allowed){
   await expect(save).resolves.toBeUndefined();
   expect(upsert).toHaveBeenCalledWith({where:{key:'entitlements.features'},create:{key:'entitlements.features',value},update:{value}});
   expect(create).toHaveBeenCalledWith({data:{userId:'actor',action:'entitlements.setting_changed',detail:{key:'entitlements.features',before:null,after:value,reason:'Early access rollout'}}});
  }else{
   await expect(save).rejects.toMatchObject({code:'FORBIDDEN',status:403});
   expect(upsert).not.toHaveBeenCalled();expect(create).not.toHaveBeenCalled();
  }
 });
});
