import {Queue,Worker} from 'bullmq';
import {createPrisma} from '@narra/database';
import {createRedis,QUEUE_NAMES} from '@narra/queue';
import {DexScreenerSource,GeckoTerminalSource} from '@narra/market-data';
import {refreshMarketData} from './marketData';
import {resolveTokens} from './tokenResolution';
import {attributeNarrativeMentions} from './narrativeTokens';
import {scanSocialTokens} from './socialTokens';
import {makeDeveloperHoldingSource} from './developerHoldings';
import {createHeliusRuntime} from './heliusRuntime';
import {makeRadarSafetySource} from './radarSafetyEvidence';
import {makeTradeabilitySource} from './tradeabilityEvidence';
import {combinedMetadataSource,jupiterMetadataSource} from './tokenMetadata';
import {trackEarlyRadarOutcomes} from './earlyRadarTracking';

/** Market observations and the research that reads them. No wallet recomputation, fan-out or execution consumers. */
async function main(){
 if(!process.env.DATABASE_URL||!process.env.REDIS_URL)throw Error('Database and Redis configuration required');
 if(process.env.MARKET_DATA_ENABLED==='false')throw Error('Market data is disabled');
 const db=createPrisma(),connection=createRedis(),queue=new Queue(QUEUE_NAMES.marketData,{connection});
 // Admin-managed Helius settings, re-read every few seconds. No restart is needed
 // after a save; metadata and developer holdings rebuild from the current pools.
 const helius=createHeliusRuntime(db);
 const startup=await helius.read();
 if(startup.invalid.length)console.warn(`ignoring invalid stored Helius settings: ${startup.invalid.join(', ')}`);
 console.log(JSON.stringify({msg:'market_helius_ready',primary:startup.rpcUrls.value.length,fallback:startup.rpcFallbackUrls.value.length}));
 const gecko=new GeckoTerminalSource({baseUrl:process.env.GECKOTERMINAL_BASE_URL});
 const quotes=new DexScreenerSource({baseUrl:process.env.DEXSCREENER_BASE_URL});
 const launches={name:gecko.name,getNewPools:async()=>{
  const results=await Promise.allSettled([gecko.getNewPools(),gecko.getTrendingPools()]);
  if(results.every(r=>r.status==='rejected'))throw Error('Pool discovery unavailable');
  for(const r of results)if(r.status==='rejected')console.error('One pool discovery source is unavailable');
  return [...new Map(results.flatMap(r=>r.status==='fulfilled'?r.value:[]).map(pool=>[pool.mint,pool])).values()];
 }};
 const depsFor=async()=>{
  const metadata=combinedMetadataSource(await helius.metadataSource(),jupiterMetadataSource());
  const rpc=await helius.rpc(15000);
  // Developer holdings are optional enrichment. A provider rejection on one endpoint
  // moves the call to another endpoint instead of failing the whole market run.
  return {metadata,developerHoldings:rpc?makeDeveloperHoldingSource(db,rpc):null,quotes,info:gecko,launches};
 };
 const radarSafety=makeRadarSafetySource(db), tradeability=makeTradeabilitySource(db);
 if(tradeability)console.log(JSON.stringify({msg:'radar_tradeability_ready',source:'jupiter',ticketUsd:50}));
 let worker:Worker|undefined;
 const close=async()=>{await worker?.close();await queue.close();connection.disconnect();await db.$disconnect();};
 try{
  await db.$connect();await queue.waitUntilReady();
  if((await queue.getWorkers()).length)throw Error('Market consumer already running');
  // Refresh first, then keep narrative-token links current: name matching plus the tokens the narrative's own posts
  // named. Research only; the social scan can create a token row, but only after a market source confirms the mint
  // trades. Nothing here touches orders, positions or execution.
   worker=new Worker(QUEUE_NAMES.marketData,async()=>{const deps=await depsFor();const summary=await refreshMarketData(db,deps);let research:unknown='skipped',earlyRadar:unknown='failed';
     // The scoped collector must mature research horizons even when the full pipeline is stopped.
     // Existing bounded tracker preserves frozen entries and terminal UNKNOWN observations.
     try{earlyRadar=await trackEarlyRadarOutcomes(db);}catch{console.error(JSON.stringify({msg:'radar_outcomes_failed'}));}
    try{research={mentions:await attributeNarrativeMentions(db),tokens:await resolveTokens(db,undefined,{safety:radarSafety,tradeability}),social:await scanSocialTokens(db,{quotes:deps.quotes,safety:radarSafety,tradeability})};}
    catch(error){console.error(JSON.stringify({msg:'research_refresh_failed',err:error instanceof Error?error.message:String(error)}));}
     console.log(JSON.stringify({msg:'market_refresh_complete',...summary,earlyRadar}));return {summary,research,earlyRadar};},{connection,concurrency:1});
  worker.on('error',()=>console.error('Market worker connection error'));worker.on('failed',()=>console.error('Market refresh failed'));
  await worker.waitUntilReady();await queue.upsertJobScheduler('refresh',{every:300000},{name:'refresh',data:{},opts:{attempts:1,removeOnComplete:{count:20},removeOnFail:{count:20}}});
  console.log(JSON.stringify({msg:'market_worker_ready',intervalMs:300000}));
  let stopping=false;const stop=()=>{if(stopping)return;stopping=true;void close().then(()=>process.exit(0));};process.on('SIGINT',stop);process.on('SIGTERM',stop);
 }catch(error){await close();throw error;}
}
main().catch(()=>{console.error('Market worker startup failed; check configuration and existing consumers');process.exitCode=1;});
