import {parseArgs} from 'node:util';
import {createPrisma} from '@narra/database';
import {isSolanaAddress} from '@narra/shared';
import {HISTORY_ATTEMPT_PREFIX,selectResearchHistoryWallets} from '../workers/pipeline/src/walletResearchHistory';

/** Read-only diagnostics. No RPC/provider calls, job scheduling, or data repair. */
const {values}=parseArgs({options:{wallet:{type:'string'},limit:{type:'string',default:'100'}}});
const limit=Number(values.limit);
if(!Number.isInteger(limit)||limit<1||limit>500)throw new Error('Use --limit=1..500');
if(values.wallet&&!isSolanaAddress(values.wallet))throw new Error('Invalid --wallet address');
const u=new URL(process.env.DATABASE_URL??'invalid:');
u.searchParams.set('options','-c default_transaction_read_only=on -c statement_timeout=20000');
const db=createPrisma(u.toString());
const object=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const text=(v:unknown)=>typeof v==='string'?v:null;
const count=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:null;
async function main(){
 const now=new Date();
 const wallets=await db.trackedWallet.findMany({where:{active:true,researchReview:{not:'REJECTED'},...(values.wallet?{address:values.wallet}:{})},orderBy:{id:'asc'},take:limit+1,select:{id:true,address:true,createdAt:true}});
 const page=wallets.slice(0,limit);
 const rows=await db.systemSetting.findMany({where:{key:{in:page.flatMap(w=>[`wallet.history.${w.id}`,HISTORY_ATTEMPT_PREFIX+w.id])}},select:{key:true,value:true}});
 const settings=new Map(rows.map(r=>[r.key,object(r.value)]));
 const items=page.map(w=>{
  const h=settings.get(`wallet.history.${w.id}`),a=settings.get(HISTORY_ATTEMPT_PREFIX+w.id);
  return {address:w.address,trackedAt:w.createdAt,lastSuccessAt:text(h?.checkedAt),lastAttemptAt:text(a?.lastAttemptAt),attempts:count(a?.attempts),
   status:text(a?.status)??(h?.capped===true?'LEGACY_PARTIAL':h?.capped===false?'LEGACY_COMPLETE':'NO_SUCCESS_RECORDED'),mode:text(a?.mode),
   errorCode:text(a?.errorCode),httpStatus:count(a?.httpStatus),consecutiveFailures:count(a?.consecutiveFailures),
   requestedFrom:text(a?.requestedFrom)??text(h?.scanFrom),requestedTo:text(a?.requestedTo)??text(h?.scanTo),
   verifiedCoveredFrom:text(h?.verifiedCoveredFrom),verifiedCoveredTo:text(h?.verifiedCoveredTo),
   oldestObservedAt:text(h?.oldestObservedAt),newestObservedAt:text(h?.newestObservedAt),scannedThroughAt:text(h?.scannedThroughAt),
   resumable:h?.capped===true&&typeof h.nextBefore==='string',scanned:count(h?.scanned),accepted:count(h?.accepted),skipped:count(h?.skipped),pagesRead:count(h?.pagesRead),searchHops:count(h?.searchHops),lastAttemptSearchHops:count(a?.searchHops)};
 });
 console.log(JSON.stringify({asOf:now.toISOString(),readOnly:true,truncated:wallets.length>limit,displayed:items.length,
  note:'Requested ranges are not proof of coverage. Observed dates describe provider rows, including unsupported swaps. Completed scans cover filtered SWAP history, not transfers. Legacy attempt counts and verified bounds remain unknown.',
  nextScheduled:(await selectResearchHistoryWallets(db,now)).map(w=>w.address),items},null,2));
}
main().catch(()=>{console.error('Wallet history status failed. No data was changed.');process.exitCode=1;}).finally(()=>db.$disconnect());
