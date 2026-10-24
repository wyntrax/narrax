'use client';
import {useState} from 'react';
import {useMutation,useQueryClient} from '@tanstack/react-query';
import {useTranslations} from 'next-intl';
import {FEATURE_TIERS,FeatureOverrides,RESEARCH_TIERS,activeTier,type AccessTier} from '@narra/shared';
import type {AdminApi} from './api';

/** Same overrides consumed by HTTP gates and Agent research tools. Preserve existing age restrictions. */
export function FeaturesCard({api,items}:{api:AdminApi;items:{key:string;value?:unknown}[]}){
 const t=useTranslations('workspace'),client=useQueryClient();
 const raw=items.find(row=>row.key==='entitlements.features')?.value;
 const parsed=FeatureOverrides.safeParse(raw===undefined?{}:raw);
 const [levels,setLevels]=useState<Record<string,AccessTier>>(()=>Object.fromEntries(Object.entries(FEATURE_TIERS).map(([key,base])=>[key,activeTier(parsed.success?(parsed.data[key]?.requiredTier??base):base)])));
 const [reason,setReason]=useState('');
 const save=useMutation({mutationFn:()=>{
  if(!parsed.success)throw new Error('INVALID_INPUT');
  return api.save({'entitlements.features':Object.fromEntries(Object.keys(FEATURE_TIERS).map(key=>[key,{...parsed.data[key],requiredTier:levels[key]}]))},reason.trim());
 },onSuccess:async()=>{await client.invalidateQueries({queryKey:['workspace-access']});}});
 return <section className="admin-card admin-wide" aria-labelledby="admin-features">
  <h2 id="admin-features">{t('featureAccess.title')}</h2><p>{t('featureAccess.help')}</p>
  <p className="admin-hint">{t('featureAccess.enforcement')}</p>
  {!parsed.success?<p role="alert" className="admin-bad">{t('featureAccess.invalid')}</p>:<form className="admin-form" onSubmit={e=>{e.preventDefault();if(reason.trim())save.mutate();}}>
   <div className="admin-feature-grid">{Object.keys(FEATURE_TIERS).map(key=><div className="admin-field" key={key}>
    <label htmlFor={`feature-${key}`}>{t(`featureAccess.labels.${key.replace('research.','')}`)}</label>
    <select id={`feature-${key}`} value={levels[key]} onChange={e=>{save.reset();setLevels(v=>({...v,[key]:e.target.value as AccessTier}));}}>
     {levels[key]==='NONE'&&<option value="NONE" disabled>{t('featureAccess.signedIn')}</option>}
     {RESEARCH_TIERS.map(tier=><option value={tier} key={tier}>{t(`featureAccess.tiers.${tier}`)}</option>)}
    </select>
    {!!parsed.data[key]?.min_entitlement_age_hours&&<small>{t('featureAccess.age',{hours:parsed.data[key]!.min_entitlement_age_hours!})}</small>}
   </div>)}</div>
   <div className="admin-field"><label htmlFor="feature-reason">{t('adminReason')}</label><input id="feature-reason" maxLength={300} value={reason} onChange={e=>{save.reset();setReason(e.target.value);}}/></div>
   <div className="admin-actions"><button className="research-control admin-primary" disabled={!reason.trim()||save.isPending}>{t('featureAccess.save')}</button></div>
   {save.isSuccess&&<p className="admin-ok" role="status">{t('adminSaved')}</p>}
   {save.isError&&<p className="admin-bad" role="alert">{t('adminErrUnknown')}</p>}
  </form>}
 </section>;
}
