import {z} from 'zod';
import type {PrismaClient} from '@narra/database';
import {sanitizeUntrusted,isSolanaAddress} from '@narra/shared';

const Asset=z.object({id:z.string(),content:z.object({metadata:z.object({name:z.string().optional(),symbol:z.string().optional()})}).optional(),token_info:z.object({symbol:z.string().optional()}).optional()});
const Envelope=z.object({result:z.array(Asset.nullable()).optional(),error:z.unknown().optional()});
export interface MetadataSource {get(mints:string[]):Promise<Map<string,{name:string;symbol:string}>>}
/** Helius DAS metadata is independent of price/liquidity availability. Never fetch
 * token-controlled metadata URLs, and never expose the credential-bearing RPC URL. */
export function heliusMetadataSource(url:string,fetchImpl:typeof fetch=fetch):MetadataSource{
 return {async get(mints){
  const requested=mints.filter(isSolanaAddress).slice(0,100),out=new Map<string,{name:string;symbol:string}>();if(!requested.length)return out;
  let response:Response|undefined;
  for(let attempt=0;attempt<3;attempt++){
   try{response=await fetchImpl(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getAssetBatch',params:{ids:requested}}),signal:AbortSignal.timeout(20000)});}catch{throw new Error('Token metadata request failed');}
   if(response.status!==429)break;if(attempt<2)await new Promise(resolve=>setTimeout(resolve,1000*2**attempt));
  }
  if(!response?.ok)throw new Error(`Token metadata returned HTTP ${response?.status??0}`);
  const parsed=Envelope.safeParse(await response.json().catch(()=>null));if(!parsed.success||parsed.data.error||!parsed.data.result)throw new Error('Token metadata returned an invalid result');
  for(const asset of parsed.data.result){if(!asset||!requested.includes(asset.id))continue;const name=sanitizeUntrusted(asset.content?.metadata.name??'',64).trim(),symbol=sanitizeUntrusted(asset.content?.metadata.symbol??asset.token_info?.symbol??'',32).trim();if(name||symbol)out.set(asset.id,{name,symbol});}
  return out;
 }};
}

export async function refreshTokenMetadata(db:PrismaClient,source:MetadataSource,now=new Date(),limit=100){
 const cursorKey='research.tokenMetadata.cursor',cursor=await db.systemSetting.findUnique({where:{key:cursorKey}});
 const after=typeof cursor?.value==='string'?cursor.value:undefined;
 const query={where:{OR:[{symbol:'UNKNOWN'},{name:'Unknown'}],...(after?{id:{gt:after}}:{})},orderBy:{id:'asc' as const},take:Math.min(100,Math.max(1,limit)),select:{id:true,mint:true,name:true,symbol:true}};
 let rows=await db.token.findMany(query);
 if(!rows.length&&after)rows=await db.token.findMany({...query,where:{OR:[{symbol:'UNKNOWN'},{name:'Unknown'}]}});
 const metadata=await source.get(rows.map(t=>t.mint));let resolved=0;
 for(const t of rows){const found=metadata.get(t.mint),patch:{name?:string;symbol?:string}={};
  if(t.name==='Unknown'&&found?.name&&found.name.toLowerCase()!=='unknown')patch.name=found.name;
  if(t.symbol==='UNKNOWN'&&found?.symbol&&found.symbol.toUpperCase()!=='UNKNOWN')patch.symbol=found.symbol;
  if(Object.keys(patch).length)await db.token.update({where:{id:t.id},data:patch});
  if(Object.keys(patch).length){resolved++;const key=`research.tokenMetadata.${t.id}`,value={source:'helius-das',at:now.toISOString(),mint:t.mint,...patch};await db.systemSetting.upsert({where:{key},create:{key,value},update:{value}});}
 }
 // Advance even past unresolved assets, so one obsolete token cannot starve later mints.
 if(rows.length){const value=rows[rows.length-1]!.id;await db.systemSetting.upsert({where:{key:cursorKey},create:{key:cursorKey,value},update:{value}});}
 return {considered:rows.length,resolved,unresolved:rows.length-resolved};
}
