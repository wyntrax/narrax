import {z} from 'zod';
import type {PrismaClient} from '@narra/database';
import {Diagnostic} from './researchDiagnostics';
import {EARLY_RADAR_ALERT_KINDS,telegramCursorKey,type TelegramTransport} from './telegram';

export const TELEGRAM_HEALTH_LIMITS={checkMs:5*60_000,silenceMs:2*3600_000,noticeMs:6*3600_000,retryMs:15*60_000} as const;
const State=z.object({checkedAt:z.string().datetime(),sentAt:z.string().datetime().nullable(),retryAt:z.string().datetime().nullable()});

const STAGE_LABELS:Record<'social'|'narrative'|'market',{icon:string;title:string}>={
 social:{icon:'💬',title:'Social Scan'},
 narrative:{icon:'🔎',title:'Narrative Scan'},
 market:{icon:'📊',title:'Market Run'},
};

function formatUtcTimestamp(at:Date):string{
 return at.toISOString().replace('T',' ').replace(/\.\d+Z$/,' UTC');
}

function formatQuietDuration(ms:number):string{
 const totalMinutes=Math.max(1,Math.floor(ms/60_000));
 const days=Math.floor(totalMinutes/1_440);
 const hours=Math.floor((totalMinutes%1_440)/60);
 const mins=totalMinutes%60;
 if(days>0)return hours>0?`${days}d ${hours}h`:`${days}d`;
 if(hours>0)return mins>0?`${hours}h ${mins}m`:`${hours}h`;
 return `${mins}m`;
}

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
 const stages=['social','narrative','market'] as const;
 const rows=await db.systemSetting.findMany({where:{key:{in:stages.map(s=>`research.coverage.run.${s}.latest`)}},select:{key:true,value:true}});
 const quietLine=latest
  ?`⏳ No new Early Radar alert for <b>${formatQuietDuration(+now-+latest.createdAt)}</b> (last: ${formatUtcTimestamp(latest.createdAt)})`
  :'⏳ No Early Radar alerts have been recorded yet.';
 const lines=['📡 <b>NARRAX FEED HEALTH</b> · <i>STATUS ONLY</i>','',quietLine];
 for(const stage of stages){
  const {icon,title}=STAGE_LABELS[stage];
  lines.push('',`${icon} <b>${title}</b>`);
  const d=Diagnostic.safeParse(rows.find(r=>r.key===`research.coverage.run.${stage}.latest`)?.value);
  if(!d.success||Date.parse(d.data.at)>+now||+now-Date.parse(d.data.at)>30*60_000){lines.push('• recent collection status unavailable');continue;}
  const c=d.data.counters;
  if(stage==='market')lines.push(c.holderFallbackWritten==null||c.holderFallbackUnknown==null?'• RPC holder fallback diagnostics unavailable':`• RPC holder snapshots: ${c.holderFallbackWritten} fresh · Unresolved fallback: ${c.holderFallbackUnknown}`);
  else lines.push(`• Stale holders: ${c['evidence.HOLDERS_STALE']??0} · Missing: ${c['evidence.HOLDERS_MISSING']??0} · Stale price: ${c['evidence.MARKET_STALE']??0}`);
 }
 lines.push('','<i>Counts describe the latest scans, not unique missed opportunities. Freshness and qualification checks remain enforced — automated service-status notice, not a token alert.</i>');
 const text=lines.join('\n');
 if(dryRun)return {sent:false,reason:'DRY_RUN',text};
 if(!opts.transport)throw Error('telegram health transport required');
 let result;try{result=await opts.transport.send(opts.chatId,text,{parseMode:'HTML'});}catch{await persist(old?.sentAt??null,new Date(+now+TELEGRAM_HEALTH_LIMITS.retryMs).toISOString());return {sent:false,reason:'SEND_FAILED'};}
 if(result.ok){await persist(now.toISOString());return {sent:true,reason:'QUIET_FEED'};}
 const retry=Number.isFinite(result.retryAfterSeconds)&&result.retryAfterSeconds!>=0?Math.min(result.retryAfterSeconds!*1000,7*86400000):0;
 await persist(old?.sentAt??null,new Date(+now+Math.max(TELEGRAM_HEALTH_LIMITS.retryMs,retry)).toISOString());
 return {sent:false,reason:'SEND_FAILED'};
}
