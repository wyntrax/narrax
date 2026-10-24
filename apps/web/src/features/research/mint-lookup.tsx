'use client';
import {useId,useState} from 'react';
import {useTranslations} from 'next-intl';
import {isSolanaAddress} from '@narra/shared';
import {useRouter} from '@/i18n/navigation';

export function MintLookup(){
 const t=useTranslations('workspace.brief'),router=useRouter(),id=useId(),[mint,setMint]=useState(''),[invalid,setInvalid]=useState(false);
 return <form className="research-search mint-lookup" onSubmit={event=>{
  event.preventDefault();const value=mint.trim();
  if(!isSolanaAddress(value)){setInvalid(true);return;}
  setInvalid(false);router.push(`/app/tokens/${encodeURIComponent(value)}`);
 }}>
  <label htmlFor={id}>{t('lookup')}</label>
  <p id={`${id}-help`} className="research-note">{t('lookupHelp')}</p>
  <div><input id={id} value={mint} onChange={event=>{setMint(event.target.value);setInvalid(false);}} autoComplete="off" autoCapitalize="none" spellCheck={false} aria-invalid={invalid} aria-describedby={`${id}-help${invalid?` ${id}-error`:''}`} placeholder={t('placeholder')}/><button type="submit" className="research-control">{t('open')}</button></div>
  {invalid&&<p id={`${id}-error`} role="alert">{t('invalid')}</p>}
 </form>;
}

export function CopyMint({mint}:{mint:string}){
 const t=useTranslations('workspace.brief'),[status,setStatus]=useState<'idle'|'copied'|'failed'>('idle');
 return <div className="token-copy"><button className="research-control" type="button" onClick={async()=>{try{await navigator.clipboard.writeText(mint);setStatus('copied');}catch{setStatus('failed');}}}>{t('copy')}</button><span role="status">{status==='idle'?'':t(status)}</span></div>;
}
