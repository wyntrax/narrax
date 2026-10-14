import Fastify from 'fastify';
import type {PrismaClient} from '@narra/database';
import type {EventStream} from '@narra/realtime';
import {expect,it,vi} from 'vitest';
import {registerGateway} from './gateway';
import {createRuntimeSettings,invalidateRuntimeSettings} from './runtime-settings';

it('uses the same cached origin merge for WebSocket upgrades, including env fallback on DB failure',async()=>{
  let rows:{key:string;value:string[]}[]=[];
  const findMany=vi.fn(async()=>rows),db={systemSetting:{findMany}} as unknown as PrismaClient;
  const runtime=createRuntimeSettings(db,{CORS_ORIGINS:'https://env.example'}),app=Fastify();
  const stream={newestId:async()=>'0-0',readBlocking:async()=>{await new Promise(r=>setTimeout(r,10));return {lastId:'0-0',entries:[]};}} as unknown as EventStream;
  await registerGateway(app,{db,verifier:{verify:async()=>{throw Error('not used');}},stream,readerStream:stream,allowedOrigins:['https://env.example'],resolveAllowedOrigins:runtime.origins});
  await app.ready();
  const open=async(origin:string)=>{const socket=await app.injectWS('/v1/stream',{headers:{origin}});socket.close();};
  try{
    await expect(open('https://extra.example')).rejects.toThrow();await open('https://env.example');
    rows=[{key:'api.cors_origins',value:['https://extra.example']}];invalidateRuntimeSettings(db);await open('https://extra.example');
    rows=[];invalidateRuntimeSettings(db);await expect(open('https://extra.example')).rejects.toThrow();await open('https://env.example');
    findMany.mockRejectedValue(Error('offline'));invalidateRuntimeSettings(db);await open('https://env.example');await expect(open('https://extra.example')).rejects.toThrow();
  }finally{await app.close();}
});
