'use client';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {useLocale,useTranslations} from 'next-intl';
import {AlertCircle,ArrowUpRight,LockKeyhole,SearchX} from 'lucide-react';
import {ApiError} from '@/lib/api';
import {Link,useRouter} from '@/i18n/navigation';
import {useAuth} from '@/components/auth/context';

export function useFormat(){const locale=useLocale(),t=useTranslations('workspace');return {
 number:(value:number|null|undefined,digits=1)=>value==null||!Number.isFinite(value)?t('unknown'):new Intl.NumberFormat(locale,{maximumFractionDigits:digits}).format(value),
 usd:(value:number|null|undefined)=>value==null||!Number.isFinite(value)?t('unknown'):new Intl.NumberFormat(locale,{style:'currency',currency:'USD',maximumSignificantDigits:6}).format(value),
 percent:(value:number|null|undefined)=>value==null?t('unknown'):new Intl.NumberFormat(locale,{style:'percent',maximumFractionDigits:1}).format(value),
 date:(value:string|null|undefined)=>!value||!Number.isFinite(Date.parse(value))?t('unknown'):new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value))
 };}
export function Loading(){const t=useTranslations('workspace');return <div className="research-loading" role="status"><span>{t('loading')}</span><div className="skeleton"/><div className="skeleton short"/></div>;}
export function Empty({body}:{body?:string}){const t=useTranslations('workspace');return <div className="research-state" role="status"><SearchX aria-hidden="true" size={24}/><h2>{t('empty')}</h2><p>{body??t('emptyBody')}</p></div>;}
export function Locked({tier}:{tier?:string}){
 const t=useTranslations('workspace');
 const label=tier&&(['EARLY_ACCESS','MEMBER','PRO'].includes(tier)?t(`featureAccess.tiers.${tier}`):tier.replaceAll('_',' '));
 return <section className="research-access-card" role="status">
  <div className="access-card-top"><div className="access-card-icon"><LockKeyhole aria-hidden="true" size={24}/></div><span className="access-card-eyebrow">{t('accessCard.eyebrow')}</span></div>
  <h2>{t('locked')}</h2><p className="access-card-description">{t('accessCard.description')}</p>
  {label&&<div className="access-card-tier"><span>{t('accessCard.minimum')}</span><strong>{label}</strong></div>}
  <div className="access-card-actions"><Link href="/early-access" className="button button-primary">{t('access')}<ArrowUpRight size={16} aria-hidden="true"/></Link><Link href="/app/portfolio" className="access-card-secondary">{t('accessCard.portfolio')}</Link></div>
  <p className="access-card-footnote">{t('accessCard.preview')}</p>
 </section>;
}
export function researchErrorKey(error:unknown){const code=error instanceof ApiError?error.code:'';
 return code==='NOT_FOUND'?'notFoundBody':code==='UNAUTHORIZED'?'sessionExpired':code==='NETWORK'?'requestErrors.network':code==='TIMEOUT'?'requestErrors.timeout':code==='INVALID_RESPONSE'?'requestErrors.invalidResponse':code==='CONFIGURATION'?'requestErrors.configuration':code==='RATE_LIMITED'?'requestErrors.rateLimited':'requestErrors.server';
}
export function ResourceError({error,retry}:{error:unknown;retry:()=>void}){const t=useTranslations('workspace'),auth=useAuth();const code=error instanceof ApiError?error.code:'';
 if(code==='FEATURE_LOCKED')return <Locked tier={(error as ApiError).requiredTier}/>;
 return <section className="research-state research-error-card" role="alert">
  <div className="access-card-top"><div className="error-card-icon"><AlertCircle aria-hidden="true" size={24}/></div><span className="access-card-eyebrow">{t('requestCard.eyebrow')}</span></div>
  <h2>{t(code==='NOT_FOUND'?'notFound':'error')}</h2>
  <p className="access-card-description">{t(researchErrorKey(error))}</p>
  {code&&<p className="error-card-code"><span>{t('requestCard.code')}</span><code>{code}</code></p>}
  <div className="access-card-actions"><button type="button" className="button button-primary" onClick={retry}>{t('retry')}</button>{code==='UNAUTHORIZED'&&<button type="button" className="access-card-secondary" onClick={()=>{void auth.logout().catch(()=>undefined);}}>{t('signOut')}</button>}<Link href="/early-access" className="access-card-secondary">{t('access')}</Link></div>
 </section>;
}
export function PageHeading({title,body,actions}:{title:string;body?:string;actions?:ReactNode}){return <header className="research-heading"><div><h1>{title}</h1>{body&&<p>{body}</p>}</div>{actions}</header>;}
export function Section({title,children,action}:{title:ReactNode;children:ReactNode;action?:ReactNode}){return <section className="research-section"><div className="section-title"><h2>{title}</h2>{action}</div>{children}</section>;}
export function Metrics({items}:{items:{label:string;value:ReactNode}[]}){return <dl className="research-metrics">{items.map(item=><div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>;}
export function Facts({items}:{items:{label:string;value:ReactNode}[]}){return <dl className="research-facts">{items.map(item=><div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>;}
function DataRow({cells,headers,href:explicitHref}:{cells:ReactNode[];headers:string[];href?:string}){
 const router=useRouter(),locale=useLocale(),ref=useRef<HTMLTableRowElement>(null),[inferredHref,setInferredHref]=useState<string>();
 // Inspect rendered links so wrapper components (e.g. WalletName) work too. Rows
 // without an internal detail link stay non-interactive; external evidence is never hijacked.
 useEffect(()=>{const links=ref.current?.querySelectorAll<HTMLAnchorElement>('a[href]');const link=Array.from(links??[]).find(a=>{const h=a.getAttribute('href');return h?.startsWith('/')&&!h.startsWith('//')&&!a.hasAttribute('download')&&(!a.target||a.target==='_self');});const h=link?.getAttribute('href')??undefined;setInferredHref(h?.startsWith(`/${locale}/`)?h.slice(locale.length+1):h);},[cells,locale]);
 const href=explicitHref??inferredHref;
 return <tr ref={ref} className={href?'research-clickable-row':undefined} tabIndex={href?0:undefined} onClick={href?e=>{if((e.target as HTMLElement).closest('a,button,input,select,textarea,summary,[role="button"],[contenteditable="true"]')||window.getSelection()?.toString()||e.button!==0)return;if(e.metaKey||e.ctrlKey||e.shiftKey){window.open(href.startsWith('/app')?`/${locale}${href}`:href,'_blank','noopener,noreferrer');return;}router.push(href);}:undefined} onKeyDown={href?e=>{if(e.target===e.currentTarget&&e.key==='Enter'){e.preventDefault();router.push(href);}}:undefined}>{cells.map((cell,index)=><td key={index} data-label={headers[index]}>{cell}</td>)}</tr>;
}
export function DataTable({caption,headers,rows,rowHref}:{caption:string;headers:string[];rows:{key:string;cells:ReactNode[]}[];rowHref?:(key:string)=>string}){return <div className="research-table"><table><caption className="sr-only">{caption}</caption><thead><tr>{headers.map(header=><th scope="col" key={header}>{header}</th>)}</tr></thead><tbody>{rows.map(row=><DataRow key={row.key} cells={row.cells} headers={headers} href={rowHref?.(row.key)}/>)}</tbody></table></div>;}
export function Pager({page,next,previous,canNext}:{page:number;next:()=>void;previous:()=>void;canNext:boolean}){const t=useTranslations('workspace');return <nav className="research-pager" aria-label={t('page',{page})}><button onClick={previous} disabled={page===1}>{t('previous')}</button><span aria-live="polite">{t('page',{page})}</span><button onClick={next} disabled={!canNext}>{t('next')}</button></nav>;}
export function Stamp({at}:{at:string|null|undefined}){const t=useTranslations('workspace'),f=useFormat();return <p className="research-note">{t('updated',{at:f.date(at)})}</p>;}
