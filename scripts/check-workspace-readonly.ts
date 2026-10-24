/** Local contract smoke check. Existing DB data; injected identity, not a live Privy login. No HTTP listener. */
import {createPrisma} from '@narra/database';
import {buildApp} from '../apps/api/src/app';
import {SmartWalletsSchema,WalletDetailSchema,WalletTradesSchema,TokensSchema,OpportunitiesSchema,OverviewSchema,UnreadAlertsSchema,AlertsSchema,SettingsSchema} from '../apps/web/src/features/research/contracts';
import type {z} from 'zod';

async function main(){
 const url=new URL(process.env.DATABASE_URL??'invalid:');
 if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('Local database required');
 // Applied to every pg connection, including parallel request queries. Writes are rejected by PostgreSQL.
 url.searchParams.set('options','-c default_transaction_read_only=on');
 const db=createPrisma(url.toString());
 let app:Awaited<ReturnType<typeof buildApp>>|undefined;
 try{
  const user=await db.user.findFirst({orderBy:{createdAt:'asc'},select:{privyUserId:true}});
  if(!user)throw Error('An existing application user is required');
  const mode=await db.$queryRaw<{default_transaction_read_only:string}[]>`SHOW default_transaction_read_only`;
  if(mode[0]?.default_transaction_read_only!=='on')throw Error('Read-only connection required');
  app=await buildApp({account:{db,verifier:{verify:async()=>({privyUserId:user.privyUserId})}}});
  let checked=0,locked=0;
  async function check<T>(path:string,schema:z.ZodType<T>):Promise<T|null>{
   const res=await app!.inject({method:'GET',url:`/v1/${path}`,headers:{authorization:'Bearer local-readonly-check'}});
   if(res.statusCode===403){locked++;console.log(JSON.stringify({path:path.split('?')[0].replace(/wallets\/.+/, 'wallets/[address]'),status:403}));return null;}
   if(res.statusCode!==200)throw Error(`Read failed (${res.statusCode})`);
   const parsed=schema.safeParse(res.json());
   if(!parsed.success){console.error(JSON.stringify({path:path.split('?')[0].replace(/wallets\/.+/, 'wallets/[address]'),fields:parsed.error.issues.map(i=>({path:i.path.join('.'),code:i.code}))}));throw Error('Response contract mismatch');}
   checked++;return parsed.data;
  }
  const wallets=await check('smart-money/wallets?limit=100',SmartWalletsSchema);
  let profiles=0,pending=0,invalidAddresses=0;
  for(const wallet of wallets?.items??[]){
   if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet.address)){invalidAddresses++;continue;}
   const detail=await check(`wallets/${encodeURIComponent(wallet.address)}`,WalletDetailSchema);
   if(detail?.profile)profiles++;else if(detail)pending++;
   await check(`wallets/${encodeURIComponent(wallet.address)}/trades?limit=2`,WalletTradesSchema);
  }
  await check('tokens?verifiedOnly=true&sort=liquidity',TokensSchema);
  for(const [min,max] of [[5000,50000],[50000,100000],[100000,500000]]){
   const rows=await check(`tokens?verifiedOnly=true&marketCapOnly=true&minMarketCapUsd=${min}&maxMarketCapUsd=${max}&sort=marketCap&order=asc`,TokensSchema);
   if(rows?.items.some((row,i)=>row.marketCapUsd==null||row.marketCapUsd<min!||row.marketCapUsd>max!||row.observation?.marketCapIsFdv!==false||(i>0&&row.marketCapUsd<rows.items[i-1]!.marketCapUsd!)))throw Error('Incorrect market-cap results');
  }
  await check('opportunities',OpportunitiesSchema);await check('overview',OverviewSchema);await check('alerts/unread-count',UnreadAlertsSchema);await check('alerts',AlertsSchema);await check('settings',SettingsSchema);
  console.log(JSON.stringify({readOnly:true,authentication:'injected local identity; real Privy flow not tested',checked,locked,wallets:wallets?.items.length??null,profiles,pending,invalidAddresses}));
 }finally{await app?.close();await db.$disconnect();}
}
main().catch(()=>{console.error('Local read-only workspace verification failed. No environment values logged.');process.exitCode=1;});
