import Fastify from 'fastify';
import {it,expect,vi} from 'vitest';
import {registerWebhooks} from './webhooks';
it('records non-empty authenticated receipts only, with no raw payload',async()=>{
 const app=Fastify(),recordReceipt=vi.fn(async()=>{});registerWebhooks(app,{secret:'secret',enqueue:async()=>{},isTracked:async()=>true,recordReceipt});
 try{
  await app.inject({method:'POST',url:'/webhooks/helius',payload:[{junk:'private'}],headers:{authorization:'wrong'}});
  await app.inject({method:'POST',url:'/webhooks/helius',payload:[],headers:{authorization:'secret'}});expect(recordReceipt).not.toHaveBeenCalled();
  const r=await app.inject({method:'POST',url:'/webhooks/helius',payload:[{junk:'private'}],headers:{authorization:'secret'}});
  expect(r.statusCode).toBe(200);expect(recordReceipt).toHaveBeenCalledWith({at:expect.any(String),items:1,parsed:0,queued:0,skipped:1});expect(JSON.stringify(recordReceipt.mock.calls)).not.toContain('private');
 }finally{await app.close();}
});
it('does not fail webhook acceptance if diagnostic persistence fails',async()=>{
 const app=Fastify();registerWebhooks(app,{secret:'secret',enqueue:async()=>{},isTracked:async()=>true,recordReceipt:async()=>{throw new Error('private');}});
 try{expect((await app.inject({method:'POST',url:'/webhooks/helius',payload:[{}],headers:{authorization:'secret'}})).statusCode).toBe(200);}finally{await app.close();}
});
