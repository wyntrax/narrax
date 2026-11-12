'use client';
import {useState} from 'react';
import {useMutation,useQuery} from '@tanstack/react-query';
import {useTranslations} from 'next-intl';
import {HeliusSettingsInput} from '@narra/shared';
import {ApiError} from '@/lib/api';
import {Loading,ResourceError} from '@/features/research/ui';
import type {AdminApi} from './api';
import type {Helius,HeliusTest} from './contracts';

type PoolName='rpcUrls'|'rpcFallbackUrls'|'holderRpcUrls'|'holderRpcFallbackUrls';
const emptyPools:Record<PoolName,string>={rpcUrls:'',rpcFallbackUrls:'',holderRpcUrls:'',holderRpcFallbackUrls:''};
const poolKeys:Record<PoolName,string>={
 rpcUrls:'integrations.helius.rpc_urls',
 rpcFallbackUrls:'integrations.helius.rpc_fallback_urls',
 holderRpcUrls:'integrations.helius.holder_rpc_urls',
 holderRpcFallbackUrls:'integrations.helius.holder_rpc_fallback_urls',
};
const lines=(value:string)=>value.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
const resultGroups:[keyof HeliusTest,string][]=[['rpc','rpc'],['rpcFallback','rpcFallback'],['holder','holder'],['holderFallback','holderFallback']];

export function HeliusCard({api,queryKey}:{api:AdminApi;queryKey:readonly unknown[]}) {
 const t=useTranslations('workspace.helius');
 const query=useQuery({queryKey,queryFn:()=>api.helius(),retry:false,gcTime:0});
 return <section className="admin-card admin-wide" aria-labelledby="helius-title">
  <h2 id="helius-title">{t('title')}</h2><p>{t('help')}</p>
  {query.isPending?<Loading/>:query.isError?<ResourceError error={query.error} retry={()=>void query.refetch()}/>:<HeliusForm api={api} initial={query.data}/>}
 </section>;
}

export function HeliusForm({api,initial}:{api:AdminApi;initial:Helius}) {
 const t=useTranslations('workspace.helius');
 const [baseline,setBaseline]=useState(initial),[pools,setPools]=useState(emptyPools),
  [apiKey,setApiKey]=useState(''),[webhookSecret,setWebhookSecret]=useState(''),
  [webhookUrl,setWebhookUrl]=useState(initial.webhookUrl.value??''),[reason,setReason]=useState('');
 const reset=()=>{save.reset();test.reset();};
 const setPool=(name:PoolName,value:string)=>{reset();setPools(current=>({...current,[name]:value}));};
 const changedPayload=()=>{
  const payload:Record<string,unknown>={};
  for(const name of Object.keys(poolKeys) as PoolName[]){const urls=lines(pools[name]);if(urls.length)payload[poolKeys[name]]=urls;}
  if(apiKey.trim())payload['integrations.helius.api_key']=apiKey.trim();
  if(webhookSecret.trim())payload['integrations.helius.webhook_secret']=webhookSecret.trim();
  if(webhookUrl.trim()!==(baseline.webhookUrl.value??''))payload['integrations.helius.webhook_url']=webhookUrl.trim();
  return payload;
 };
 const payload=changedPayload();
 const parsed=HeliusSettingsInput.safeParse(payload);
 const changed=Object.keys(payload).length>0;
 const valid=parsed.success&&changed&&!!reason.trim();
 const save=useMutation({mutationFn:()=>api.saveHelius(payload,reason.trim()),onSuccess:next=>{setBaseline(next);setPools(emptyPools);setApiKey('');setWebhookSecret('');setWebhookUrl(next.webhookUrl.value??'');setReason('');}});
 const test=useMutation({mutationFn:()=>{
  const entered:{rpcUrls?:string[];rpcFallbackUrls?:string[];holderRpcUrls?:string[];holderRpcFallbackUrls?:string[]}={};
  for(const name of Object.keys(poolKeys) as PoolName[]){const urls=lines(pools[name]);if(urls.length)entered[name]=urls;}
  return api.testHelius(entered);
 }});
 const source=(value:'database'|'environment'|'default')=>t(value);
 const statusText=(configured:boolean,sourceValue:'database'|'environment'|'default')=>`${t('current')}: ${configured?t('configured'):t('notConfigured')} (${source(sourceValue)})`;
 const poolField=(name:PoolName,id:string,label:string,help:string,view:{configured:number;source:'database'|'environment'|'default'})=><div className="admin-field" key={name}>
  <label htmlFor={id}>{label}</label>
  <textarea id={id} rows={3} maxLength={16_384} spellCheck={false} value={pools[name]} placeholder={view.configured?t('configuredCount',{count:view.configured}):t('missingPlaceholder')} onChange={event=>setPool(name,event.target.value)}/>
  <small>{help} · {t('current')}: {view.configured?t('configuredCount',{count:view.configured}):t('notConfigured')} ({source(view.source)})</small>
 </div>;
 const error=(e:unknown)=>{
  const code=e instanceof ApiError?e.code:'';
  if(code==='INVALID_INPUT')return t('invalid');
  if(code==='HELIUS_RPC_FALLBACK_REQUIRES_PRIMARY')return t('fallbackNeedsPrimary');
  if(code==='HELIUS_NOT_CONFIGURED')return t('notConfiguredError');
  if(code==='UNAUTHORIZED'||code==='FORBIDDEN')return t('unauthorized');
  if(code==='RATE_LIMITED')return t('rateLimited');
  return t('error');
 };
 const code=(value:string)=>t.has(`codes.${value}`)?t(`codes.${value}`):value;
 return <form className="admin-form" onSubmit={event=>{event.preventDefault();if(valid)save.mutate();}}>
  <p className="admin-hint">{t('restart')}</p>
  <div className="admin-inline">
   <span className={`admin-badge ${baseline.ready.rpc?'admin-active':'admin-expired'}`}>{t('readyRpc')}: {baseline.ready.rpc?t('yes'):t('no')}</span>
   <span className={`admin-badge ${baseline.ready.holder?'admin-active':'admin-expired'}`}>{t('readyHolder')}: {baseline.ready.holder?t('yes'):t('no')}</span>
   <span className={`admin-badge ${baseline.ready.webhook?'admin-active':'admin-expired'}`}>{t('readyWebhook')}: {baseline.ready.webhook?t('yes'):t('no')}</span>
  </div>
  {poolField('rpcUrls','helius-rpc-urls',t('rpcUrls'),t('rpcUrlsHelp'),baseline.rpcUrls)}
  {poolField('rpcFallbackUrls','helius-rpc-fallback-urls',t('rpcFallbackUrls'),t('rpcFallbackUrlsHelp'),baseline.rpcFallbackUrls)}
  <div className="admin-field"><label htmlFor="helius-api-key">{t('apiKey')}</label><input id="helius-api-key" type="password" autoComplete="off" spellCheck={false} maxLength={300} value={apiKey} placeholder={baseline.apiKey.configured?t('configuredPlaceholder'):t('missingPlaceholder')} onChange={event=>{reset();setApiKey(event.target.value);}}/><small>{t('apiKeyHelp')} · {statusText(baseline.apiKey.configured,baseline.apiKey.source)}</small></div>
  {poolField('holderRpcUrls','helius-holder-rpc-urls',t('holderRpcUrls'),t('holderRpcUrlsHelp'),baseline.holderRpcUrls)}
  {poolField('holderRpcFallbackUrls','helius-holder-rpc-fallback-urls',t('holderRpcFallbackUrls'),t('holderRpcFallbackUrlsHelp'),baseline.holderRpcFallbackUrls)}
  <div className="admin-field"><label htmlFor="helius-webhook-url">{t('webhookUrl')}</label><input id="helius-webhook-url" maxLength={2048} value={webhookUrl} onChange={event=>{reset();setWebhookUrl(event.target.value);}}/><small>{t('webhookUrlHelp')} · {t('source')}: {source(baseline.webhookUrl.source)}</small></div>
  <div className="admin-field"><label htmlFor="helius-webhook-secret">{t('webhookSecret')}</label><input id="helius-webhook-secret" type="password" autoComplete="off" spellCheck={false} maxLength={500} value={webhookSecret} placeholder={baseline.webhookSecret.configured?t('configuredPlaceholder'):t('missingPlaceholder')} onChange={event=>{reset();setWebhookSecret(event.target.value);}}/><small>{t('webhookSecretHelp')} · {statusText(baseline.webhookSecret.configured,baseline.webhookSecret.source)}</small></div>
  <div className="admin-field"><label htmlFor="helius-reason">{t('reason')}</label><input id="helius-reason" maxLength={300} required value={reason} onChange={event=>{save.reset();setReason(event.target.value);}}/></div>
  <div className="admin-actions">
   <button type="button" className="research-control" disabled={test.isPending||save.isPending} onClick={()=>test.mutate()}>{t('test')}</button>
   <button type="submit" className="research-control admin-primary" disabled={!valid||save.isPending||test.isPending}>{t('save')}</button>
  </div>
  {test.data&&<div className="admin-hint"><p><b>{t('testResults')}</b></p>{resultGroups.map(([group,key])=>{const results=test.data?.[group]??[];return results.length?<div key={group}><b>{t(`endpoints.${key}`)}</b><ul>{results.map((result,index)=><li key={index}>{t('endpointIndex',{index:index+1})}: {result.ok?t('ok'):code(result.code)}{typeof result.status==='number'?` (${result.status})`:''} · {result.latencyMs} ms</li>)}</ul></div>:null;})}</div>}
  {!parsed.success&&changed&&<p role="alert" className="admin-bad">{t('invalid')}</p>}
  {baseline.invalid.length>0&&<p role="alert" className="admin-bad">{t('invalidStored',{keys:baseline.invalid.join(', ')})}</p>}
  {test.isError&&<p role="alert" className="admin-bad">{error(test.error)}</p>}
  {save.isSuccess&&<p role="status" className="admin-ok">{t('saved')}</p>}{save.isError&&<p role="alert" className="admin-bad">{error(save.error)}</p>}
 </form>;
}
