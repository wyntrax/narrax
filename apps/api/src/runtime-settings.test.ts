import type {PrismaClient} from '@narra/database';
import {exportSPKI,generateKeyPair,SignJWT} from 'jose';
import {describe,expect,it,vi} from 'vitest';
import {createRuntimeSettings,invalidateRuntimeSettings} from './runtime-settings';
import {createRuntimePrivyVerifier} from './auth';
import {SETTING_SCHEMAS} from './entitlements/settings';

function fixture(){
  let rows:{key:string;value:unknown}[]=[];
  const findMany=vi.fn(async()=>rows);
  const db={systemSetting:{findMany}} as unknown as PrismaClient;
  return {db,findMany,set:(value:typeof rows)=>{rows=value;}};
}
describe('runtime settings',()=>{
  it('merges/deduplicates CORS origins while preserving environment origins and reporting each source',async()=>{
    const f=fixture();f.set([{key:'api.cors_origins',value:['https://extra.example','https://env.example']}]);
    const runtime=createRuntimeSettings(f.db,{PRIVY_APP_ID:'env-app',CORS_ORIGINS:'https://env.example'});
    expect(await runtime.origins()).toEqual(['https://env.example','https://extra.example']);
    expect((await runtime.read()).privyAppId).toEqual({value:'env-app',source:'environment'});
    f.set([{key:'api.cors_origins',value:[]}]);invalidateRuntimeSettings(f.db);
    expect(await runtime.origins()).toEqual(['https://env.example']);
  });
  it('coalesces reads, refreshes at 20 seconds, and invalidates on writes in the same process',async()=>{
    const f=fixture();let at=0;const runtime=createRuntimeSettings(f.db,{PRIVY_APP_ID:'env'},()=>at);
    await Promise.all([runtime.read(),runtime.read(),runtime.read()]);expect(f.findMany).toHaveBeenCalledTimes(1);
    f.set([{key:'auth.privy_app_id',value:'db'}]);at=19999;expect((await runtime.read()).privyAppId.value).toBe('env');
    at=20000;expect((await runtime.read()).privyAppId).toEqual({value:'db',source:'database'});
    f.set([]);invalidateRuntimeSettings(f.db);expect((await runtime.read()).privyAppId.source).toBe('environment');
    f.findMany.mockRejectedValueOnce(Error('offline'));at=40000;await expect(runtime.read()).rejects.toThrow('offline');
    expect((await runtime.read()).privyAppId.value).toBe('env');
  });
  it('does not let an in-flight old read repopulate the cache after invalidation',async()=>{
    const f=fixture();let release!:(value:{key:string;value:unknown}[])=>void;
    f.findMany.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
    const runtime=createRuntimeSettings(f.db,{PRIVY_APP_ID:'env'}), pending=runtime.read();
    f.set([{key:'auth.privy_app_id',value:'new'}]);invalidateRuntimeSettings(f.db);release([]);
    expect((await pending).privyAppId.value).toBe('new');
  });
  it('verifies using database auth then immediately falls back to env after reset',async()=>{
    const f=fixture(),env=await generateKeyPair('ES256'),db=await generateKeyPair('ES256');
    f.set([{key:'auth.privy_app_id',value:'db-app'},{key:'auth.privy_verification_key',value:await exportSPKI(db.publicKey)}]);
    const verifier=createRuntimePrivyVerifier(createRuntimeSettings(f.db,{PRIVY_APP_ID:'env-app',PRIVY_VERIFICATION_KEY:await exportSPKI(env.publicKey)}));
    const token=(key:typeof env.privateKey,aud:string)=>new SignJWT({}).setProtectedHeader({alg:'ES256'}).setSubject('did:privy:test').setAudience(aud).setIssuer('privy.io').setExpirationTime('5m').sign(key);
    const dbToken=await token(db.privateKey,'db-app'),envToken=await token(env.privateKey,'env-app');
    expect(await verifier.verify(dbToken)).toEqual({privyUserId:'did:privy:test'});await expect(verifier.verify(envToken)).rejects.toThrow();
    f.set([]);invalidateRuntimeSettings(f.db);expect(await verifier.verify(envToken)).toEqual({privyUserId:'did:privy:test'});await expect(verifier.verify(dbToken)).rejects.toThrow();
    expect((await verifier.verifyWithExpiry!(envToken)).expiresAtMs).toBeGreaterThan(Date.now());
  });
  it('keeps a strict allowlist and does not treat corrupt database values as absent',async()=>{
    expect(Object.keys(SETTING_SCHEMAS)).toContain('api.cors_origins');expect(Object.keys(SETTING_SCHEMAS)).not.toContain('PRIVY_APP_SECRET');
    const f=fixture();f.set([{key:'api.cors_origins',value:['*']}]);await expect(createRuntimeSettings(f.db).read()).rejects.toThrow('RUNTIME_SETTINGS_UNAVAILABLE');
  });
});
