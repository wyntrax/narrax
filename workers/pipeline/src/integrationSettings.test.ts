import {describe,expect,it} from 'vitest';
import type {PrismaClient} from '@narra/database';
import {telegramConfigFromSettings} from './telegram';
import {tregConfigFromSettings} from './integrationSettings';

const dbWith=(rows:{key:string;value:unknown}[])=>({
 systemSetting:{findMany:async()=>rows},
} as unknown as PrismaClient);

describe('admin-managed integration settings',()=>{
 it('uses saved Telegram values over the environment and returns null when disabled or incomplete',async()=>{
  const config=await telegramConfigFromSettings(dbWith([
   {key:'integrations.telegram.enabled',value:true},
   {key:'integrations.telegram.bot_token',value:'db-bot'},
   {key:'integrations.telegram.chat_id',value:'-100123'},
   {key:'integrations.telegram.max_age_min',value:7},
   {key:'integrations.telegram.max_per_run',value:2},
   {key:'integrations.telegram.send_delay_ms',value:0},
  ]),{TELEGRAM_BOT_TOKEN:'env-bot',TELEGRAM_CHAT_ID:'-1'});
  expect(config).toMatchObject({token:'db-bot',chatId:'-100123',maxAgeMs:7*60_000,limit:2,delayMs:0});
  expect(await telegramConfigFromSettings(dbWith([{key:'integrations.telegram.enabled',value:false}]),{TELEGRAM_BOT_TOKEN:'env-bot',TELEGRAM_CHAT_ID:'-1'})).toBeNull();
  expect(await telegramConfigFromSettings(dbWith([{key:'integrations.telegram.enabled',value:true}]),{TELEGRAM_BOT_TOKEN:'env-bot'})).toBeNull();
 });
 it('keeps the saved Telegram token when only the chat changes',async()=>{
  const config=await telegramConfigFromSettings(dbWith([
   {key:'integrations.telegram.bot_token',value:'db-bot'},
   {key:'integrations.telegram.chat_id',value:'-100999'},
  ]),{});
  expect(config).toMatchObject({token:'db-bot',chatId:'-100999',maxAgeMs:15*60_000,limit:10,delayMs:1200});
 });
 it('reads the saved Treg token and falls back to one bounded topic pack',async()=>{
  const integration=await tregConfigFromSettings(dbWith([
   {key:'integrations.treg.enabled',value:true},
   {key:'integrations.treg.token',value:'db-treg'},
   {key:'integrations.treg.org',value:'narra'},
  ]),{});
  expect(integration?.token).toBe('db-treg');
  expect(integration?.org).toBe('narra');
  expect(integration?.config.topics.length).toBeGreaterThan(0);
  expect(integration?.config.topics.length).toBeLessThanOrEqual(10);
 });
 it('keeps Treg off without enablement and refuses to enable it without a token',async()=>{
  expect(await tregConfigFromSettings(dbWith([]),{})).toBeNull();
  await expect(tregConfigFromSettings(dbWith([{key:'integrations.treg.enabled',value:true}]),{})).rejects.toThrow('TREG_TOKEN_REQUIRED');
 });
});
