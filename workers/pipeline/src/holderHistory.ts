import type {PrismaClient} from '@narra/database';

/** A provider change is not holder growth. RPC counts positive-balance owners, which can differ from indexed counts. */
export async function holderGrowthBaseline(db:PrismaClient,tokenId:string,currentId:string,before:Date):Promise<number|null>{
 const previous=await db.tokenHolderMetric.findFirst({where:{tokenId,at:{lte:before}},orderBy:{at:'desc'},select:{id:true,holders:true}});
 if(!previous)return null;
 const keys=[currentId,previous.id].map(id=>`research.holderMetric.${id}`);
 const provenance=await db.systemSetting.findMany({where:{key:{in:keys}},select:{key:true,value:true}});
 const source=(key:string)=>{const value=provenance.find(r=>r.key===key)?.value as {source?:unknown;basis?:unknown}|undefined;return value?.source==='solana-rpc'?`solana-rpc:${value.basis}`:'legacy';};
 return source(keys[0]!)===source(keys[1]!)?previous.holders:null;
}
