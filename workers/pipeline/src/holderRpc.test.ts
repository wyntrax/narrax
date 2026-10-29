import {expect,it,vi} from 'vitest';
import bs58 from 'bs58';
import {HOLDER_RPC_LIMITS,makeHolderRpcSource} from './holderRpc';

const now=new Date('2026-10-29T08:00:00Z'),mint=bs58.encode(Buffer.alloc(32,7)),program='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
function fixture(){
 const raw=Buffer.alloc(82);raw.writeBigUInt64LE(1200n,36);raw[45]=1;
 const account=(data:Buffer)=>({owner:program,executable:false,data:[data.toString('base64'),'base64']});
 const rows=Array.from({length:13},(_,i)=>{const b=Buffer.alloc(109);Buffer.from(bs58.decode(mint)).copy(b);Buffer.alloc(32,i===12?1:i+1).copy(b,32);b.writeBigUInt64LE(i===12?0n:100n,64);b[108]=1;return {pubkey:bs58.encode(Buffer.alloc(32,i+30)),account:account(b)};});
 const responses:any[]=[{context:{slot:100},value:account(raw)},{context:{slot:101},value:rows},{context:{slot:102},value:account(raw)},Math.floor(+now/1000)-10];
 const fetcher=vi.fn(async(_url:unknown,init?:RequestInit)=>{const req=JSON.parse(init!.body as string);return new Response(JSON.stringify({jsonrpc:'2.0',id:req.id,result:responses[req.id-1]}));});
 return {raw,account,rows,responses,fetcher,source:()=>makeHolderRpcSource('https://rpc.example/secret',{fetch:fetcher as typeof fetch,now:()=>now,minIntervalMs:0})};
}
it('uses a complete finalized enumeration, validates stable supply, and timestamps from its block',async()=>{
 const f=fixture(),r=await f.source().get(mint);expect(r).toMatchObject({ok:true,holders:12,top10Pct:83.3334,sourceAt:new Date(+now-10000),slot:101,accounts:13});
 expect(f.fetcher).toHaveBeenCalledTimes(4);
 const requests=f.fetcher.mock.calls.map(([,init])=>JSON.parse(init!.body as string));
 expect(requests[1]).toMatchObject({method:'getProgramAccounts',params:[program,{commitment:'finalized',withContext:true,minContextSlot:100,dataSlice:{offset:0,length:109},filters:[{memcmp:{offset:0,bytes:mint}}]}]});
 expect(requests[2].params[1].minContextSlot).toBe(101);expect(requests[3].params).toEqual([101]);
});
it('counts owners rather than accounts and includes pool-like concentration without exclusions',async()=>{
 const f=fixture();const b=Buffer.from(f.rows[1]!.account.data[0]!,'base64');Buffer.alloc(32,1).copy(b,32);f.rows[1]!.account=f.account(b);
 expect(await f.source().get(mint)).toMatchObject({ok:true,holders:11,top10Pct:91.6667});
});
it('supports Token-2022 base accounts while still requiring supply reconciliation',async()=>{
 const f=fixture(),p='TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';f.responses[0].value.owner=p;f.responses[2].value.owner=p;for(const r of f.rows)r.account.owner=p;
 expect(await f.source().get(mint)).toMatchObject({ok:true,program:p});
});
it.each(['missing-account','duplicate','wrong-mint','wrong-program','supply-changed','uninitialized','old-slot','bad-block','future-block','unknown-block'])('refuses %s evidence',async mode=>{
 const f=fixture();
 if(mode==='missing-account')f.rows.pop(),f.rows.pop();
 if(mode==='duplicate')f.rows[1]=f.rows[0]!;
 if(mode==='wrong-program')f.rows[0]!.account.owner='unknown';
 if(mode==='wrong-mint'||mode==='uninitialized'){const b=Buffer.from(f.rows[0]!.account.data[0]!,'base64');b[mode==='wrong-mint'?0:108]=0;f.rows[0]!.account=f.account(b);}
 if(mode==='supply-changed'){const b=Buffer.from(f.raw);b.writeBigUInt64LE(1300n,36);f.responses[2].value=f.account(b);}
 if(mode==='old-slot')f.responses[1].context.slot=99;
 if(mode==='bad-block')f.responses[3]=Math.floor(+now/1000)-3600;
 if(mode==='future-block')f.responses[3]=Math.floor(+now/1000)+60;
 if(mode==='unknown-block')f.responses[3]=null;
 expect(await f.source().get(mint)).toMatchObject({ok:false});
});
it('bounds streamed bytes and never exposes the RPC URL or provider error body',async()=>{
 const fetcher=vi.fn(async()=>new Response('x'.repeat(HOLDER_RPC_LIMITS.maxBytes+1)));
 expect(await makeHolderRpcSource('https://rpc.example/secret',{fetch:fetcher as typeof fetch}).get(mint)).toEqual({ok:false,reason:'TOO_LARGE'});
 fetcher.mockImplementation(async()=>new Response('secret provider body',{status:429}));
 expect(await makeHolderRpcSource('https://rpc.example/secret',{fetch:fetcher as typeof fetch}).get(mint)).toEqual({ok:false,reason:'RATE_LIMITED'});
});
it('keeps a deadline active across all requests and body reads',async()=>{
 const fetcher=vi.fn(async(_u:unknown,opts?:RequestInit)=>new Promise<Response>((_resolve,reject)=>opts?.signal?.addEventListener('abort',()=>reject(Error('secret timeout')))));
 expect(await makeHolderRpcSource('https://rpc.example/secret',{fetch:fetcher as typeof fetch,timeoutMs:10}).get(mint)).toEqual({ok:false,reason:'UNAVAILABLE'});
});
it('paces sequential lookups across token boundaries',async()=>{
 const f=fixture(),times:number[]=[];
 const fetcher=vi.fn(async(u:unknown,opts?:RequestInit)=>{times.push(Date.now());return f.fetcher(u,opts);});
 const source=makeHolderRpcSource('https://rpc.example/secret',{fetch:fetcher as typeof fetch,now:()=>now,minIntervalMs:15});
 expect(await source.get(mint)).toMatchObject({ok:true});expect(await source.get(mint)).toMatchObject({ok:true});
 expect(times).toHaveLength(8);expect(times.slice(1).every((time,i)=>time-times[i]!>=10)).toBe(true);
});
it('refuses zero supply, unsupported mints, empty or oversized enumerations and backwards mint slots',async()=>{
 for(const mode of ['zero','program','missing','empty','oversize','slot']){
  const f=fixture();
  if(mode==='zero'){const b=Buffer.from(f.raw);b.writeBigUInt64LE(0n,36);f.responses[0].value=f.account(b);}
  if(mode==='program')f.responses[0].value.owner='unknown';
  if(mode==='missing')f.responses[0].value=null;
  if(mode==='empty')f.responses[1].value=[];
  if(mode==='oversize')f.responses[1].value=Array.from({length:5001},()=>f.rows[0]);
  if(mode==='slot')f.responses[2].context.slot=100;
  expect(await f.source().get(mint)).toEqual({ok:false,reason:'INVALID_OR_INCOMPLETE'});
 }
});
it('recognizes JSON-RPC throttle errors without retrying or exposing provider text',async()=>{
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({jsonrpc:'2.0',id:1,error:{code:-32429,message:'secret private URL'}})));
 expect(await makeHolderRpcSource('https://rpc.example/secret',{fetch:fetcher as typeof fetch}).get(mint)).toEqual({ok:false,reason:'RATE_LIMITED'});expect(fetcher).toHaveBeenCalledOnce();
});
