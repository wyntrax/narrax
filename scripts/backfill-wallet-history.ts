import {createPrisma} from '@narra/database';
import {collectWalletHistory,historyPagesFromArgs,HISTORY_PAGE_CAP} from '../workers/pipeline/src/walletHistory';
import {makeWalletEventStore} from '../workers/pipeline/src/prismaStores';
import {recomputeWalletIntelligence} from '../workers/pipeline/src/walletIntelligence';
import {isSolanaAddress} from '@narra/shared';
const db=createPrisma();
async function main(){
 const apiKey=process.env.HELIUS_API_KEY;if(!apiKey)throw new Error('HELIUS_API_KEY is required');
 const apply=process.argv.includes('--apply');
 /** Depth is explicit: `--pages=N` up to the hard cap, otherwise the default. */
  const maxPages=historyPagesFromArgs(process.argv.slice(2));
  const address=process.argv.find(arg=>arg.startsWith('--wallet='))?.slice('--wallet='.length);
  if(address!==undefined&&!isSolanaAddress(address))throw new Error('--wallet must be a valid Solana address');
 const store=makeWalletEventStore(db);
  const wallets=await db.trackedWallet.findMany({where:{active:true,...(address?{address}:{})},select:{address:true,id:true},orderBy:{address:'asc'}});
 let created=0,duplicates=0,failures=0;
 console.log(JSON.stringify({maxPages,pageCap:HISTORY_PAGE_CAP,apply,wallets:wallets.length}));
 for(const wallet of wallets){
  try{
   const history=await collectWalletHistory(wallet.address,{apiKey,maxPages});
   if(apply){for(const event of history.events){const saved=await store.saveWalletTrade(event);if(saved==='created')created++;if(saved==='duplicate')duplicates++;}
     const key=`wallet.history.${wallet.id}`,value={checkedAt:new Date().toISOString(),scanned:history.scanned,accepted:history.events.length,skipped:history.skipped,capped:history.capped,windowDays:30,coveredFrom:history.coveredFrom,coveredTo:history.coveredTo};
    await db.systemSetting.upsert({where:{key},create:{key,value},update:{value}});
   }
   console.log(JSON.stringify({address:wallet.address,scanned:history.scanned,accepted:history.events.length,skipped:history.skipped,capped:history.capped,apply}));
  }catch(e){failures++;console.error(JSON.stringify({address:wallet.address,error:(e as Error).message}));}
 }
 console.log(JSON.stringify({created,duplicates,failures,...(apply?{intelligence:await recomputeWalletIntelligence(db)}:{})}));
 if(failures)process.exitCode=1;
}
main().catch(e=>{console.error((e as Error).message);process.exitCode=1;}).finally(()=>db.$disconnect());
