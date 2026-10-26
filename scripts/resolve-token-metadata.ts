import {createPrisma} from '@narra/database';
import {heliusMetadataSource,refreshTokenMetadata} from '../workers/pipeline/src/tokenMetadata';
const db=createPrisma();
async function main(){
 const url=process.env.HELIUS_RPC_URL;if(!url)throw new Error('HELIUS_RPC_URL required');
 const source=heliusMetadataSource(url);let resolved=0;
  const before=await db.token.count({where:{blacklisted:false}});
 for(let i=0;i<Math.min(20,Math.ceil(before/100));i++){const result=await refreshTokenMetadata(db,source);resolved+=result.resolved;console.log(JSON.stringify(result));}
 console.log(JSON.stringify({before,resolved,remaining:await db.token.count({where:{OR:[{symbol:'UNKNOWN'},{name:'Unknown'}]}})}));
}
main().catch(e=>{console.error((e as Error).message);process.exitCode=1;}).finally(()=>db.$disconnect());
