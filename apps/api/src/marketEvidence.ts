import {z} from 'zod';
import type {PrismaClient} from '@narra/database';
import {tokenImageUrl} from '@narra/shared';
export const evidence=z.object({mint:z.string().optional(),imageUrl:z.unknown().transform(tokenImageUrl).optional(),metricId:z.string(),at:z.string().datetime(),source:z.literal('dexscreener'),marketCapIsFdv:z.boolean(),priceChange1hPct:z.number().finite().nullable(),pairAddress:z.string(),dexId:z.string().nullable(),pairCreatedAt:z.string().datetime().nullable()});
export function marketTokenImage(value:z.infer<typeof evidence>|undefined,mint:string){return value?.mint===mint?tokenImageUrl(value.imageUrl):null;}
/** One stored-evidence read per page, never a provider request or a per-token lookup. */
export async function marketTokenImages(db:Pick<PrismaClient,'systemSetting'>,tokens:{id:string;mint:string}[]){
 const unique=[...new Map(tokens.map(token=>[token.id,token])).values()];
  const rows=unique.length?await db.systemSetting.findMany({where:{key:{in:unique.flatMap(t=>[`research.market.${t.id}`,`research.tokenMetadata.${t.id}`])}}}):[];
  const values=new Map(rows.map(r=>[r.key,r.value]));
  const metadata=z.object({source:z.literal('helius-das'),mint:z.string(),imageUrl:z.unknown().transform(tokenImageUrl)});
  return new Map(unique.map(token=>{
    const market=evidence.safeParse(values.get(`research.market.${token.id}`)),fallback=metadata.safeParse(values.get(`research.tokenMetadata.${token.id}`));
    return [token.id,marketTokenImage(market.success?market.data:undefined,token.mint)??(fallback.success&&fallback.data.mint===token.mint?fallback.data.imageUrl:null)];
  }));
}
export async function marketEvidence(db:Pick<PrismaClient,'systemSetting'>,ids:string[]){
 const rows=ids.length?await db.systemSetting.findMany({where:{key:{in:ids.map(id=>`research.market.${id}`)}}}):[];
 return new Map(rows.flatMap(row=>{const parsed=evidence.safeParse(row.value);return parsed.success?[[row.key.slice('research.market.'.length),parsed.data] as const]:[];}));
}
export function observation(value:z.infer<typeof evidence>|undefined,metricId:string|undefined,now:Date){
 if(!value||value.metricId!==metricId)return null;
 return {...value,stale:Date.parse(value.at)>+now||+now-Date.parse(value.at)>15*60000};
}
