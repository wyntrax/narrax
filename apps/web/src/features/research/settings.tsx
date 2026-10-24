'use client';
import {useState} from 'react';
import {useMutation,useQueryClient} from '@tanstack/react-query';
import {useTranslations} from 'next-intl';
import {z} from 'zod';
import {useResearch,useResearchQuery} from './session';
import {SettingsSchema,alertPriorities,themes,densities,type UserSettings} from './contracts';
import {PageHeading,Section,Loading,ResourceError} from './ui';

const text=z.string().max(20000);
const ProfileOut=z.object({displayName:text.nullable(),timezone:text.nullable()});
const AppearanceOut=z.object({theme:z.enum(themes),density:z.enum(densities),reducedMotion:z.boolean()});
const NotificationsOut=SettingsSchema.shape.notifications;
/** Display name, appearance and alert preferences. Nothing here can change what the agent is allowed to do. */
export function SettingsPage(){
  const t=useTranslations('workspace'),{access,refreshAccess}=useResearch(),query=useResearchQuery('settings',SettingsSchema);
  return <><PageHeading title={t('settings')} body={t('settingsBody')}/>
   <Section title={t('access')}><div className="settings-access">
    <div><span className="settings-access-label">{t('tier')}</span><strong>{access.admin?t('stAdminAccess'):access.effectiveTier.replaceAll('_',' ')}</strong><small>{t('stAccessHelp')}</small></div>
    <button className="research-control" onClick={refreshAccess}>{t('enhance.refreshAccess')}</button>
   </div></Section>
   {query.isError?<ResourceError error={query.error} retry={()=>void query.refetch()}/>:query.isPending?<Loading/>:<>
    <ProfileForm initial={query.data.profile}/><AppearanceForm initial={query.data.appearance}/><NotificationsForm initial={query.data.notifications}/></>}</>;
}
function useSave<T>(path:string,schema:z.ZodType<T>){
 const {send,userId}=useResearch(),client=useQueryClient();
 return useMutation({mutationFn:(body:unknown)=>send(path,schema,'PUT',body),onSuccess:()=>client.invalidateQueries({queryKey:['research',userId,'settings']})});
}
function Status({save}:{save:{isSuccess:boolean;isError:boolean}}){const t=useTranslations('workspace');return <>{save.isSuccess&&<p role="status" className="admin-ok settings-status">{t('stSaved')}</p>}{save.isError&&<p role="alert" className="admin-bad settings-status">{t('stFailed')}</p>}</>;}
function timeZones():string[]{try{return (Intl as unknown as {supportedValuesOf?:(k:string)=>string[]}).supportedValuesOf?.('timeZone')??[];}catch{return [];}}
function ProfileForm({initial}:{initial:UserSettings['profile']}){
 const t=useTranslations('workspace'),[name,setName]=useState(initial.displayName??''),[zone,setZone]=useState(initial.timezone??''),save=useSave('settings/profile',ProfileOut);
 return <Section title={t('stProfile')}><p className="research-note settings-intro">{t('stProfileHelp')}</p><form className="admin-form" onSubmit={e=>{e.preventDefault();save.mutate({displayName:name.trim()||null,timezone:zone.trim()||null});}}>
  <div className="settings-grid">
   <div className="admin-field"><label htmlFor="st-name">{t('stDisplayName')}</label><input id="st-name" maxLength={80} value={name} onChange={e=>{save.reset();setName(e.target.value);}}/></div>
   <div className="admin-field"><label htmlFor="st-zone">{t('stTimezone')}</label><input id="st-zone" list="st-zones" maxLength={64} value={zone} onChange={e=>{save.reset();setZone(e.target.value);}}/><datalist id="st-zones">{timeZones().map(z=><option key={z} value={z}/>)}</datalist></div>
  </div>
  <div className="settings-actions"><button type="submit" className="research-control admin-primary" disabled={save.isPending}>{t('stSave')}</button><Status save={save}/></div></form></Section>;
}
function AppearanceForm({initial}:{initial:UserSettings['appearance']}){
 const t=useTranslations('workspace'),[value,setValue]=useState(initial),save=useSave('settings/appearance',AppearanceOut);
 return <Section title={t('stAppearance')}><p className="research-note settings-intro">{t('stAppearanceHelp')}</p><form className="admin-form" onSubmit={e=>{e.preventDefault();save.mutate(value);}}>
  <div className="settings-grid">
   <div className="admin-field"><label htmlFor="st-theme">{t('stTheme')}</label><select id="st-theme" value={value.theme} onChange={e=>{save.reset();setValue({...value,theme:e.target.value as typeof value.theme});}}>{themes.map(x=><option key={x} value={x}>{t(`stThemes.${x}`)}</option>)}</select></div>
   <div className="admin-field"><label htmlFor="st-density">{t('stDensity')}</label><select id="st-density" value={value.density} onChange={e=>{save.reset();setValue({...value,density:e.target.value as typeof value.density});}}>{densities.map(x=><option key={x} value={x}>{t(`stDensities.${x}`)}</option>)}</select></div>
  </div>
  <label className="settings-check"><input type="checkbox" checked={value.reducedMotion} onChange={e=>{save.reset();setValue({...value,reducedMotion:e.target.checked});}}/><span>{t('stReducedMotion')}</span></label>
  <div className="settings-actions"><button type="submit" className="research-control admin-primary" disabled={save.isPending}>{t('stSave')}</button><Status save={save}/></div></form></Section>;
}
function NotificationsForm({initial}:{initial:UserSettings['notifications']}){
 const t=useTranslations('workspace'),[min,setMin]=useState(initial.minPriority),[muted,setMuted]=useState(initial.mutedKinds),save=useSave('settings/notifications',NotificationsOut);
 // A kind that is muted but no longer listed stays visible so it can be un-muted.
 const kinds=[...new Set([...initial.mutableKinds,...initial.mutedKinds])].sort();
 const toggle=(kind:string,on:boolean)=>{save.reset();setMuted(current=>on?[...new Set([...current,kind])]:current.filter(k=>k!==kind));};
 return <Section title={t('stNotifications')}><p className="research-note settings-intro">{t('stNotificationsHelp')}</p><form className="admin-form" onSubmit={e=>{e.preventDefault();save.mutate({minPriority:min,mutedKinds:muted});}}>
  <div className="admin-field settings-min"><label htmlFor="st-min">{t('stMinPriority')}</label><select id="st-min" value={min} onChange={e=>{save.reset();setMin(e.target.value as typeof min);}}>{alertPriorities.map(p=><option key={p} value={p}>{t(`alPriority.${p}`)}</option>)}</select></div>
  <fieldset className="settings-fieldset"><legend>{t('stMutedKinds')}</legend>{kinds.length?<div className="settings-kinds">{kinds.map(k=><label key={k} className="settings-check"><input type="checkbox" checked={muted.includes(k)} onChange={e=>toggle(k,e.target.checked)}/><span>{k}</span></label>)}</div>:<p className="research-note">{t('stNoKinds')}</p>}</fieldset>
  <p className="research-note">{t('stAlways',{kinds:initial.alwaysDelivered.join(', ')})}</p>
  <div className="settings-actions"><button type="submit" className="research-control admin-primary" disabled={save.isPending}>{t('stSave')}</button><Status save={save}/></div></form></Section>;
}
