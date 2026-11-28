'use client';
import {useState} from 'react';
import {useLocale,useTranslations} from 'next-intl';
import {ShieldCheck,Wallet,Check,Clock,Lock,AlertTriangle,Info,RefreshCw,LogOut} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Badge,Card,ConfirmDialog,Stepper} from '@/components/ui/primitives';
import {BrandLogo} from '@/components/brand-logo';
import {Link} from '@/i18n/navigation';
import {errorKey,ApiError} from '@/lib/api';
import {busyStates,stepFor,type AccessState} from './machine';
import {CommunitySteps,COMMUNITY_STEP_COUNT,type CommunityStepKey} from './community';
import {WyntraxLink} from './wyntrax-link';
export interface AccessActions {login:()=>void;retry:()=>void;connect:()=>void;select:(address:string)=>void;sign:()=>void;join:()=>void;unlink:(id:string)=>void;leave:()=>void;logout:()=>void;createWallet:()=>void}
export function AccessView({state,actions,wallets=[],mode='standalone'}: {state:AccessState;actions:AccessActions;wallets?:{address:string;name:string}[];mode?:'standalone'|'workspace'}) {
 const t=useTranslations('flow'),c=useTranslations('common'),d=useTranslations('design'),errors=useTranslations('errors'),locale=useLocale();
 const [communityDone,setCommunityDone]=useState<CommunityStepKey[]>([]);
 const communityComplete=communityDone.length===COMMUNITY_STEP_COUNT;
 const completeCommunityStep=(key:CommunityStepKey)=>setCommunityDone(done=>done.includes(key)?done:[...done,key]);
 const busy=busyStates.includes(state.name),disabled=busy||!!state.retryAt&&Date.now()<state.retryAt;
 const name=state.name==='signedOut'&&state.status?(!state.status.enabled?'disabled':state.status.inviteRequired?'inviteOnly':state.status.seatsLeft===0?'full':state.name):state.name;
 const canManage=!busy && !['challenge','signedOut'].includes(state.name);
 return <>{mode==='standalone'&&<Stepper step={stepFor(state)}/>}<Card className="access-card" data-access-state={name}><div className="status-icon" aria-hidden>{busy?<span className="spinner"/>:name==='active'?<Check size={22}/>:name==='error'?<AlertTriangle size={22}/>:name==='noWallet'||name==='connecting'?<Wallet size={22}/>:name==='disabled'||name==='full'?<Clock size={22}/>:name==='inviteOnly'?<Lock size={22}/>:<ShieldCheck size={22}/>}</div>
  <div className="access-copy" aria-live="polite" aria-atomic="true"><h2>{name==='checking'?c('checking'):t(`states.${name}.title`)}</h2><p className="status-description">{t(`states.${name}.body`)}</p></div>
  {state.error&&<div role="alert" className="error-note">{errors(errorKey(new ApiError(state.error)))}{state.requiredTier&&<Badge>{state.requiredTier.replace('_',' ')}</Badge>}{state.retryAt&&<p>{t('rateWait')}</p>}</div>}
  {state.name==='signedOut'&&<Button onClick={actions.login}>{d('continue')}<span aria-hidden>↗</span></Button>}
  {state.name==='signedOut'&&name!=='signedOut'&&<p className="small-note">{t('existingMember')}</p>}
  {['noWallet','disabled','full','inviteOnly'].includes(state.name)&&<><div className="wallet-explanation"><Info size={16} aria-hidden="true" className="wallet-explanation-icon"/><span>{t('sameWallet')}</span></div><div className="actions centered access-wallet-actions"><Button onClick={actions.connect} variant={state.data?.links.length?'ghost':'primary'}><BrandLogo brand="solana" size={16} inverted={!state.data?.links.length}/>{t('connect')}</Button><Button variant="ghost" onClick={actions.createWallet}><BrandLogo brand="privy" size={16}/>{t('embedded')}</Button></div></>}
  {state.name==='connecting'&&<><div className="wallet-explanation"><Info size={16} aria-hidden="true" className="wallet-explanation-icon"/><span>{t('sameWallet')}</span></div><div className="wallet-options">{wallets.map(w=><Button variant="ghost" key={w.address} onClick={()=>actions.select(w.address)}><Wallet size={16}/><span>{w.name}<small>{w.address.slice(0,6)}…{w.address.slice(-6)}</small></span></Button>)}</div><Button variant="ghost" onClick={actions.retry}>{c('cancel')}</Button></>}
  {state.name==='challenge'&&state.challenge&&<><p className="small-note">{t('reviewMessage')}</p><pre className="challenge-message" tabIndex={0}>{state.challenge.message}</pre><div className="actions centered access-wallet-actions"><Button onClick={actions.sign}>{t('signMessage')}</Button><Button variant="ghost" onClick={actions.retry}>{c('cancel')}</Button></div></>}
  {state.name==='linked'&&<>
   {mode==='standalone'&&<><CommunitySteps compact completed={communityDone} onStep={completeCommunityStep}/><div className="actions centered community-join"><Button disabled={!communityComplete||disabled} aria-describedby="access-community-status" onClick={actions.join}>{t('join')}</Button></div></>}
   <div className="actions centered linked-more access-wallet-actions"><Button variant="ghost" onClick={actions.connect}><BrandLogo brand="solana" size={16}/>{t('connect')}</Button><Button variant="ghost" onClick={actions.createWallet}><BrandLogo brand="privy" size={16}/>{t('embedded')}</Button></div>
  </>}
  {state.name==='active'&&state.data&&<><div className="tier-result"><Badge>{state.data.effectiveTier.replace('_',' ')}</Badge><p>{state.data.nextExpiry?t('nextExpiry',{date:new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short'}).format(new Date(state.data.nextExpiry))}):t('noExpiry')}</p></div>{mode==='standalone'&&<Link className="button button-primary" href="/app">{t('openNarra')} ↗</Link>}</>}
  {!busy&&mode==='standalone'&&<WyntraxLink/>}
  {state.name==='error'&&<Button disabled={disabled} onClick={actions.retry}>{c('retry')}</Button>}
  {canManage&&!!state.data?.links.length&&<div className="linked-wallets"><h3>{t('verifiedWallets')}</h3>{state.data.links.map(w=><div key={w.id}><span title={w.address}>{w.address.slice(0,7)}…{w.address.slice(-7)}</span><ConfirmDialog trigger={t('unlink')} title={t('unlinkTitle')} description={t('unlinkBody')} disabled={disabled} onConfirm={()=>actions.unlink(w.id)}/></div>)}</div>}
  {mode==='standalone'&&canManage&&state.data?.grants.some(g=>g.source==='EARLY_ACCESS'&&g.status==='ACTIVE')&&<ConfirmDialog trigger={t('leave')} title={t('leaveTitle')} description={t('leaveBody')} disabled={disabled} onConfirm={actions.leave}/>}
  {!busy&&state.name!=='signedOut'&&<div className="session-actions"><button type="button" onClick={actions.retry}><RefreshCw size={14} aria-hidden="true"/>{t('refresh')}</button><button type="button" onClick={actions.logout}><LogOut size={14} aria-hidden="true"/>{t('signOut')}</button></div>}
 </Card></>;
}
