import {it,expect,vi} from 'vitest';
import type {PrismaClient} from '@narra/database';
import {heliusMetadataSource,refreshTokenMetadata} from './tokenMetadata';
const mint='So11111111111111111111111111111111111111112';
it('resolves metadata independently of prices and checks returned asset identity',async()=>{
 const fetch=vi.fn<typeof globalThis.fetch>(async()=>new Response(JSON.stringify({result:[{id:mint,content:{metadata:{name:'Wrapped SOL',symbol:'SOL'}}},{id:'unrequested',content:{metadata:{name:'Fake',symbol:'FAKE'}}},null]})));
 const result=await heliusMetadataSource('https://rpc.example/?api-key=secret',fetch).get([mint]);
 expect([...result]).toEqual([[mint,{name:'Wrapped SOL',symbol:'SOL'}]]);
 expect(JSON.parse(fetch.mock.calls[0]?.[1]?.body as string??'{}').method).toBe('getAssetBatch');
});
it('updates only placeholders and advances past unresolved tokens',async()=>{
 const update=vi.fn(),upsert=vi.fn();const db={token:{findMany:async()=>[{id:'a',mint,name:'Unknown',symbol:'REAL'},{id:'b',mint:'missing',name:'Unknown',symbol:'UNKNOWN'}],update},systemSetting:{findUnique:async()=>null,upsert}};
 const source={get:async()=>new Map([[mint,{name:'Real Name',symbol:'NEW'}]])};
 expect(await refreshTokenMetadata(db as unknown as PrismaClient,source)).toMatchObject({resolved:1,unresolved:1});
 expect(update).toHaveBeenCalledWith({where:{id:'a'},data:{name:'Real Name'}});expect(update).toHaveBeenCalledTimes(1);
 expect(upsert).toHaveBeenCalledWith(expect.objectContaining({where:{key:'research.tokenMetadata.cursor'},update:{value:'b'}}));
});
it('does not expose RPC credentials on network or provider errors',async()=>{
 await expect(heliusMetadataSource('https://rpc.example/?api-key=secret',async()=>{throw new Error('secret');}).get([mint])).rejects.toThrow('Token metadata request failed');
});
