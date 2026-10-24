import {z} from 'zod';
import type {PrismaClient} from '@narra/database';
import {tokenImageUrl} from '@narra/shared';
export const evidence=z.object({mint:z.string().optional(),imageUrl:z.unknown().transform(tokenImageUrl).optional(),metricId:z.string(),at:z.string().datetime(),source:z.literal('dexscreener'),marketCapIsFdv:z.boolean(),priceChange1hPct:z.number().finite().nullable(),pairAddress:z.string(),dexId:z.string().nullable(),pairCreatedAt:z.string().datetime().nullable()});
export function marketTokenImage(value:z.infer<typeof evidence>|undefined,mint:string){return value?.mint===mint?tokenImageUrl(value.imageUrl):null;}
/** One stored-evidence read per page, never a provider request or a per-token lookup. */
export async function marketTokenImages(db:Pick<PrismaClient,'systemSetting'>,tokens:{id:string;mint:string}[]){
 const unique=[...new Map(tokens.map(token=>[token.id,token])).values()];
 const images=await marketEvidence(db,unique.map(token=>token.id));
 return new Map(unique.map(token=>[token.id,marketTokenImage(images.get(token.id),token.mint)]));
}
export async function marketEvidence(db:Pick<PrismaClient,'systemSetting'>,ids:string[]){
 const rows=ids.length?await db.systemSetting.findMany({where:{key:{in:ids.map(id=>`research.market.${id}`)}}}):[];
 return new Map(rows.flatMap(row=>{const parsed=evidence.safeParse(row.value);return parsed.success?[[row.key.slice('research.market.'.length),parsed.data] as const]:[];}));
}
export function observation(value:z.infer<typeof evidence>|undefined,metricId:string|undefined,now:Date){
 if(!value||value.metricId!==metricId)return null;
 return {...value,stale:Date.parse(value.at)>+now||+now-Date.parse(value.at)>15*60000};
}
