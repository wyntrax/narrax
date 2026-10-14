'use client';
import {useState} from 'react';
import {useMutation,useQuery} from '@tanstack/react-query';
import {useTranslations} from 'next-intl';
import {PrivyAppId,PrivyVerificationKey,RuntimeSettingsInput} from '@narra/shared';
import {ApiError} from '@/lib/api';
import {Loading,ResourceError} from '@/features/research/ui';
import type {AdminApi} from './api';
import type {RuntimeSettings} from './contracts';
import './runtime-card.css';

export function RuntimeCard({api,queryKey}: {api:AdminApi;queryKey:readonly unknown[]}) {
  const t=useTranslations('workspace.runtime');
  const query=useQuery({queryKey,queryFn:()=>api.runtime(),retry:false,gcTime:0});
  return <section className="admin-card admin-wide" aria-labelledby="runtime-title"><h2 id="runtime-title">{t('title')}</h2><p>{t('help')}</p>
    {query.isPending ? <Loading/> : query.isError ? <ResourceError error={query.error} retry={()=>void query.refetch()}/> : <RuntimeForm api={api} initial={query.data} refresh={async()=>{await query.refetch();}}/>}
  </section>;
}

export function RuntimeForm({api,initial,refresh}: {api:AdminApi;initial:RuntimeSettings;refresh:()=>Promise<void>}) {
  const t=useTranslations('workspace.runtime');
  const [appId,setAppId]=useState(initial.privyAppId.value), [key,setKey]=useState(initial.privyVerificationKey.value);
  const [origins,setOrigins]=useState(initial.corsOrigins.extra.join('\n')), [reason,setReason]=useState(''), [override,setOverride]=useState(false);
  const extra=origins.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const authChanged=appId!==initial.privyAppId.value || key!==initial.privyVerificationKey.value;
  const corsChanged=JSON.stringify(extra)!==JSON.stringify(initial.corsOrigins.extra);
  const payload={...(authChanged?{'auth.privy_app_id':appId,'auth.privy_verification_key':key}:{}),...(corsChanged?{'api.cors_origins':extra}:{})};
  const validation=RuntimeSettingsInput.safeParse(payload);
  const valid=validation.success && (authChanged||corsChanged) && !!reason.trim();
  const canCheck=PrivyAppId.safeParse(appId).success && PrivyVerificationKey.safeParse(key).success;
  const save=useMutation({mutationFn:()=>api.save(payload,reason.trim(),authChanged&&override),onSuccess:async()=>{setOverride(false);await refresh();}});
  const check=useMutation({mutationFn:()=>api.checkPrivy(appId,key)});
  const error=(e:unknown)=>{
    const code=e instanceof ApiError?e.code:'';
    if(code==='PRIVY_KEY_MISMATCH')return t('mismatch');
    if(code==='PRIVY_UNREACHABLE')return t('unreachable');
    if(code==='INVALID_PRIVY_KEY'||code==='INVALID_INPUT')return t('invalid');
    if(code==='UNAUTHORIZED'||code==='FORBIDDEN')return t('unauthorized');
    if(code==='RATE_LIMITED')return t('rateLimited');
    return t('error');
  };
  const changed=()=>{save.reset();check.reset();};
  return <form className="admin-form runtime-form" onSubmit={event=>{event.preventDefault();if(valid)save.mutate();}}>
    <div className="admin-field"><label htmlFor="runtime-app">{t('appId')}</label><input id="runtime-app" maxLength={100} value={appId} onChange={event=>{changed();setAppId(event.target.value.trim());}} aria-invalid={!PrivyAppId.safeParse(appId).success}/><small>{t('effective')}: {initial.privyAppId.value} · {t(initial.privyAppId.source)}</small></div>
    <div className="admin-field"><label htmlFor="runtime-key">{t('key')}</label><textarea id="runtime-key" rows={5} maxLength={4096} value={key} onChange={event=>{changed();setKey(event.target.value);}} aria-invalid={!PrivyVerificationKey.safeParse(key).success}/><small>{t('effective')} · {t(initial.privyVerificationKey.source)}</small><details><summary>{t('showKey')}</summary><pre className="admin-code">{initial.privyVerificationKey.value}</pre></details></div>
    <div className="admin-field"><label htmlFor="runtime-origins">{t('origins')}</label><textarea id="runtime-origins" rows={3} value={origins} onChange={event=>{changed();setOrigins(event.target.value);}} aria-invalid={!RuntimeSettingsInput.safeParse({'api.cors_origins':extra}).success}/><small>{t('originsHelp')}</small><p>{t('effective')} · {t(initial.corsOrigins.source)}: {initial.corsOrigins.value.join(', ')||t('none')}</p><small>{t('environment')}: {initial.corsOrigins.environment.join(', ')||t('none')}</small></div>
    <p>{t('recovery')} <code>npm run settings -- reset auth</code></p>
    <label className="admin-check"><input type="checkbox" checked={override} disabled={!authChanged} onChange={event=>{changed();setOverride(event.target.checked);}}/><span>{t('override')}</span></label>
    <div className="admin-field"><label htmlFor="runtime-reason">{t('reason')}</label><input id="runtime-reason" maxLength={300} required value={reason} onChange={event=>{save.reset();setReason(event.target.value);}}/></div>
    <div className="admin-actions"><button type="button" className="research-control" disabled={!canCheck||check.isPending||save.isPending} onClick={()=>check.mutate()}>{t('check')}</button><button type="submit" className="research-control admin-primary" disabled={!valid||save.isPending||check.isPending}>{t('save')}</button></div>
    {!validation.success&&<p role="alert" className="admin-bad">{t('invalid')}</p>}
    {check.isSuccess&&<p role="status" className="admin-ok">{t('checked')}</p>}{check.isError&&<p role="alert" className="admin-bad">{error(check.error)}</p>}
    {save.isSuccess&&<p role="status" className="admin-ok">{t('saved')}</p>}{save.isError&&<p role="alert" className="admin-bad">{error(save.error)}</p>}
  </form>;
}
