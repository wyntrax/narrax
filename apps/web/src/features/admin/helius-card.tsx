'use client';
import {useState} from 'react';
import {useMutation,useQuery} from '@tanstack/react-query';
import {useTranslations} from 'next-intl';
import {HeliusSettingsInput} from '@narra/shared';
import {ApiError} from '@/lib/api';
import {Loading,ResourceError} from '@/features/research/ui';
import type {AdminApi} from './api';
import type {Helius,HeliusTest} from './contracts';

type SecretName='rpcUrl'|'rpcFallbackUrl'|'apiKey'|'holderRpcUrl'|'holderRpcFallbackUrl'|'webhookSecret';
const emptySecrets:Record<SecretName,string>={rpcUrl:'',rpcFallbackUrl:'',apiKey:'',holderRpcUrl:'',holderRpcFallbackUrl:'',webhookSecret:''};
const secretKeys:Record<SecretName,string>={
 rpcUrl:'integrations.helius.rpc_url',
 rpcFallbackUrl:'integrations.helius.rpc_fallback_url',
 apiKey:'integrations.helius.api_key',
 holderRpcUrl:'integrations.helius.holder_rpc_url',
 holderRpcFallbackUrl:'integrations.helius.holder_rpc_fallback_url',
 webhookSecret:'integrations.helius.webhook_secret',
};
const testKeys:{name:keyof HeliusTest;field:SecretName}[]=[
 {name:'primary',field:'rpcUrl'},
 {name:'fallback',field:'rpcFallbackUrl'},
 {name:'holder',field:'holderRpcUrl'},
 {name:'holderFallback',field:'holderRpcFallbackUrl'},
];

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
 const [baseline,setBaseline]=useState(initial),[secrets,setSecrets]=useState(emptySecrets),[webhookUrl,setWebhookUrl]=useState(initial.webhookUrl.value??''),[reason,setReason]=useState('');
 const set=(name:SecretName,value:string)=>{save.reset();test.reset();setSecrets(current=>({...current,[name]:value}));};
 const changedPayload=()=>{
  const payload:Record<string,unknown>={};
  for(const name of Object.keys(secretKeys) as SecretName[])if(secrets[name].trim())payload[secretKeys[name]]=secrets[name].trim();
  if(webhookUrl.trim()!==(baseline.webhookUrl.value??''))payload['integrations.helius.webhook_url']=webhookUrl.trim();
  return payload;
 };
 const payload=changedPayload();
 const parsed=HeliusSettingsInput.safeParse(payload);
 const changed=Object.keys(payload).length>0;
 const valid=parsed.success&&changed&&!!reason.trim();
 const save=useMutation({mutationFn:()=>api.saveHelius(payload,reason.trim()),onSuccess:next=>{setBaseline(next);setSecrets(emptySecrets);setWebhookUrl(next.webhookUrl.value??'');setReason('');}});
 const test=useMutation({mutationFn:()=>{
  const entered:{rpcUrl?:string;rpcFallbackUrl?:string;holderRpcUrl?:string;holderRpcFallbackUrl?:string}={};
  if(secrets.rpcUrl.trim())entered.rpcUrl=secrets.rpcUrl.trim();
  if(secrets.rpcFallbackUrl.trim())entered.rpcFallbackUrl=secrets.rpcFallbackUrl.trim();
  if(secrets.holderRpcUrl.trim())entered.holderRpcUrl=secrets.holderRpcUrl.trim();
  if(secrets.holderRpcFallbackUrl.trim())entered.holderRpcFallbackUrl=secrets.holderRpcFallbackUrl.trim();
  return api.testHelius(entered);
 }});
 const source=(value:'database'|'environment'|'default')=>t(value);
 const field=(name:SecretName,id:string,label:string,help:string,view:{configured:boolean;source:'database'|'environment'|'default'})=><div className="admin-field" key={name}>
  <label htmlFor={id}>{label}</label>
  <input id={id} type="password" autoComplete="off" spellCheck={false} maxLength={2048} value={secrets[name]} placeholder={view.configured?t('configuredPlaceholder'):t('missingPlaceholder')} onChange={event=>set(name,event.target.value)}/>
  <small>{help} · {t('current')}: {view.configured?t('configured'):t('notConfigured')} ({source(view.source)})</small>
 </div>;
 const error=(e:unknown)=>{
  const code=e instanceof ApiError?e.code:'';
  if(code==='INVALID_INPUT')return t('invalid');
  if(code==='HELIUS_RPC_FALLBACK_REQUIRES_PRIMARY')return t('fallbackNeedsPrimary');
  if(code==='HELIUS_RPC_FALLBACK_DUPLICATE')return t('fallbackDuplicate');
  if(code==='HOLDER_RPC_FALLBACK_DUPLICATE')return t('holderFallbackDuplicate');
  if(code==='HELIUS_NOT_CONFIGURED')return t('notConfiguredError');
  if(code==='UNAUTHORIZED'||code==='FORBIDDEN')return t('unauthorized');
  if(code==='RATE_LIMITED')return t('rateLimited');
  return t('error');
 };
 const code=(value:string)=>t.has(`codes.${value}`)?t(`codes.${value}`):value;
 return <form className="admin-form" onSubmit={event=>{event.preventDefault();if(valid)save.mutate();}}>
  <p className="admin-hint">{t('restart')}</p>
  <div className="admin-inline admin-helius-status">
   <span className={`admin-badge ${baseline.ready.rpc?'admin-active':'admin-expired'}`}>{t('readyRpc')}: {baseline.ready.rpc?t('yes'):t('no')}</span>
   <span className={`admin-badge ${baseline.ready.holder?'admin-active':'admin-expired'}`}>{t('readyHolder')}: {baseline.ready.holder?t('yes'):t('no')}</span>
   <span className={`admin-badge ${baseline.ready.webhook?'admin-active':'admin-expired'}`}>{t('readyWebhook')}: {baseline.ready.webhook?t('yes'):t('no')}</span>
  </div>
  {field('rpcUrl','helius-rpc-url',t('rpcUrl'),t('rpcUrlHelp'),baseline.rpcUrl)}
  {field('rpcFallbackUrl','helius-rpc-fallback',t('rpcFallbackUrl'),t('rpcFallbackUrlHelp'),baseline.rpcFallbackUrl)}
  {field('apiKey','helius-api-key',t('apiKey'),t('apiKeyHelp'),baseline.apiKey)}
  {field('holderRpcUrl','helius-holder-rpc',t('holderRpcUrl'),t('holderRpcUrlHelp'),baseline.holderRpcUrl)}
  {field('holderRpcFallbackUrl','helius-holder-fallback',t('holderRpcFallbackUrl'),t('holderRpcFallbackUrlHelp'),baseline.holderRpcFallbackUrl)}
  <div className="admin-field"><label htmlFor="helius-webhook-url">{t('webhookUrl')}</label><input id="helius-webhook-url" maxLength={2048} value={webhookUrl} onChange={event=>{save.reset();test.reset();setWebhookUrl(event.target.value);}}/><small>{t('webhookUrlHelp')} · {t('source')}: {source(baseline.webhookUrl.source)}</small></div>
  {field('webhookSecret','helius-webhook-secret',t('webhookSecret'),t('webhookSecretHelp'),baseline.webhookSecret)}
  <div className="admin-field"><label htmlFor="helius-reason">{t('reason')}</label><input id="helius-reason" maxLength={300} required value={reason} onChange={event=>{save.reset();setReason(event.target.value);}}/></div>
  <div className="admin-actions">
   <button type="button" className="research-control" disabled={test.isPending||save.isPending} onClick={()=>test.mutate()}>{t('test')}</button>
   <button type="submit" className="research-control admin-primary" disabled={!valid||save.isPending||test.isPending}>{t('save')}</button>
  </div>
  {test.data&&<ul className="admin-hint" aria-label={t('testResults')}>{testKeys.map(({name})=>{const result=test.data?.[name];return result?<li key={name}>{t(`endpoints.${name}`)}: {result.ok?t('ok'):code(result.code)}{typeof result.status==='number'?` (${result.status})`:''} · {result.latencyMs} ms</li>:null;})}</ul>}
  {!parsed.success&&changed&&<p role="alert" className="admin-bad">{t('invalid')}</p>}
  {baseline.invalid.length>0&&<p role="alert" className="admin-bad">{t('invalidStored',{keys:baseline.invalid.join(', ')})}</p>}
  {test.isError&&<p role="alert" className="admin-bad">{error(test.error)}</p>}
  {save.isSuccess&&<p role="status" className="admin-ok">{t('saved')}</p>}{save.isError&&<p role="alert" className="admin-bad">{error(save.error)}</p>}
 </form>;
}
