import {describe,expect,it} from 'vitest';
import {IntegrationSettingsInput,effectiveIntegrations,isSecretIntegrationKey,telegramConfigured,tregConfigured} from './integration-settings';

const env={TELEGRAM_BOT_TOKEN:'env-bot',TELEGRAM_CHAT_ID:'-1001',TELEGRAM_MAX_AGE_MIN:'5',TELEGRAM_MAX_PER_RUN:'3',TELEGRAM_SEND_DELAY_MS:'0',TREG_NARRATIVE_ENABLED:'true',TREG_TOKEN:'env-treg',TREG_ORG:'env-org'};

describe('integration settings',()=>{
 it('uses environment values and defaults when nothing is saved',()=>{
  const settings=effectiveIntegrations([],env);
  expect(settings.telegram).toMatchObject({
   enabled:{value:true,source:'default'},
   botToken:{value:'env-bot',source:'environment'},
   chatId:{value:'-1001',source:'environment'},
   maxAgeMin:{value:5,source:'environment'},
   maxPerRun:{value:3,source:'environment'},
   sendDelayMs:{value:0,source:'environment'},
  });
  expect(settings.treg).toMatchObject({enabled:{value:true,source:'environment'},token:{value:'env-treg',source:'environment'},org:{value:'env-org',source:'environment'}});
  expect(telegramConfigured(settings.telegram)).toBe(true);
  expect(tregConfigured(settings.treg)).toBe(true);
 });
 it('lets a saved value win over the environment and never lets it loosen a numeric bound',()=>{
  const settings=effectiveIntegrations([
   {key:'integrations.telegram.enabled',value:false},
   {key:'integrations.telegram.chat_id',value:'-100999'},
   {key:'integrations.telegram.max_age_min',value:30},
   {key:'integrations.treg.enabled',value:false},
   {key:'integrations.treg.token',value:'db-treg'},
  ],env);
  expect(settings.telegram.enabled).toEqual({value:false,source:'database'});
  expect(settings.telegram.chatId).toEqual({value:'-100999',source:'database'});
  expect(settings.telegram.maxAgeMin).toEqual({value:30,source:'database'});
  expect(settings.telegram.botToken).toEqual({value:'env-bot',source:'environment'});
  expect(settings.treg).toMatchObject({enabled:{value:false,source:'database'},token:{value:'db-treg',source:'database'},org:{value:'env-org',source:'environment'}});
  expect(telegramConfigured(settings.telegram)).toBe(false);
  expect(tregConfigured(settings.treg)).toBe(false);
 });
 it('ignores invalid stored values instead of applying them',()=>{
  const settings=effectiveIntegrations([
   {key:'integrations.telegram.chat_id',value:'not a chat'},
   {key:'integrations.telegram.max_per_run',value:500},
   {key:'integrations.treg.token',value:''},
  ],env);
  expect(settings.telegram.chatId).toEqual({value:'-1001',source:'environment'});
  expect(settings.telegram.maxPerRun).toEqual({value:3,source:'environment'});
  expect(settings.treg.token).toEqual({value:'env-treg',source:'environment'});
  expect(settings.invalid.sort()).toEqual(['integrations.telegram.chat_id','integrations.telegram.max_per_run','integrations.treg.token']);
 });
 it('is off by default and clamps environment limits like the worker did',()=>{
  const settings=effectiveIntegrations([],{TELEGRAM_MAX_PER_RUN:'99',TELEGRAM_SEND_DELAY_MS:'999999'});
  expect(settings.telegram.enabled).toEqual({value:true,source:'default'});
  expect(settings.telegram.maxPerRun).toEqual({value:20,source:'environment'});
  expect(settings.telegram.sendDelayMs).toEqual({value:60000,source:'environment'});
  expect(settings.treg.enabled).toEqual({value:false,source:'default'});
  expect(effectiveIntegrations([],{TELEGRAM_ENABLED:'FALSE'}).telegram.enabled).toEqual({value:false,source:'environment'});
 });
 it('accepts only known keys and marks both credentials as write-only',()=>{
  expect(IntegrationSettingsInput.safeParse({'integrations.telegram.chat_id':'-100123','integrations.telegram.enabled':true}).success).toBe(true);
  expect(IntegrationSettingsInput.safeParse({'integrations.telegram.chat_id':'https://evil.example'}).success).toBe(false);
  expect(IntegrationSettingsInput.safeParse({'integrations.telegram.max_per_run':21}).success).toBe(false);
  expect(IntegrationSettingsInput.safeParse({'integrations.telegram.api_key':'x'}).success).toBe(false);
  expect(['integrations.telegram.bot_token','integrations.treg.token'].every(isSecretIntegrationKey)).toBe(true);
  expect(isSecretIntegrationKey('integrations.telegram.chat_id')).toBe(false);
 });
});
