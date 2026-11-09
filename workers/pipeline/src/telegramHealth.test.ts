import {expect,it,vi} from 'vitest';
import type {PrismaClient} from '@narra/database';
import {deliverTelegramFeedHealth} from './telegramHealth';

const now=new Date('2026-10-29T08:00:00Z');
function fixture(){
 const rows=new Map<string,unknown>();let latest:Date|null=new Date(+now-3*3600000);
 rows.set('research.coverage.run.social.latest',{at:new Date(+now-60000).toISOString(),runs:1,counters:{'evidence.HOLDERS_STALE':119,'evidence.HOLDERS_MISSING':3}});
 const db={systemSetting:{findUnique:vi.fn(async({where}:{where:{key:string}})=>({value:rows.get(where.key)})),findMany:vi.fn(async()=>[...rows].map(([key,value])=>({key,value}))),upsert:vi.fn(async({where,create}:{where:{key:string};create:{value:unknown}})=>rows.set(where.key,create.value))},alert:{findFirst:vi.fn(async()=>latest?{createdAt:latest}:null)}};
 const transport={send:vi.fn(async(_chatId:string,_text:string)=>({ok:true}))};return {db:db as unknown as PrismaClient,raw:db,transport,rows,setLatest:(v:Date|null)=>latest=v};
}
it('explains prolonged silence separately, honors six-hour notice cooldown and never changes alert cursors',async()=>{
 const f=fixture(),opts={chatId:'-123',now,transport:f.transport,dryRun:false};
 expect(await deliverTelegramFeedHealth(f.db,opts)).toMatchObject({sent:true});
 const text=f.transport.send.mock.calls[0]![1];expect(text).toContain('STATUS ONLY');expect(text).toContain('119 stale-holder');expect(text).toContain('recent collection status unavailable');
 expect([...f.rows.keys()].some(k=>k.startsWith('integrations.telegram.cursor.'))).toBe(false);
 expect(await deliverTelegramFeedHealth(f.db,{...opts,now:new Date(+now+3600000)})).toMatchObject({sent:false,reason:'NOTICE_COOLDOWN'});expect(f.transport.send).toHaveBeenCalledOnce();
});
it('suppresses notices after recent alerts and supports a truly read-only preview',async()=>{
 const f=fixture();f.setLatest(new Date(+now-60000));
 expect(await deliverTelegramFeedHealth(f.db,{chatId:'-123',now,transport:f.transport})).toMatchObject({reason:'RECENT_ALERT'});
 f.setLatest(null);expect(await deliverTelegramFeedHealth(f.db,{chatId:'-123',now,transport:f.transport})).toMatchObject({reason:'DRY_RUN',text:expect.stringContaining('No Early Radar alerts')});
 expect(f.transport.send).not.toHaveBeenCalled();expect(f.raw.systemSetting.upsert).not.toHaveBeenCalled();
});
it('backs off after failures without recording a successful notice',async()=>{
 const f=fixture();f.transport.send.mockResolvedValue({ok:false});
 const opts={chatId:'-123',now,transport:f.transport,dryRun:false};expect(await deliverTelegramFeedHealth(f.db,opts)).toMatchObject({reason:'SEND_FAILED'});
 expect(await deliverTelegramFeedHealth(f.db,{...opts,now:new Date(+now+6*60000)})).toMatchObject({reason:'RETRY_COOLDOWN'});
 expect(f.rows.get('integrations.telegram.health.-123')).toMatchObject({sentAt:null});
});
