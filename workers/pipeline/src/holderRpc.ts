import {z} from 'zod';
import bs58 from 'bs58';
import {isSolanaAddress} from '@narra/shared';

const SPL_TOKEN_PROGRAM='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const PROGRAMS=[SPL_TOKEN_PROGRAM,'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'];
export const HOLDER_RPC_LIMITS={maxBytes:8*1024*1024,maxAccounts:20_000,timeoutMs:15000,maxAgeMs:5*60_000,minIntervalMs:500} as const;
const Slot=z.number().int().nonnegative().safe();
const Account=z.object({owner:z.string(),executable:z.literal(false),data:z.tuple([z.string(),z.literal('base64')])});
const Mint=z.object({context:z.object({slot:Slot}),value:Account.nullable()});
const Accounts=z.object({context:z.object({slot:Slot}),value:z.array(z.object({pubkey:z.string(),account:Account})).max(HOLDER_RPC_LIMITS.maxAccounts)});
export type HolderRpcEndpoint='primary'|'fallback';
export type HolderRpcResult=({ok:true;mint:string;holders:number;top10Pct:number;sourceAt:Date;slot:number;accounts:number;program:string}|{ok:false;reason:'RATE_LIMITED'|'UNAVAILABLE'|'INVALID_OR_INCOMPLETE'|'STALE'|'TOO_LARGE'})&{endpoint?:HolderRpcEndpoint;failedOver?:boolean};
export interface HolderRpcSource{
 get(mint:string):Promise<HolderRpcResult>;
 /** Present only on a failover source: the primary endpoint is skipped until this ISO time. */
 primaryCooldownUntil?():string|null;
}

/** Token-2022 keeps withheld transfer fees in the mint, outside every token account, yet inside supply. */
function mintWithheld(raw:Buffer):bigint{
 if(raw.length<=166)return 0n;
 let off=166;
 while(off+4<=raw.length){
  const type=raw.readUInt16LE(off),len=raw.readUInt16LE(off+2);
  if(off+4+len>raw.length)break;
  // TransferFeeConfig: config authority (32), withdraw authority (32), withheld amount (8).
  if(type===1&&len>=72)return raw.readBigUInt64LE(off+4+64);
  off+=4+len;
 }
 return 0n;
}

/** Complete, bounded finalized account enumeration. No indexed-provider retrieval timestamp is used as evidence. */
export function makeHolderRpcSource(url:string,opts:{fetch?:typeof fetch;now?:()=>Date;timeoutMs?:number;minIntervalMs?:number}={}):HolderRpcSource{
 let nextReadAt=0;
 return {async get(mint){
  if(!isSolanaAddress(mint))return {ok:false,reason:'INVALID_OR_INCOMPLETE'};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),opts.timeoutMs??HOLDER_RPC_LIMITS.timeoutMs);
  let id=0,reason:Extract<HolderRpcResult,{ok:false}>['reason']='UNAVAILABLE';
  const invalid=()=>{reason='INVALID_OR_INCOMPLETE';throw Error('invalid holder evidence');};
  const call=async(method:string,params:unknown[])=>{
   const wait=Math.max(0,nextReadAt-Date.now());
   if(wait)await new Promise<void>((resolve,reject)=>{
    const abort=()=>{clearTimeout(delay);reject(Error('deadline'));};
    const delay=setTimeout(()=>{controller.signal.removeEventListener('abort',abort);resolve();},wait);
    controller.signal.addEventListener('abort',abort,{once:true});
    if(controller.signal.aborted)abort();
   });
   controller.signal.throwIfAborted();nextReadAt=Date.now()+(opts.minIntervalMs??HOLDER_RPC_LIMITS.minIntervalMs);
   const requestId=++id;
   const res=await (opts.fetch??fetch)(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:requestId,method,params}),signal:controller.signal});
   if(res.status===429){reason='RATE_LIMITED';await res.body?.cancel();throw Error('throttled');}
   if(!res.ok||!res.body){await res.body?.cancel();throw Error('unavailable');}
   const reader=res.body.getReader();let size=0;const chunks:Uint8Array[]=[];
   try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>HOLDER_RPC_LIMITS.maxBytes){reason='TOO_LARGE';await reader.cancel();throw Error('oversize');}chunks.push(value);}}finally{reader.releaseLock();}
   const envelope=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   if(envelope.error){
    const code=envelope.error.code;
    if([429,-32429].includes(code))reason='RATE_LIMITED';
    // The provider's account-set cap is a query property, not an endpoint throttle.
    // Do not fail over or pause for it; back the token off as oversized.
    else if(code===-32600)reason='TOO_LARGE';
    throw Error('RPC unavailable');
   }
   if(envelope.id!==requestId||envelope.jsonrpc!=='2.0')invalid();
   return envelope.result;
  };
  try{
   const before=Mint.parse(await call('getAccountInfo',[mint,{encoding:'base64',commitment:'finalized'}]));
   if(!before.value||!PROGRAMS.includes(before.value.owner))invalid();
   const program=before.value!.owner,raw=Buffer.from(before.value!.data[0],'base64');
   if(raw.length<82||raw[45]!==1)invalid();
   const supply=raw.readBigUInt64LE(36),withheld=mintWithheld(raw);if(supply<=0n)invalid();
   // The SPL Token program has a very large account set. Providers reject a memcmp-only
   // scan with -32600 ("too many accounts requested"); a dataSize discriminator narrows
   // the index before the mint filter. Token-2022 accounts can carry extensions, so their
   // size is not fixed and the memcmp filter alone is used there.
   const filters=program===SPL_TOKEN_PROGRAM
    ? [{dataSize:165},{memcmp:{offset:0,bytes:mint}}]
    : [{memcmp:{offset:0,bytes:mint}}];
   // Do not pin minContextSlot to the mint read: the provider's scan index can lag that
   // slot by one and answer -32016 even though the data is current. The response reports
   // its own slot, which is checked against the mint read below.
   const scan=Accounts.parse(await call('getProgramAccounts',[program,{encoding:'base64',commitment:'finalized',withContext:true,filters,dataSlice:{offset:0,length:109}}]));
   if(scan.context.slot<before.context.slot||!scan.value.length)invalid();
   const owners=new Map<string,bigint>(),seen=new Set<string>();let total=0n;
   for(const row of scan.value){
    if(!isSolanaAddress(row.pubkey)||seen.has(row.pubkey)||row.account.owner!==program)invalid();seen.add(row.pubkey);
    const data=Buffer.from(row.account.data[0],'base64');
    if(data.length!==109||bs58.encode(data.subarray(0,32))!==mint||![1,2].includes(data[108]!))invalid();
    const balance=data.readBigUInt64LE(64),owner=bs58.encode(data.subarray(32,64));total+=balance;
    if(balance>0n){if(owner==='11111111111111111111111111111111')invalid();owners.set(owner,(owners.get(owner)??0n)+balance);}
   }
   // A truncated enumeration cannot be called complete; withheld fees are supply but are held by the mint.
   if(total+withheld!==supply||!owners.size)invalid();
   const after=Mint.parse(await call('getAccountInfo',[mint,{encoding:'base64',commitment:'finalized',minContextSlot:scan.context.slot}]));
   if(after.context.slot<scan.context.slot||after.value?.owner!==program||!Buffer.from(after.value.data[0],'base64').equals(raw))invalid();
   const seconds=z.number().int().nonnegative().safe().parse(await call('getBlockTime',[scan.context.slot]));
   const sourceAt=new Date(seconds*1000),now=(opts.now??(()=>new Date()))();
   if(!Number.isFinite(+sourceAt)||+sourceAt>+now||+now-+sourceAt>HOLDER_RPC_LIMITS.maxAgeMs)return {ok:false,reason:'STALE'};
   const top=[...owners.values()].sort((a,b)=>a>b?-1:a<b?1:0).slice(0,10).reduce((s,b)=>s+b,0n);
   return {ok:true,mint,holders:owners.size,top10Pct:Number((top*1_000_000n+supply-1n)/supply)/10_000,sourceAt,slot:scan.context.slot,accounts:scan.value.length,program};
  }catch(error){return {ok:false,reason:error instanceof z.ZodError?'INVALID_OR_INCOMPLETE':reason};}
  finally{clearTimeout(timer);}
 }};
}
