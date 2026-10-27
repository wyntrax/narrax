import type { PrismaClient } from '@narra/database';
import { collectWalletHistory, WalletHistoryError } from './walletHistory';
import { makeWalletEventStore } from './prismaStores';
import { z } from 'zod';

const date=z.string().datetime();
const Progress = z.object({ checkedAt: date, capped: z.boolean(), nextBefore: z.string().nullable(),
  scanFrom: date, scanTo: date, coveredFrom: date, coveredTo: date,
  scanned: z.number().int().nonnegative(), accepted: z.number().int().nonnegative(), skipped: z.number().int().nonnegative(),
  oldestObservedAt:date.nullable().optional(),newestObservedAt:date.nullable().optional(),scannedThroughAt:date.nullable().optional(),
  verifiedCoveredFrom:date.nullable().optional(),verifiedCoveredTo:date.nullable().optional(),pagesRead:z.number().int().nonnegative().optional(),
  searchHops:z.number().int().nonnegative().optional(),
});
export const HISTORY_ATTEMPT_PREFIX='wallet.historyAttempt.';
export const HISTORY_RETRY_MS=15*60_000;
export const HISTORY_REFRESH_MS=12*3_600_000;
const object=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const count=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:0;
const earliest=(...xs:(string|null|undefined)[])=>xs.filter((s):s is string=>typeof s==='string').sort()[0]??null;
const latest=(...xs:(string|null|undefined)[])=>xs.filter((s):s is string=>typeof s==='string').sort().at(-1)??null;

/** Oldest attempt first: admission cannot keep pushing the scan cursor forward forever.
 * Uses persisted DB timestamps for scheduling, not unvalidated JSON date casts. Failures
 * rotate too. One worker runs this job at a time; budget remains two wallets x three pages. */
export async function selectResearchHistoryWallets(db:PrismaClient,now:Date){
  return db.$queryRaw<{id:string;address:string}[]>`
    SELECT w.id,w.address FROM "TrackedWallet" w
    LEFT JOIN "SystemSetting" h ON h.key='wallet.history.' || w.id
    LEFT JOIN "SystemSetting" a ON a.key='wallet.historyAttempt.' || w.id
    WHERE w.active=true AND w."researchReview" <> 'REJECTED'
      AND w."createdAt" <= ${now}
      AND (a.key IS NULL OR a."updatedAt" <= ${new Date(+now-HISTORY_RETRY_MS)})
      AND (h.key IS NULL OR h.value->>'capped' IS DISTINCT FROM 'false' OR h."updatedAt" <= ${new Date(+now-HISTORY_REFRESH_MS)})
    ORDER BY COALESCE(a."updatedAt",h."updatedAt",w."createdAt") ASC,w.id ASC LIMIT 2`;
}

export async function refreshResearchHistory(db: PrismaClient, apiKey: string, now = new Date(), collect = collectWalletHistory) {
  if(!Number.isFinite(+now))throw new Error('Invalid history scheduling date');
  const wallets=await selectResearchHistoryWallets(db,now);
  const out={scanned:0,created:0,capped:0,skipped:0,failures:0,resumed:0,pagesRead:0,searchHops:0};
  const store=makeWalletEventStore(db);
  for(const wallet of wallets){
    const key=`wallet.history.${wallet.id}`,attemptKey=`${HISTORY_ATTEMPT_PREFIX}${wallet.id}`;
    const [previous,attemptRow]=await Promise.all([db.systemSetting.findUnique({where:{key}}),db.systemSetting.findUnique({where:{key:attemptKey}})]);
    const parsed=Progress.safeParse(previous?.value),previousScan=parsed.success?parsed.data:null,oldAttempt=object(attemptRow?.value);
    const resume=previousScan?.capped&&previousScan.nextBefore&&Date.parse(previousScan.scanTo)<=+now?previousScan:null;
    const complete=previousScan&&!previousScan.capped&&Date.parse(previousScan.coveredTo)<=+now?previousScan:null;
    const requestedTo=resume?.scanTo??now.toISOString(),requestedFrom=resume?.scanFrom??complete?.coveredTo??new Date(+now-30*86400000).toISOString();
    const attempts=count(oldAttempt.attempts)+1;
    // Written before provider I/O: interrupted jobs remain visible and rotate fairly.
    const attempt={version:1,attempts,lastAttemptAt:now.toISOString(),lastSuccessAt:previousScan?.checkedAt??null,
      status:'RUNNING',mode:resume?'RESUME':complete?'HEAD':'INITIAL',requestedFrom,requestedTo,
      consecutiveFailures:count(oldAttempt.consecutiveFailures),errorCode:null as string|null,httpStatus:null as number|null,pagesRead:0,searchHops:0};
    await db.systemSetting.upsert({where:{key:attemptKey},create:{key:attemptKey,value:attempt,updatedAt:now},update:{value:attempt,updatedAt:now}});
    let phase:'COLLECT'|'STORE'='COLLECT';
    try{
      const history=await collect(wallet.address,{apiKey,now:new Date(requestedTo),maxPages:3,
        ...(resume?{before:resume.nextBefore!,since:new Date(requestedFrom)}:complete?{since:new Date(requestedFrom)}:{})});
      phase='STORE';attempt.pagesRead=history.pagesRead??0;out.pagesRead+=attempt.pagesRead;
      attempt.searchHops=history.searchHops??0;out.searchHops+=attempt.searchHops;
      for(const e of history.events)if(await store.saveWalletTrade(e)==='created')out.created++;
      const carry=resume??complete;
      const next={checkedAt:now.toISOString(),scanned:(carry?.scanned??0)+history.scanned,accepted:(carry?.accepted??0)+history.events.length,
        skipped:(carry?.skipped??0)+history.skipped,capped:history.capped,nextBefore:history.nextBefore??null,
        scanFrom:history.coveredFrom,scanTo:history.coveredTo,coveredFrom:carry?.coveredFrom??history.coveredFrom,coveredTo:history.coveredTo,windowDays:30,
        // Legacy covered* are requested bounds. Only these fields certify a finished scan.
        verifiedCoveredFrom:history.capped?(carry?.verifiedCoveredFrom??(complete?complete.coveredFrom:null)):(carry?.coveredFrom??history.coveredFrom),
        verifiedCoveredTo:history.capped?(carry?.verifiedCoveredTo??(complete?complete.coveredTo:null)):history.coveredTo,
        oldestObservedAt:earliest(carry?.oldestObservedAt,history.oldestObservedAt),newestObservedAt:latest(carry?.newestObservedAt,history.newestObservedAt),
        scannedThroughAt:earliest(resume?.scannedThroughAt,history.scannedThroughAt),pagesRead:(carry?.pagesRead??0)+attempt.pagesRead,searchHops:(carry?.searchHops??0)+attempt.searchHops};
      const success={...attempt,status:history.capped?'PARTIAL':'COMPLETE',lastSuccessAt:now.toISOString(),consecutiveFailures:0};
      await db.$transaction([
        db.systemSetting.upsert({where:{key},create:{key,value:next,updatedAt:now},update:{value:next,updatedAt:now}}),
        db.systemSetting.upsert({where:{key:attemptKey},create:{key:attemptKey,value:success,updatedAt:now},update:{value:success,updatedAt:now}}),
      ]);
      out.scanned++;if(history.capped)out.capped++;if(resume)out.resumed++;
    }catch(e){
      out.failures++;
      const typed=e instanceof WalletHistoryError;
      if(typed){out.pagesRead+=e.pagesRead;out.searchHops+=e.searchHops;}
      const failure={...attempt,status:'FAILED',consecutiveFailures:attempt.consecutiveFailures+1,
        errorCode:typed?e.code:phase==='STORE'?'PERSISTENCE_FAILED':'COLLECTION_FAILED',httpStatus:typed?e.httpStatus??null:null,pagesRead:typed?e.pagesRead:attempt.pagesRead,searchHops:typed?e.searchHops:attempt.searchHops};
      // Never store raw provider messages/URLs or overwrite the successful continuation checkpoint.
      await db.systemSetting.upsert({where:{key:attemptKey},create:{key:attemptKey,value:failure,updatedAt:now},update:{value:failure,updatedAt:now}});
    }
  }
  return out;
}
