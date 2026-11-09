import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import type {PrismaClient} from '@narra/database';
import {describe,expect,it,vi} from 'vitest';
import {registerIntegrationRoutes,type TelegramTestSender} from './integrations';
import {registerHttpHardening} from './http';

function setup(env:Record<string,string|undefined>={},send?:TelegramTestSender){
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
 const sender=send??vi.fn(async()=>({ok:true as const,messageId:'9'}));
 registerIntegrationRoutes(app,{db,verifier:{verify:async token=>({privyUserId:token})},telegramSend:sender,env});
 return {app,db,rows,audits,sender};
}
const headers=(token='admin')=>({authorization:`Bearer ${token}`});

describe('admin integration settings',()=>{
 it('is admin-only and never returns a secret value',async()=>{
  const {app}=setup();try{
   expect((await app.inject('/v1/admin/integrations')).statusCode).toBe(401);
   expect((await app.inject({url:'/v1/admin/integrations',headers:headers('member')})).statusCode).toBe(403);
   const response=await app.inject({url:'/v1/admin/integrations',headers:headers()});
   expect(response.statusCode).toBe(200);
   expect(response.json()).toMatchObject({telegram:{enabled:{value:true,source:'default'},botToken:{configured:false,source:'default'}},treg:{enabled:{value:false,source:'default'},token:{configured:false,source:'default'}}});
  }finally{await app.close();}
 });
 it('saves the group chat, bot token, Treg token and limits with a reason and audits them without the secret',async()=>{
  const {app,rows,audits}=setup();try{
   const response=await app.inject({url:'/v1/admin/integrations',method:'PUT',headers:headers(),payload:{settings:{
    'integrations.telegram.enabled':true,
    'integrations.telegram.chat_id':'-1001234567890',
    'integrations.telegram.bot_token':'123456:super-secret-token-value',
    'integrations.telegram.max_age_min':10,
    'integrations.treg.enabled':true,
    'integrations.treg.token':'treg-secret-value',
    'integrations.treg.org':'narra',
   },reason:'Rotate credentials'}});
   expect(response.statusCode).toBe(200);
   const body=response.json();
   expect(body.telegram).toMatchObject({enabled:{value:true,source:'database'},chatId:{value:'-1001234567890',source:'database'},botToken:{configured:true,source:'database'},maxAgeMin:{value:10,source:'database'}});
   expect(body.treg).toMatchObject({enabled:{value:true,source:'database'},token:{configured:true,source:'database'},org:{value:'narra',source:'database'}});
   expect(rows.get('integrations.telegram.bot_token')).toBe('123456:super-secret-token-value');
   expect(row(rows,'integrations.treg.token')).toBe('treg-secret-value');
   expect(JSON.stringify(response.body)).not.toContain('super-secret-token-value');
   expect(JSON.stringify(response.body)).not.toContain('treg-secret-value');
   const secrets=audits.filter(a=>a.action==='integration.settings_changed'&&String((a.detail as {key:string}).key).includes('token'));
   expect(secrets.length).toBeGreaterThanOrEqual(2);
   expect(JSON.stringify(secrets)).not.toContain('super-secret-token-value');
   expect(JSON.stringify(secrets)).not.toContain('treg-secret-value');
  }finally{await app.close();}
 });
 it('does not let the environment default to enabled without a chat and token, or Treg without a token',async()=>{
  const {app}=setup({});try{
   const noChat=await app.inject({url:'/v1/admin/integrations',method:'PUT',headers:headers(),payload:{settings:{'integrations.telegram.enabled':true},reason:'Enable'}});
   expect(noChat.statusCode).toBe(400);expect(noChat.json().error).toBe('TELEGRAM_NOT_CONFIGURED');
   const noToken=await app.inject({url:'/v1/admin/integrations',method:'PUT',headers:headers(),payload:{settings:{'integrations.treg.enabled':true},reason:'Enable'}});
   expect(noToken.statusCode).toBe(400);expect(noToken.json().error).toBe('TREG_TOKEN_REQUIRED');
  }finally{await app.close();}
 });
 it('accepts an environment credential when enabling and rejects unknown keys without a reason',async()=>{
  const {app}=setup({TELEGRAM_BOT_TOKEN:'env-bot',TELEGRAM_CHAT_ID:'-1009'});try{
   expect((await app.inject({url:'/v1/admin/integrations',method:'PUT',headers:headers(),payload:{settings:{'integrations.telegram.enabled':true},reason:'Enable from env'}})).statusCode).toBe(200);
   expect((await app.inject({url:'/v1/admin/integrations',method:'PUT',headers:headers(),payload:{settings:{'integrations.telegram.api_key':'x'},reason:'Nope'}})).statusCode).toBe(400);
   expect((await app.inject({url:'/v1/admin/integrations',method:'PUT',headers:headers(),payload:{settings:{'integrations.telegram.chat_id':'-1009'},reason:''}})).statusCode).toBe(400);
  }finally{await app.close();}
 });
 it('tests Telegram without saving and reports a rejection as an actionable error',async()=>{
  const send=vi.fn<TelegramTestSender>(async()=>({ok:true,messageId:'42'}));
  const {app,audits}=setup({},send);try{
   const ok=await app.inject({url:'/v1/admin/integrations/telegram/test',method:'POST',headers:headers(),payload:{chatId:'-100123',botToken:'123:secret'}});
   expect(ok.statusCode).toBe(200);expect(ok.json()).toEqual({ok:true,messageId:'42'});expect(send).toHaveBeenCalledOnce();expect(audits.at(-1)).toMatchObject({action:'integration.telegram_tested'});
   send.mockResolvedValueOnce({ok:false,status:400,description:'Bad Request: chat not found'});
   const bad=await app.inject({url:'/v1/admin/integrations/telegram/test',method:'POST',headers:headers(),payload:{chatId:'-100123',botToken:'123:secret'}});
   expect(bad.statusCode).toBe(502);expect(bad.json().error).toBe('TELEGRAM_TEST_FAILED');expect(bad.body).not.toContain('123:secret');
  }finally{await app.close();}
 });
});
const row=(rows:Map<string,unknown>,key:string)=>rows.get(key);
