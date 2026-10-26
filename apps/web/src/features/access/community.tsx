'use client';
import {useTranslations} from 'next-intl';
import {ArrowUpRight,Check,Heart,Send} from 'lucide-react';

/** Fixed public destinations. The pinned post is the top post on the profile, so the profile link stays current. */
export const COMMUNITY_LINKS={telegram:'https://t.me/wyntraxyz',x:'https://x.com/Wyntrax'} as const;

function XMark({size=15}:{size?:number}){
 return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>;
}

const STEPS=[
 {key:'telegram',href:COMMUNITY_LINKS.telegram,icon:<Send size={15} aria-hidden="true"/>},
 {key:'follow',href:COMMUNITY_LINKS.x,icon:<XMark/>},
 {key:'pinned',href:COMMUNITY_LINKS.x,icon:<Heart size={15} aria-hidden="true"/>},
] as const;

export type CommunityStepKey=(typeof STEPS)[number]['key'];
export const COMMUNITY_STEP_COUNT=STEPS.length;

/**
 * Community checklist shown in the verified-wallet/join state. Each action is a direct link only: Narrax does not
 * connect to Telegram or X, request account access, or verify these actions. A click marks that step locally so the
 * join button unlocks without any server-side membership check.
 */
export function CommunitySteps({compact=false,completed=[],onStep}:{compact?:boolean;completed?:readonly CommunityStepKey[];onStep?:(key:CommunityStepKey)=>void}){
 const t=useTranslations('access.community');
 const done=new Set(completed),count=STEPS.filter(step=>done.has(step.key)).length,isComplete=count===COMMUNITY_STEP_COUNT;
 return <section className={`access-community${compact?' access-community--compact':''}`} aria-labelledby="access-community-title">
  <div className="access-community-label">
   <span className="tiny-dot" aria-hidden="true"/>
   <span>{t('eyebrow')}</span>
   <span className={`community-progress${isComplete?' is-complete':''}`} role="status" aria-live="polite" aria-atomic="true">{t('progress',{done:count,total:COMMUNITY_STEP_COUNT})}</span>
  </div>
  <h3 id="access-community-title">{t('title')}</h3>
  {!compact&&<p className="access-community-body">{t('body')}</p>}
  <div className="community-progress-track" aria-hidden="true">{STEPS.map(step=><span key={step.key} data-complete={done.has(step.key)}/>)}</div>
  <ol className="access-community-list">{STEPS.map(step=>{
   const isDone=done.has(step.key);
   return <li key={step.key}>
    <a className="access-community-step" data-complete={isDone} href={step.href} target="_blank" rel="noopener noreferrer" onClick={()=>onStep?.(step.key)}>
     <span className="community-icon" aria-hidden="true">{step.icon}</span>
     <span className="community-copy"><strong>{t(`${step.key}.title`)}</strong>{!compact&&<span>{t(`${step.key}.body`)}</span>}</span>
     <span className={`community-action${isDone?' is-complete':''}`}>
      {isDone?<Check size={13} aria-hidden="true"/>:<span className="community-action-label">{t(`${step.key}.action`)}</span>}
      {isDone?<span className="community-action-label">{t('completed')}</span>:<ArrowUpRight size={13} aria-hidden="true"/>}
     </span>
    </a>
   </li>;
  })}</ol>
  {onStep&&<p id="access-community-status" className={`community-status${isComplete?' is-complete':''}`}>
   {isComplete&&<Check size={14} aria-hidden="true"/>}
   <span>{isComplete?t('ready'):t('hint')}</span>
  </p>}
 </section>;
}
