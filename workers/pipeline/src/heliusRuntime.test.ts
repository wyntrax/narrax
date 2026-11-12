import {it,expect,vi} from 'vitest';
import type {PrismaClient} from '@narra/database';
import {createHeliusRuntime} from './heliusRuntime';

it('caches settings for the TTL and re-reads after invalidation or expiry',async()=>{
 let rows=[{key:'integrations.helius.rpc_urls',value:['https://one.example/?api-key=1']}];
 const findMany=vi.fn(async()=>rows);
 const db={systemSetting:{findMany}} as unknown as Pick<PrismaClient,'systemSetting'>;
 let now=0;
 const runtime=createHeliusRuntime(db,{},{ttlMs:100,now:()=>now});
 expect((await runtime.read()).rpcUrls.value).toEqual(['https://one.example/?api-key=1']);
 expect(findMany).toHaveBeenCalledTimes(1);

 rows=[{key:'integrations.helius.rpc_urls',value:['https://two.example/?api-key=2']}];
 expect((await runtime.read()).rpcUrls.value).toEqual(['https://one.example/?api-key=1']);
 expect(findMany).toHaveBeenCalledTimes(1);

 now=101;
 expect((await runtime.read()).rpcUrls.value).toEqual(['https://two.example/?api-key=2']);
 expect(findMany).toHaveBeenCalledTimes(2);

 rows=[{key:'integrations.helius.rpc_urls',value:['https://three.example/?api-key=3']}];
 runtime.invalidate();
 expect((await runtime.read()).rpcUrls.value).toEqual(['https://three.example/?api-key=3']);
 expect(findMany).toHaveBeenCalledTimes(3);
});

it('rebuilds the RPC pool when the URL list changes without a restart',async()=>{
 let rows=[{key:'integrations.helius.rpc_urls',value:['https://one.example/?api-key=1']}];
 const db={systemSetting:{findMany:async()=>rows}} as unknown as Pick<PrismaClient,'systemSetting'>;
 const urls:string[]=[];
 const fetchImpl=(async(url:string|URL|Request)=>{
  urls.push(String(url));
  return new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:{context:{slot:1},value:42}}),{status:200});
 }) as unknown as typeof fetch;
 let now=0;
 const runtime=createHeliusRuntime(db,{},{ttlMs:100,now:()=>now,fetch:fetchImpl});
 expect(await (await runtime.rpc(1000))!.getBalanceLamports('wallet')).toBe(42n);
 rows=[{key:'integrations.helius.rpc_urls',value:['https://two.example/?api-key=2']}];
 now=101;
 expect(await (await runtime.rpc(1000))!.getBalanceLamports('wallet')).toBe(42n);
 expect(urls).toEqual(['https://one.example/?api-key=1','https://two.example/?api-key=2']);
});
