import {z} from 'zod';
import bs58 from 'bs58';
import {isSolanaAddress} from '@narra/shared';

const PROGRAMS=['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA','TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'];
export const HOLDER_RPC_LIMITS={maxBytes:2*1024*1024,maxAccounts:5000,timeoutMs:15000,maxAgeMs:5*60_000,minIntervalMs:500} as const;
const Slot=z.number().int().nonnegative().safe();
const Account=z.object({owner:z.string(),executable:z.literal(false),data:z.tuple([z.string(),z.literal('base64')])});
const Mint=z.object({context:z.object({slot:Slot}),value:Account.nullable()});
const Accounts=z.object({context:z.object({slot:Slot}),value:z.array(z.object({pubkey:z.string(),account:Account})).max(HOLDER_RPC_LIMITS.maxAccounts)});
export type HolderRpcResult={ok:true;mint:string;holders:number;top10Pct:number;sourceAt:Date;slot:number;accounts:number;program:string}|{ok:false;reason:'RATE_LIMITED'|'UNAVAILABLE'|'INVALID_OR_INCOMPLETE'|'STALE'|'TOO_LARGE'};
export interface HolderRpcSource{get(mint:string):Promise<HolderRpcResult>}

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
   if(envelope.error){if([429,-32429].includes(envelope.error.code))reason='RATE_LIMITED';throw Error('RPC unavailable');}
   if(envelope.id!==requestId||envelope.jsonrpc!=='2.0')invalid();
   return envelope.result;
  };
  try{
   const before=Mint.parse(await call('getAccountInfo',[mint,{encoding:'base64',commitment:'finalized'}]));
   if(!before.value||!PROGRAMS.includes(before.value.owner))invalid();
   const program=before.value!.owner,raw=Buffer.from(before.value!.data[0],'base64');
   if(raw.length<82||raw[45]!==1)invalid();
   const supply=raw.readBigUInt64LE(36);if(supply<=0n)invalid();
   const scan=Accounts.parse(await call('getProgramAccounts',[program,{encoding:'base64',commitment:'finalized',withContext:true,minContextSlot:before.context.slot,filters:[{memcmp:{offset:0,bytes:mint}}],dataSlice:{offset:0,length:109}}]));
   if(scan.context.slot<before.context.slot||!scan.value.length)invalid();
   const owners=new Map<string,bigint>(),seen=new Set<string>();let total=0n;
   for(const row of scan.value){
    if(!isSolanaAddress(row.pubkey)||seen.has(row.pubkey)||row.account.owner!==program)invalid();seen.add(row.pubkey);
    const data=Buffer.from(row.account.data[0],'base64');
    if(data.length!==109||bs58.encode(data.subarray(0,32))!==mint||![1,2].includes(data[108]!))invalid();
    const balance=data.readBigUInt64LE(64),owner=bs58.encode(data.subarray(32,64));total+=balance;
    if(balance>0n){if(owner==='11111111111111111111111111111111')invalid();owners.set(owner,(owners.get(owner)??0n)+balance);}
   }
   // A truncated enumeration or Token-2022 withheld supply cannot be called complete.
   if(total!==supply||!owners.size)invalid();
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
