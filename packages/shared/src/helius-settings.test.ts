import {describe,expect,it} from 'vitest';
import {HeliusSettingsInput,effectiveHeliusSettings,isSecretHeliusKey} from './helius-settings';

const primary='https://mainnet.helius-rpc.com/?api-key=primary-secret';
const fallback='https://mainnet.helius-rpc.com/?api-key=fallback-secret';
const env={HELIUS_RPC_URL:primary,HELIUS_RPC_FALLBACK_URL:fallback,HELIUS_API_KEY:'api-key-secret',HOLDER_RPC_URL:'https://holder.example/?api-key=holder-secret',HOLDER_RPC_FALLBACK_URL:'https://holder-fallback.example/?api-key=holder-fallback-secret',HELIUS_WEBHOOK_URL:'https://api.example.com/webhooks/helius',HELIUS_WEBHOOK_SECRET:'webhook-secret-value'};

describe('helius settings',()=>{
 it('uses environment values when nothing is saved',()=>{
  const settings=effectiveHeliusSettings([],env);
  expect(settings.rpcUrl).toEqual({value:primary,source:'environment'});
  expect(settings.rpcFallbackUrl).toEqual({value:fallback,source:'environment'});
  expect(settings.apiKey).toEqual({value:'api-key-secret',source:'environment'});
  expect(settings.holderRpcUrl).toEqual({value:'https://holder.example/?api-key=holder-secret',source:'environment'});
  expect(settings.holderRpcFallbackUrl).toEqual({value:'https://holder-fallback.example/?api-key=holder-fallback-secret',source:'environment'});
  expect(settings.webhookUrl).toEqual({value:'https://api.example.com/webhooks/helius',source:'environment'});
  expect(settings.webhookSecret).toEqual({value:'webhook-secret-value',source:'environment'});
  expect(settings.ready).toEqual({rpc:true,holder:true,webhook:true});
 });
 it('lets a saved value win and treats an empty stored value as an explicit clear',()=>{
  const settings=effectiveHeliusSettings([
   {key:'integrations.helius.rpc_url',value:'https://ready.example/?api-key=ready'},
   {key:'integrations.helius.rpc_fallback_url',value:''},
   {key:'integrations.helius.api_key',value:'ready-api-key'},
   {key:'integrations.helius.holder_rpc_url',value:''},
  ],env);
  expect(settings.rpcUrl).toEqual({value:'https://ready.example/?api-key=ready',source:'database'});
  expect(settings.rpcFallbackUrl).toEqual({value:'',source:'database'});
  expect(settings.apiKey).toEqual({value:'ready-api-key',source:'database'});
  expect(settings.holderRpcUrl).toEqual({value:'',source:'database'});
  expect(settings.ready).toEqual({rpc:true,holder:true,webhook:true});
 });
 it('ignores invalid stored values and reports them instead of applying them',()=>{
  const settings=effectiveHeliusSettings([
   {key:'integrations.helius.rpc_url',value:'ftp://not-http'},
   {key:'integrations.helius.rpc_fallback_url',value:'not a url'},
   {key:'integrations.helius.api_key',value:'has spaces'},
   {key:'integrations.helius.webhook_secret',value:'line\nbreak'},
  ],env);
  expect(settings.rpcUrl).toEqual({value:primary,source:'environment'});
  expect(settings.rpcFallbackUrl).toEqual({value:fallback,source:'environment'});
  expect(settings.apiKey).toEqual({value:'api-key-secret',source:'environment'});
  expect(settings.webhookSecret).toEqual({value:'webhook-secret-value',source:'environment'});
  expect(settings.invalid.sort()).toEqual([
   'integrations.helius.api_key',
   'integrations.helius.rpc_fallback_url',
   'integrations.helius.rpc_url',
   'integrations.helius.webhook_secret',
  ]);
 });
 it('reports webhook readiness only when the key, URL and secret are all present',()=>{
  expect(effectiveHeliusSettings([{key:'integrations.helius.api_key',value:''}],env).ready.webhook).toBe(false);
  expect(effectiveHeliusSettings([{key:'integrations.helius.webhook_url',value:''}],env).ready.webhook).toBe(false);
  expect(effectiveHeliusSettings([{key:'integrations.helius.webhook_secret',value:''}],env).ready.webhook).toBe(false);
 });
 it('accepts only known keys, http(s) endpoints and opaque keys',()=>{
  expect(HeliusSettingsInput.safeParse({'integrations.helius.rpc_url':'https://ready.example/?api-key=x','integrations.helius.api_key':'abcdef-123'}).success).toBe(true);
  expect(HeliusSettingsInput.safeParse({'integrations.helius.rpc_fallback_url':''}).success).toBe(true);
  expect(HeliusSettingsInput.safeParse({'integrations.helius.rpc_url':'ftp://nope'}).success).toBe(false);
  expect(HeliusSettingsInput.safeParse({'integrations.helius.rpc_url':'https://space.example/a b'}).success).toBe(false);
  expect(HeliusSettingsInput.safeParse({'integrations.helius.api_key':'key with spaces'}).success).toBe(false);
  expect(HeliusSettingsInput.safeParse({'integrations.helius.webhook_secret':'a\nb'}).success).toBe(false);
  expect(HeliusSettingsInput.safeParse({'integrations.helius.unknown':'x'}).success).toBe(false);
 });
 it('marks every RPC URL and both credentials as write-only',()=>{
  for(const key of ['integrations.helius.rpc_url','integrations.helius.rpc_fallback_url','integrations.helius.api_key','integrations.helius.holder_rpc_url','integrations.helius.holder_rpc_fallback_url','integrations.helius.webhook_secret'])expect(isSecretHeliusKey(key)).toBe(true);
  expect(isSecretHeliusKey('integrations.helius.webhook_url')).toBe(false);
 });
});
