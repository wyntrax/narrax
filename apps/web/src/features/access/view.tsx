'use client';
import {useState} from 'react';
import {useLocale,useTranslations} from 'next-intl';
import {ShieldCheck,Wallet,Check} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Badge,Card,ConfirmDialog,Stepper} from '@/components/ui/primitives';
import {Link} from '@/i18n/navigation';
import {errorKey,ApiError} from '@/lib/api';
import {busyStates,stepFor,type AccessState} from './machine';
import {CommunitySteps,COMMUNITY_STEP_COUNT,type CommunityStepKey} from './community';
import {WyntraxLink} from './wyntrax-link';
export interface AccessActions {login:()=>void;retry:()=>void;connect:()=>void;select:(address:string)=>void;sign:()=>void;join:()=>void;unlink:(id:string)=>void;leave:()=>void;logout:()=>void;createWallet:()=>void}
export function AccessView({state,actions,wallets=[]}: {state:AccessState;actions:AccessActions;wallets?:{address:string;name:string}[]}) {
 const t=useTranslations('flow'),c=useTranslations('common'),d=useTranslations('design'),errors=useTranslations('errors'),locale=useLocale();
 const [communityDone,setCommunityDone]=useState<CommunityStepKey[]>([]);
 const communityComplete=communityDone.length===COMMUNITY_STEP_COUNT;
 const completeCommunityStep=(key:CommunityStepKey)=>setCommunityDone(done=>done.includes(key)?done:[...done,key]);
 const busy=busyStates.includes(state.name),disabled=busy||!!state.retryAt&&Date.now()<state.retryAt;
 const name=state.name==='signedOut'&&state.status?(!state.status.enabled?'disabled':state.status.inviteRequired?'inviteOnly':state.status.seatsLeft===0?'full':state.name):state.name;
 const canManage=!busy && !['challenge','signedOut'].includes(state.name);
 return <><Stepper step={stepFor(state)}/><Card className="access-card" data-access-state={name}><div className="status-icon" aria-hidden>{busy?<span className="spinner"/>:name==='active'?<Check/>:name==='error'?<svg viewBox="0 0 40 40"><path d="M7 29 20 6l13 23ZM20 15v6m0 3v2" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>:name==='noWallet'?<svg viewBox="0 0 40 40"><rect x="5" y="11" width="30" height="22" rx="4" fill="none" stroke="currentColor"/><path d="m8 11 20-5v5m7 7H25v8h10" fill="none" stroke="currentColor"/><circle cx="29" cy="22" r="1.5" fill="currentColor"/></svg>:<ShieldCheck/>}</div>
  <div aria-live="polite" aria-atomic="true"><h2>{name==='checking'?c('checking'):t(`states.${name}.title`)}</h2><p className="status-description">{t(`states.${name}.body`)}</p></div>
  {state.error&&<div role="alert" className="error-note">{errors(errorKey(new ApiError(state.error)))}{state.requiredTier&&<Badge>{state.requiredTier.replace('_',' ')}</Badge>}{state.retryAt&&<p>{t('rateWait')}</p>}</div>}
  {state.name==='signedOut'&&<Button onClick={actions.login}>{d('continue')}<span aria-hidden>↗</span></Button>}
  {state.name==='signedOut'&&name!=='signedOut'&&<p className="small-note">{t('existingMember')}</p>}
  {['noWallet','disabled','full','inviteOnly'].includes(state.name)&&<><p className="wallet-explanation">{t('sameWallet')}</p><div className="actions centered"><Button onClick={actions.connect} variant={state.data?.links.length?'ghost':'primary'}>{t('connect')}</Button><Button variant="ghost" onClick={actions.createWallet}>{t('embedded')}</Button></div></>}
  {state.name==='connecting'&&<><p className="wallet-explanation">{t('sameWallet')}</p><div className="wallet-options">{wallets.map(w=><Button variant="ghost" key={w.address} onClick={()=>actions.select(w.address)}><Wallet size={16}/><span>{w.name}<small>{w.address.slice(0,6)}…{w.address.slice(-6)}</small></span></Button>)}</div><Button variant="ghost" onClick={actions.retry}>{c('cancel')}</Button></>}
  {state.name==='challenge'&&state.challenge&&<><p className="small-note">{t('reviewMessage')}</p><pre className="challenge-message" tabIndex={0}>{state.challenge.message}</pre><div className="actions centered"><Button onClick={actions.sign}>{t('signMessage')}</Button><Button variant="ghost" onClick={actions.retry}>{c('cancel')}</Button></div></>}
  {state.name==='linked'&&<>
   <CommunitySteps compact completed={communityDone} onStep={completeCommunityStep}/>
   <div className="actions centered community-join"><Button disabled={!communityComplete||disabled} aria-describedby="access-community-status" onClick={actions.join}>{t('join')}</Button></div>
   <div className="actions centered linked-more"><Button variant="ghost" onClick={actions.connect}>{t('connect')}</Button><Button variant="ghost" onClick={actions.createWallet}>{t('embedded')}</Button></div>
  </>}
  {state.name==='active'&&state.data&&<><div className="tier-result"><Badge>{state.data.effectiveTier.replace('_',' ')}</Badge><p>{state.data.nextExpiry?t('nextExpiry',{date:new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short'}).format(new Date(state.data.nextExpiry))}):t('noExpiry')}</p></div><Link className="button button-primary" href="/app">{t('openNarra')} ↗</Link></>}
  {!busy&&<WyntraxLink/>}
  {state.name==='error'&&<Button disabled={disabled} onClick={actions.retry}>{c('retry')}</Button>}
  {canManage&&!!state.data?.links.length&&<div className="linked-wallets"><h3>{t('verifiedWallets')}</h3>{state.data.links.map(w=><div key={w.id}><span title={w.address}>{w.address.slice(0,7)}…{w.address.slice(-7)}</span><ConfirmDialog trigger={t('unlink')} title={t('unlinkTitle')} description={t('unlinkBody')} disabled={disabled} onConfirm={()=>actions.unlink(w.id)}/></div>)}</div>}
  {canManage&&state.data?.grants.some(g=>g.source==='EARLY_ACCESS'&&g.status==='ACTIVE')&&<ConfirmDialog trigger={t('leave')} title={t('leaveTitle')} description={t('leaveBody')} disabled={disabled} onConfirm={actions.leave}/>}
  {!busy&&state.name!=='signedOut'&&<div className="session-actions"><button onClick={actions.retry}>{t('refresh')}</button><button onClick={actions.logout}>{t('signOut')}</button></div>}
 </Card></>;
}
