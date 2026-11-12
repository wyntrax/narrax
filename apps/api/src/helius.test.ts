import Fastify from 'fastify';
import type {PrismaClient} from '@narra/database';
import {describe,expect,it,vi} from 'vitest';
import {registerHeliusRoutes} from './helius';

function setup(env:Record<string,string|undefined>={},fetchImpl:typeof fetch=vi.fn(async()=>new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:'ok'}),{status:200}))){
 const rows=new Map<string,unknown>();
 const audits:{userId:string;action:string;detail:unknown}[]=[];
 const db={
  user:{findUnique:async({where}:{where:{id?:string;privyUserId?:string}})=>{
   const key=where.id??where.privyUserId;
   if(key==='admin'||key==='admin-1')return{id:'admin-1',isAdmin:true,privyUserId:'admin',email:null};
   if(key==='member'||key==='member-1')return{id:'member-1',isAdmin:false,privyUserId:'member',email:null};
   return null;
  }},
  systemSetting:{
   findMany:async({where}:{where:{key:{in:string[]}}})=>[...rows.entries()].filter(([key])=>where.key.in.includes(key)).map(([key,value])=>({key,value})),
   upsert:async({where,create}:{where:{key:string};create:{value:unknown}})=>{rows.set(where.key,create.value);return{key:where.key,value:create.value};},
  },
  auditLog:{create:async({data}:{data:{userId:string;action:string;detail:unknown}})=>{audits.push(data);return data;}},
  $transaction:async(ops:Promise<unknown>[])=>Promise.all(ops),
 } as unknown as PrismaClient;
 const app=Fastify();
 registerHeliusRoutes(app,{db,verifier:{verify:async token=>({privyUserId:token})},env,fetch:fetchImpl});
 return {app,rows,audits,fetchImpl};
}
const headers=(token='admin')=>({authorization:`Bearer ${token}`});
const primary='https://primary.example/?api-key=primary-secret';
const fallback='https://fallback.example/?api-key=fallback-secret';

describe('admin helius settings',()=>{
 it('is admin-only and never returns a credential value',async()=>{
  const {app}=setup({HELIUS_RPC_URL:primary,HELIUS_API_KEY:'api-secret',HELIUS_WEBHOOK_SECRET:'hook-secret',HELIUS_WEBHOOK_URL:'https://api.example.com/webhooks/helius'});try{
   expect((await app.inject('/v1/admin/helius')).statusCode).toBe(401);
   expect((await app.inject({url:'/v1/admin/helius',headers:headers('member')})).statusCode).toBe(403);
   const response=await app.inject({url:'/v1/admin/helius',headers:headers()});
   expect(response.statusCode).toBe(200);
   expect(response.json()).toMatchObject({
    rpcUrl:{configured:true,source:'environment'},
    apiKey:{configured:true,source:'environment'},
    webhookUrl:{value:'https://api.example.com/webhooks/helius',source:'environment'},
    webhookSecret:{configured:true,source:'environment'},
    ready:{rpc:true,webhook:true},
   });
   expect(response.body).not.toContain('primary-secret');
   expect(response.body).not.toContain('api-secret');
   expect(response.body).not.toContain('hook-secret');
  }finally{await app.close();}
 });
 it('saves a replacement key, masks it in the audit log, and can clear an endpoint',async()=>{
  const {app,rows,audits}=setup({HELIUS_RPC_URL:primary});try{
   const response=await app.inject({url:'/v1/admin/helius',method:'PUT',headers:headers(),payload:{settings:{
    'integrations.helius.rpc_url':'https://ready.example/?api-key=ready-secret',
    'integrations.helius.rpc_fallback_url':fallback,
    'integrations.helius.api_key':'ready-api-key',
    'integrations.helius.webhook_url':'https://api.example.com/webhooks/helius',
    'integrations.helius.webhook_secret':'ready-hook-secret',
   },reason:'Rotate exhausted key'}});
   expect(response.statusCode).toBe(200);
   const body=response.json();
   expect(body).toMatchObject({rpcUrl:{configured:true,source:'database'},rpcFallbackUrl:{configured:true,source:'database'},apiKey:{configured:true,source:'database'},webhookSecret:{configured:true,source:'database'},ready:{rpc:true,webhook:true}});
   expect(rows.get('integrations.helius.rpc_url')).toBe('https://ready.example/?api-key=ready-secret');
   expect(rows.get('integrations.helius.api_key')).toBe('ready-api-key');
   expect(response.body).not.toContain('ready-secret');
   expect(response.body).not.toContain('ready-api-key');
   expect(response.body).not.toContain('ready-hook-secret');
   const changed=audits.filter(a=>a.action==='helius.settings_changed');
   expect(changed.length).toBe(5);
   expect(JSON.stringify(changed)).not.toContain('ready-secret');
   expect(JSON.stringify(changed)).not.toContain('ready-api-key');
   expect(changed.find(a=>(a.detail as {key:string}).key==='integrations.helius.rpc_url')?.detail).toMatchObject({before:'<unset>',after:'<set>'});

   const cleared=await app.inject({url:'/v1/admin/helius',method:'PUT',headers:headers(),payload:{settings:{'integrations.helius.rpc_fallback_url':''},reason:'Remove exhausted fallback'}});
   expect(cleared.statusCode).toBe(200);
   expect(cleared.json().rpcFallbackUrl).toEqual({configured:false,source:'database'});
   expect(rows.get('integrations.helius.rpc_fallback_url')).toBe('');
  }finally{await app.close();}
 });
 it('rejects a fallback without a primary, duplicate endpoints, unknown keys and a missing reason',async()=>{
  const {app}=setup();try{
   const put=(settings:Record<string,unknown>,reason='Change')=>app.inject({url:'/v1/admin/helius',method:'PUT',headers:headers(),payload:{settings,reason}});
   expect((await put({'integrations.helius.rpc_fallback_url':fallback})).json().error).toBe('HELIUS_RPC_FALLBACK_REQUIRES_PRIMARY');
   expect((await put({'integrations.helius.rpc_url':primary,'integrations.helius.rpc_fallback_url':primary})).json().error).toBe('HELIUS_RPC_FALLBACK_DUPLICATE');
   expect((await put({'integrations.helius.holder_rpc_url':primary,'integrations.helius.holder_rpc_fallback_url':primary})).json().error).toBe('HOLDER_RPC_FALLBACK_DUPLICATE');
   expect((await put({'integrations.helius.unknown':'x'})).statusCode).toBe(400);
   expect((await put({'integrations.helius.api_key':'k'},'')).statusCode).toBe(400);
   expect((await put({'integrations.helius.rpc_url':'ftp://nope'})).statusCode).toBe(400);
  }finally{await app.close();}
 });
 it('tests entered or saved endpoints and reports only a code and latency',async()=>{
  const fetchImpl=vi.fn(async(url:string|URL|Request)=>{
   const text=String(url);
   if(text.includes('primary'))return new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:'ok'}),{status:200});
   if(text.includes('fallback'))return new Response(JSON.stringify({error:{code:429}}),{status:429});
   if(text.includes('holder'))throw Object.assign(new Error('aborted'),{name:'AbortError'});
   return new Response('no',{status:500});
  }) as unknown as typeof fetch;
  const {app}=setup({HELIUS_RPC_URL:primary,HELIUS_RPC_FALLBACK_URL:fallback,HELIUS_WEBHOOK_SECRET:'hook-secret'},fetchImpl);try{
   expect((await app.inject({url:'/v1/admin/helius/test',method:'POST',headers:headers(),payload:{}})).statusCode).toBe(200);
   const saved=await app.inject({url:'/v1/admin/helius/test',method:'POST',headers:headers(),payload:{}});
   expect(saved.json()).toMatchObject({primary:{ok:true,code:'OK'},fallback:{ok:false,code:'RATE_LIMITED',status:429}});
   expect(saved.body).not.toContain('primary-secret');
   expect(saved.body).not.toContain('fallback-secret');

   const entered=await app.inject({url:'/v1/admin/helius/test',method:'POST',headers:headers(),payload:{rpcUrl:'https://holder.example/?api-key=holder-secret',rpcFallbackUrl:'https://other.example/?api-key=other-secret'}});
   expect(entered.json()).toMatchObject({primary:{ok:false,code:'TIMEOUT'},fallback:{ok:false,code:'HTTP_ERROR',status:500}});
   expect(entered.body).not.toContain('holder-secret');
  }finally{await app.close();}
 });
 it('requires at least one endpoint to test and rejects invalid input',async()=>{
  const {app}=setup();try{
   const response=await app.inject({url:'/v1/admin/helius/test',method:'POST',headers:headers(),payload:{}});
   expect(response.statusCode).toBe(400);expect(response.json().error).toBe('HELIUS_NOT_CONFIGURED');
   expect((await app.inject({url:'/v1/admin/helius/test',method:'POST',headers:headers(),payload:{rpcUrl:'ftp://nope'}})).statusCode).toBe(400);
  }finally{await app.close();}
 });
});
