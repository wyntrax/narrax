'use client';
import {useState} from 'react';
import {useMutation,useQuery} from '@tanstack/react-query';
import {useTranslations} from 'next-intl';
import {IntegrationSettingsInput,TelegramChatId} from '@narra/shared';
import {ApiError} from '@/lib/api';
import {Loading,ResourceError} from '@/features/research/ui';
import type {AdminApi} from './api';
import type {Integrations} from './contracts';
import './integrations-card.css';

type Form={telegramEnabled:boolean;chatId:string;botToken:string;maxAgeMin:string;maxPerRun:string;sendDelayMs:string;tregEnabled:boolean;tregToken:string;tregOrg:string};

const text=(value:string|null)=>value??'';
const number=(value:number)=>String(value);
const fromView=(view:Integrations):Form=>({
  telegramEnabled:view.telegram.enabled.value,
  chatId:text(view.telegram.chatId.value),
  botToken:'',
  maxAgeMin:number(view.telegram.maxAgeMin.value),
  maxPerRun:number(view.telegram.maxPerRun.value),
  sendDelayMs:number(view.telegram.sendDelayMs.value),
  tregEnabled:view.treg.enabled.value,
  tregToken:'',
  tregOrg:text(view.treg.org.value),
});
const digits=(value:string)=>value.trim()&&/^\d+$/.test(value.trim())?Number(value.trim()):NaN;

export function IntegrationsCard({api,queryKey}:{api:AdminApi;queryKey:readonly unknown[]}) {
  const t=useTranslations('workspace.integrations');
  const query=useQuery({queryKey,queryFn:()=>api.integrations(),retry:false,gcTime:0});
  return <section className="admin-card admin-wide" aria-labelledby="integrations-title">
    <h2 id="integrations-title">{t('title')}</h2><p>{t('help')}</p>
    {query.isPending?<Loading/>:query.isError?<ResourceError error={query.error} retry={()=>void query.refetch()}/>:<IntegrationsForm api={api} initial={query.data}/>}
  </section>;
}

export function IntegrationsForm({api,initial}:{api:AdminApi;initial:Integrations}) {
  const t=useTranslations('workspace.integrations');
  const [baseline,setBaseline]=useState(initial),[form,setForm]=useState(()=>fromView(initial)),[reason,setReason]=useState('');
  const set=<K extends keyof Form>(key:K,value:Form[K])=>{save.reset();test.reset();setForm(current=>({...current,[key]:value}));};
  const changedPayload=()=>{
    const payload:Record<string,unknown>={};
    if(form.telegramEnabled!==baseline.telegram.enabled.value)payload['integrations.telegram.enabled']=form.telegramEnabled;
    if(form.chatId.trim()!==text(baseline.telegram.chatId.value))payload['integrations.telegram.chat_id']=form.chatId.trim();
    if(form.botToken.trim())payload['integrations.telegram.bot_token']=form.botToken.trim();
    if(form.maxAgeMin!==number(baseline.telegram.maxAgeMin.value))payload['integrations.telegram.max_age_min']=digits(form.maxAgeMin);
    if(form.maxPerRun!==number(baseline.telegram.maxPerRun.value))payload['integrations.telegram.max_per_run']=digits(form.maxPerRun);
    if(form.sendDelayMs!==number(baseline.telegram.sendDelayMs.value))payload['integrations.telegram.send_delay_ms']=digits(form.sendDelayMs);
    if(form.tregEnabled!==baseline.treg.enabled.value)payload['integrations.treg.enabled']=form.tregEnabled;
    if(form.tregToken.trim())payload['integrations.treg.token']=form.tregToken.trim();
    if(form.tregOrg.trim()!==text(baseline.treg.org.value))payload['integrations.treg.org']=form.tregOrg.trim();
    return payload;
  };
  const payload=changedPayload();
  const parsed=IntegrationSettingsInput.safeParse(payload);
  const changed=Object.keys(payload).length>0;
  const valid=parsed.success&&changed&&!!reason.trim();
  const save=useMutation({mutationFn:()=>api.saveIntegrations(parsed.success?payload:{},reason.trim()),onSuccess:next=>{setBaseline(next);setForm(fromView(next));setReason('');}});
  const chatValid=TelegramChatId.safeParse(form.chatId.trim()).success;
  const tokenAvailable=!!form.botToken.trim()||baseline.telegram.botToken.configured;
  const test=useMutation({mutationFn:()=>api.testTelegram(form.chatId.trim()||undefined,form.botToken.trim()||undefined)});
  const error=(e:unknown)=>{
    const code=e instanceof ApiError?e.code:'';
    if(code==='TELEGRAM_NOT_CONFIGURED')return t('notConfiguredError');
    if(code==='TELEGRAM_TEST_FAILED')return t('testFailed');
    if(code==='TREG_TOKEN_REQUIRED')return t('tregTokenRequired');
    if(code==='INVALID_INPUT')return t('invalid');
    if(code==='UNAUTHORIZED'||code==='FORBIDDEN')return t('unauthorized');
    if(code==='RATE_LIMITED')return t('rateLimited');
    return t('error');
  };
  const source=(value:'database'|'environment'|'default')=>t(value);
  return <form className="admin-form" onSubmit={event=>{event.preventDefault();if(valid)save.mutate();}}>
    <fieldset className="integrations-group"><legend><b>{t('telegram')}</b></legend><small>{t('telegramHelp')}</small>
      <label className="admin-check"><input type="checkbox" checked={form.telegramEnabled} onChange={event=>set('telegramEnabled',event.target.checked)}/><span><b>{t('enabled')}</b><small>{t('telegramEnabledHelp')}</small></span></label>
      <div className="admin-field"><label htmlFor="integration-chat">{t('chatId')}</label><input id="integration-chat" value={form.chatId} maxLength={100} placeholder="-1001234567890" onChange={event=>set('chatId',event.target.value.trim())} aria-invalid={!chatValid}/><small>{t('chatIdHelp')} · {t('source')}: {source(baseline.telegram.chatId.source)}</small></div>
      <div className="admin-field"><label htmlFor="integration-bot-token">{t('botToken')}</label><input id="integration-bot-token" type="password" autoComplete="off" spellCheck={false} maxLength={300} value={form.botToken} placeholder={baseline.telegram.botToken.configured?t('tokenSaved'):t('tokenMissing')} onChange={event=>set('botToken',event.target.value)}/><small>{t('botTokenHelp')} · {t('current')}: {baseline.telegram.botToken.configured?t('configured'):t('notConfigured')} ({source(baseline.telegram.botToken.source)})</small></div>
      <div className="admin-field"><label htmlFor="integration-max-age">{t('maxAge')}</label><input id="integration-max-age" inputMode="numeric" value={form.maxAgeMin} onChange={event=>set('maxAgeMin',event.target.value.trim())}/></div>
      <div className="admin-field"><label htmlFor="integration-max-run">{t('maxPerRun')}</label><input id="integration-max-run" inputMode="numeric" value={form.maxPerRun} onChange={event=>set('maxPerRun',event.target.value.trim())}/></div>
      <div className="admin-field"><label htmlFor="integration-delay">{t('sendDelay')}</label><input id="integration-delay" inputMode="numeric" value={form.sendDelayMs} onChange={event=>set('sendDelayMs',event.target.value.trim())}/></div>
      <div className="admin-actions"><button type="button" className="research-control" disabled={!chatValid||!tokenAvailable||test.isPending||save.isPending} onClick={()=>test.mutate()}>{t('test')}</button></div>
      {test.isSuccess&&<p role="status" className="admin-ok">{t('tested')}</p>}{test.isError&&<p role="alert" className="admin-bad">{error(test.error)}</p>}
    </fieldset>
    <fieldset className="integrations-group"><legend><b>{t('treg')}</b></legend><small>{t('tregHelp')}</small>
      <label className="admin-check"><input type="checkbox" checked={form.tregEnabled} onChange={event=>set('tregEnabled',event.target.checked)}/><span><b>{t('enabled')}</b><small>{t('tregEnabledHelp')}</small></span></label>
      <div className="admin-field"><label htmlFor="integration-treg-token">{t('tregToken')}</label><input id="integration-treg-token" type="password" autoComplete="off" spellCheck={false} maxLength={500} value={form.tregToken} placeholder={baseline.treg.token.configured?t('tokenSaved'):t('tokenMissing')} onChange={event=>set('tregToken',event.target.value)}/><small>{t('tregTokenHelp')} · {t('current')}: {baseline.treg.token.configured?t('configured'):t('notConfigured')} ({source(baseline.treg.token.source)})</small></div>
      <div className="admin-field"><label htmlFor="integration-treg-org">{t('tregOrg')}</label><input id="integration-treg-org" maxLength={200} value={form.tregOrg} onChange={event=>set('tregOrg',event.target.value.trim())}/><small>{t('tregOrgHelp')} · {t('source')}: {source(baseline.treg.org.source)}</small></div>
    </fieldset>
    <div className="admin-field"><label htmlFor="integration-reason">{t('reason')}</label><input id="integration-reason" maxLength={300} required value={reason} onChange={event=>{save.reset();setReason(event.target.value);}}/></div>
    <div className="admin-actions"><button type="submit" className="research-control admin-primary" disabled={!valid||save.isPending}>{t('save')}</button></div>
    {!parsed.success&&changed&&<p role="alert" className="admin-bad">{t('invalid')}</p>}
    {baseline.invalid.length>0&&<p role="alert" className="admin-bad">{t('invalidStored',{keys:baseline.invalid.join(', ')})}</p>}
    {save.isSuccess&&<p role="status" className="admin-ok">{t('saved')}</p>}{save.isError&&<p role="alert" className="admin-bad">{error(save.error)}</p>}
  </form>;
}
