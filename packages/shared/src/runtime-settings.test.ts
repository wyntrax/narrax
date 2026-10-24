import {generateKeyPairSync} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {CorsOrigins,PrivyAppId,PrivyVerificationKey,RuntimeSettingsInput} from './runtime-settings';
import {checkEnv} from './env';

describe('public runtime setting schemas',()=>{
  it('accepts public SPKI PEM with Windows or escaped newlines, never private material',()=>{
    const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
    const pem=pair.publicKey.export({type:'spki',format:'pem'}).toString();
    for(const value of [pem,pem.replace(/\n/g,'\r\n'),pem.replace(/\n/g,'\\n')])expect(PrivyVerificationKey.safeParse(value).success).toBe(true);
    expect(PrivyVerificationKey.safeParse(pair.privateKey.export({type:'pkcs8',format:'pem'})).success).toBe(false);
    expect(PrivyVerificationKey.safeParse('not PEM').success).toBe(false);
  });
  it('allows exact HTTP(S) origins only',()=>{
    expect(CorsOrigins.parse(['http://localhost:4010','https://app.example'])).toHaveLength(2);
    for(const origin of ['*','https://*.example','https://app.example/','https://app.example/path','https://u:p@app.example','null','file:///x','https://app.example?q=1','https://app.example#x'])expect(CorsOrigins.safeParse([origin]).success).toBe(false);
  });
  it('limits app IDs and strictly rejects secrets, executor limits, unknown keys and wrong types',()=>{
    expect(PrivyAppId.parse(' app-1 ')).toBe('app-1');
    for(const value of ['', 'a/b','a?b'])expect(PrivyAppId.safeParse(value).success).toBe(false);
    for(const value of [{'DATABASE_URL':'x'},{'PRIVY_APP_SECRET':'x'},{'EXECUTOR_MAX_SOL':1},{'unknown':true},{'api.cors_origins':'https://app.example'}])expect(RuntimeSettingsInput.safeParse(value).success).toBe(false);
  });
  it('permits DB-only auth bootstrap without relaxing other API environment checks',()=>{
    const env={DATABASE_URL:'postgresql://localhost/test',REDIS_URL:'redis://localhost'};
    expect(checkEnv(env,'api').errors).toContain('PRIVY_APP_ID is required.');
    expect(checkEnv(env,'api',{runtimeAuth:true}).errors).toEqual([]);
    expect(checkEnv({},'api',{runtimeAuth:true}).errors).toContain('DATABASE_URL is required.');
  });
});
