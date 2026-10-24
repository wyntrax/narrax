import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import type {PrismaClient} from '@narra/database';
import {describe,expect,it,vi} from 'vitest';
import {exportSPKI,generateKeyPair} from 'jose';
import {registerRuntimeRoutes} from './runtime-routes';
import {createRuntimeSettings,invalidateRuntimeSettings} from './runtime-settings';
import {registerHttpHardening} from './http';
import {registerEntitlementRoutes} from './entitlements/routes';

async function setup(){
  let rows:{key:string;value:unknown}[]=[];
  const db={systemSetting:{findMany:vi.fn(async()=>rows)},user:{findUnique:vi.fn(async({where}:{where:{id?:string;privyUserId?:string}})=>({id:where.id??where.privyUserId,isAdmin:(where.id??where.privyUserId)==='admin'}))}} as unknown as PrismaClient;
  const settings=createRuntimeSettings(db,{PRIVY_APP_ID:'env-app',CORS_ORIGINS:'https://env.example'});
  const app=Fastify();await registerHttpHardening(app,{corsOrigins:['https://env.example'],resolveCorsOrigins:settings.origins});await app.register(rateLimit,{global:false});
  const check=vi.fn(async()=>({ok:true as const}));
  registerRuntimeRoutes(app,settings,{db,verifier:{verify:async token=>({privyUserId:token})}},check);
  registerEntitlementRoutes(app,{db,verifier:{verify:async token=>({privyUserId:token})}});
  return {app,db,check,set:(value:typeof rows)=>{rows=value;invalidateRuntimeSettings(db);}};
}
describe('runtime routes',()=>{
  it('rejects non-boolean override flags at the admin write boundary',async()=>{
    const {app}=await setup();try{
      const response=await app.inject({url:'/v1/admin/entitlements/settings',method:'PUT',headers:{authorization:'Bearer admin'},payload:{settings:{'auth.privy_app_id':'app'},reason:'test',overridePrivyCheck:'true'}});
      expect(response.statusCode).toBe(400);expect(response.json().error).toBe('INVALID_INPUT');
    }finally{await app.close();}
  });
  it('serves only the effective public app ID, is cacheable, and rate-limits even cached reads',async()=>{
    const {app,set}=await setup();try{
      const first=await app.inject('/v1/public-config');expect(first.json()).toEqual({privyAppId:'env-app'});expect(first.headers['cache-control']).toBe('public, max-age=0, must-revalidate');
      set([{key:'auth.privy_app_id',value:'db-app'}]);expect((await app.inject('/v1/public-config')).json()).toEqual({privyAppId:'db-app'});
      for(let i=2;i<60;i++)expect((await app.inject('/v1/public-config')).statusCode).toBe(200);
      expect((await app.inject('/v1/public-config')).statusCode).toBe(429);
    }finally{await app.close();}
  });
  it('requires admin for reading effective values and checking Privy; check does not save',async()=>{
    const {app,check,db}=await setup();try{
      for(const url of ['/v1/admin/runtime-settings','/v1/admin/runtime-settings/check-privy']){
        const method=url.endsWith('check-privy')?'POST':'GET';
        expect((await app.inject({url,method})).statusCode).toBe(401);
        expect((await app.inject({url,method,headers:{authorization:'Bearer member'}})).statusCode).toBe(403);
      }
      const headers={authorization:'Bearer admin'};
      expect((await app.inject({url:'/v1/admin/runtime-settings',headers})).json().privyAppId).toEqual({value:'env-app',source:'environment'});
      const payload={appId:'app',verificationKey:await exportSPKI((await generateKeyPair('ES256')).publicKey)};
      expect((await app.inject({url:'/v1/admin/runtime-settings/check-privy',method:'POST',headers,payload})).json()).toEqual({ok:true});
      expect(check).toHaveBeenCalledOnce();expect(await db.systemSetting.findMany()).toEqual([]);
    }finally{await app.close();}
  });
  it('updates HTTP CORS without restarting and retains env origins after extras are removed',async()=>{
    const {app,set}=await setup();try{
      const cors=async(origin:string)=>(await app.inject({url:'/v1/public-config',headers:{origin}})).headers['access-control-allow-origin'];
      expect(await cors('https://extra.example')).toBeUndefined();
      set([{key:'api.cors_origins',value:['https://extra.example']}]);expect(await cors('https://extra.example')).toBe('https://extra.example');
      expect(await cors('https://env.example')).toBe('https://env.example');
      set([{key:'api.cors_origins',value:[]}]);expect(await cors('https://extra.example')).toBeUndefined();expect(await cors('https://env.example')).toBe('https://env.example');
    }finally{await app.close();}
  });
  it('returns a value-free, non-cacheable error when config cannot be read',async()=>{
    const {app,set}=await setup();try{
      set([{key:'auth.privy_app_id',value:23}]);const result=await app.inject('/v1/public-config');
      expect(result.statusCode).toBe(503);expect(result.headers['cache-control']).toBe('no-store');expect(result.json().error).toBe('RUNTIME_SETTINGS_UNAVAILABLE');
    }finally{await app.close();}
  });
});
