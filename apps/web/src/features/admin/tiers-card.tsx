'use client';
import {useState} from 'react';
import {useMutation} from '@tanstack/react-query';
import {useLocale,useTranslations} from 'next-intl';
import {HOLDING_TIERS} from '@narra/shared';
import {ApiError} from '@/lib/api';
import type {AdminApi} from './api';
import {parseTierForm,type TierForm} from './contracts';
import {TokenAvatar} from '@/features/research/token-identity';

const PROBLEMS={amount:'adminErrInvalid',order:'adminTiersOrder',symbol:'adminErrInvalid',mint:'adminErrMint',time:'adminErrInvalid',days:'adminErrInvalid'} as const;
/** Admin controls for the $Wyntrax holding each level asks for and for the early-access time window. */
export function TiersCard({api,initial}:{api:AdminApi;initial:TierForm}){
 const t=useTranslations('workspace'),locale=useLocale();
 const [form,setForm]=useState(initial),[reason,setReason]=useState('');
 const parsed=parseTierForm(form);
 const save=useMutation({mutationFn:()=>{if(!parsed.ok)throw new ApiError('INVALID_INPUT',400);return api.save(parsed.payload,reason.trim());}});
 const set=<K extends keyof TierForm>(name:K,value:TierForm[K])=>{save.reset();setForm(current=>({...current,[name]:value}));};
 const valid=parsed.ok&&reason.trim().length>0;
 const number=new Intl.NumberFormat(locale);
 const problem=!parsed.ok?t(PROBLEMS[parsed.error]):null;
 const failure=save.error instanceof ApiError?(save.error.status===403?t('adminErrForbidden'):save.error.code==='RATE_LIMITED'?t('adminErrRate'):save.error.code==='UNAUTHORIZED'?t('adminErrSession'):t('adminErrInvalid')):null;
 return <section className="admin-card admin-wide" aria-labelledby="admin-tiers">
  <h2 id="admin-tiers">{t('adminTiersTitle')}</h2>
  <p>{t('adminTiersHelp')}</p>
  <form className="admin-form" onSubmit={event=>{event.preventDefault();if(valid)save.mutate();}}>
   {HOLDING_TIERS.map(tier=><div className="admin-field" key={tier}><label htmlFor={`tier-${tier}`}>{t(`adminTier${tier}`)}</label><input id={`tier-${tier}`} inputMode="decimal" value={form[tier]} onChange={event=>set(tier,event.target.value.trim())}/></div>)}
   <div className="admin-field"><label htmlFor="tier-symbol">{t('adminTokenSymbol')}</label><input id="tier-symbol" maxLength={16} value={form.symbol} onChange={event=>set('symbol',event.target.value.trim())}/></div>
   <div className="admin-field"><label htmlFor="tier-mint">{t('adminTokenMint')}</label><input id="tier-mint" spellCheck={false} autoComplete="off" maxLength={44} value={form.mint} onChange={event=>set('mint',event.target.value.trim())}/><small>{t('adminTokenMintHelp')}</small></div>
    {parsed.ok&&<p className="admin-stat token-artwork-label" role="status"><TokenAvatar symbol={form.symbol}/><span>{t('adminTiersPreview',{member:number.format(parsed.tiers.MEMBER),pro:number.format(parsed.tiers.PRO),symbol:form.symbol})}</span></p>}
   <div className="admin-field"><label htmlFor="tier-closes">{t('adminClosesAt')}</label><div className="admin-inline"><input id="tier-closes" type="datetime-local" value={form.closesAt} onChange={event=>set('closesAt',event.target.value)}/><button type="button" className="research-control" onClick={()=>set('closesAt','')}>{t('adminNever')}</button></div><small>{t('adminClosesHelp')}</small></div>
   <div className="admin-field"><label htmlFor="tier-days">{t('adminAccessDays')}</label><input id="tier-days" inputMode="numeric" value={form.accessDays} onChange={event=>set('accessDays',event.target.value.trim())}/><small>{t('adminAccessDaysHelp')}</small></div>
   <div className="admin-field"><label htmlFor="tier-reason">{t('adminReason')}</label><input id="tier-reason" maxLength={300} value={reason} onChange={event=>{save.reset();setReason(event.target.value);}}/></div>
   {problem&&<p role="alert" className="admin-bad">{problem}</p>}
   <div className="admin-actions"><button type="submit" className="research-control admin-primary" disabled={!valid||save.isPending}>{t('adminTiersSave')}</button></div>
   {parsed.ok&&!reason.trim()&&<p className="admin-hint" role="status">{t('adminHintReason')}</p>}
   {save.isSuccess&&<p role="status" className="admin-ok">{t('adminSaved')}</p>}
   {save.isError&&<p role="alert" className="admin-bad">{failure}</p>}
  </form>
 </section>;
}
