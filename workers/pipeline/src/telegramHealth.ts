import {z} from 'zod';
import type {PrismaClient} from '@narra/database';
import {Diagnostic} from './researchDiagnostics';
import {EARLY_RADAR_ALERT_KINDS,telegramCursorKey,type TelegramTransport} from './telegram';

export const TELEGRAM_HEALTH_LIMITS={checkMs:5*60_000,silenceMs:2*3600_000,noticeMs:6*3600_000,retryMs:15*60_000} as const;
const State=z.object({checkedAt:z.string().datetime(),sentAt:z.string().datetime().nullable(),retryAt:z.string().datetime().nullable()});
/** A separate operational notice, never an investment signal or an alert-cursor update. */
export async function deliverTelegramFeedHealth(db:PrismaClient,opts:{chatId:string;transport?:TelegramTransport;now?:Date;dryRun?:boolean}){
 const now=opts.now??new Date(),dryRun=opts.dryRun??true,key=telegramCursorKey(opts.chatId).replace('integrations.telegram.cursor.','integrations.telegram.health.');
 const parsed=State.safeParse((await db.systemSetting.findUnique({where:{key},select:{value:true}}))?.value),old=parsed.success?parsed.data:null;
 if(old&&+now-Date.parse(old.checkedAt)<TELEGRAM_HEALTH_LIMITS.checkMs)return {sent:false,reason:'CHECK_COOLDOWN'};
 if(old?.retryAt&&Date.parse(old.retryAt)>+now)return {sent:false,reason:'RETRY_COOLDOWN'};
 if(old?.sentAt&&+now-Date.parse(old.sentAt)<TELEGRAM_HEALTH_LIMITS.noticeMs)return {sent:false,reason:'NOTICE_COOLDOWN'};
 const latest=await db.alert.findFirst({where:{userId:null,kind:{in:[...EARLY_RADAR_ALERT_KINDS]},refType:'TOKEN',refId:{not:null},createdAt:{lte:now}},orderBy:{createdAt:'desc'},select:{createdAt:true}});
 const persist=async(sentAt=old?.sentAt??null,retryAt:string|null=null)=>{if(dryRun)return;const value={checkedAt:now.toISOString(),sentAt,retryAt};await db.systemSetting.upsert({where:{key},create:{key,value},update:{value}});};
 if(latest&&+now-+latest.createdAt<TELEGRAM_HEALTH_LIMITS.silenceMs){await persist();return {sent:false,reason:'RECENT_ALERT'};}
 const stages=['social','narrative','market'];
 const rows=await db.systemSetting.findMany({where:{key:{in:stages.map(s=>`research.coverage.run.${s}.latest`)}},select:{key:true,value:true}});
 const lines=['NARRAX FEED HEALTH · STATUS ONLY','',latest?`No new Early Radar alert since ${latest.createdAt.toISOString().replace('T',' ').replace('.000Z',' UTC')}.`:'No Early Radar alerts have been recorded.'];
 for(const stage of stages){
  const d=Diagnostic.safeParse(rows.find(r=>r.key===`research.coverage.run.${stage}.latest`)?.value);
  if(!d.success||Date.parse(d.data.at)>+now||+now-Date.parse(d.data.at)>30*60_000){lines.push(`${stage}: recent collection status unavailable.`);continue;}
  const c=d.data.counters;
   if(stage==='market')lines.push(c.holderFallbackWritten==null||c.holderFallbackUnknown==null?'Latest market run: RPC holder fallback diagnostics unavailable.':`Latest market run: ${c.holderFallbackWritten} fresh RPC holder snapshots; ${c.holderFallbackUnknown} fallback reads unresolved.`);
  else lines.push(`Latest ${stage} scan: ${c['evidence.HOLDERS_STALE']??0} stale-holder skips, ${c['evidence.HOLDERS_MISSING']??0} missing-holder skips, ${c['evidence.MARKET_STALE']??0} stale-price skips.`);
 }
 lines.push('','Counts describe the latest scans, not unique missed opportunities.','Freshness and qualification checks remain enforced. Silence does not establish that the market has no opportunities.','This is an automated service-status notice, not a token alert.');
 const text=lines.join('\n');
 if(dryRun)return {sent:false,reason:'DRY_RUN',text};
 if(!opts.transport)throw Error('telegram health transport required');
 let result;try{result=await opts.transport.send(opts.chatId,text);}catch{await persist(old?.sentAt??null,new Date(+now+TELEGRAM_HEALTH_LIMITS.retryMs).toISOString());return {sent:false,reason:'SEND_FAILED'};}
 if(result.ok){await persist(now.toISOString());return {sent:true,reason:'QUIET_FEED'};}
 const retry=Number.isFinite(result.retryAfterSeconds)&&result.retryAfterSeconds!>=0?Math.min(result.retryAfterSeconds!*1000,7*86400000):0;
 await persist(old?.sentAt??null,new Date(+now+Math.max(TELEGRAM_HEALTH_LIMITS.retryMs,retry)).toISOString());
 return {sent:false,reason:'SEND_FAILED'};
}
