'use client';
import {useState,type ReactNode} from 'react';
import {useTranslations,useLocale} from 'next-intl';
import {tradeCopy} from '@/features/trade/copy';
import {proCopy} from '@/features/pro-research/copy';
import {ArrowDownUp} from 'lucide-react';
import {LayoutDashboard,Radar,Orbit,Coins,Wallet,Briefcase,Bell,ChartColumn,FlaskConical,Bot,Settings,ShieldCheck,PanelLeftClose,PanelLeftOpen,Menu,LogOut,ArrowUpRight,LockKeyhole} from 'lucide-react';
import {Link,usePathname} from '@/i18n/navigation';
import {BrandMark} from '@/components/brand-mark';
import {PoweredBy} from '@/components/powered-by';
import {ThemeToggle,LocaleToggle} from '@/components/toggles';
import {Dialog} from '@/components/ui/primitives';
import {useAuth} from '@/components/auth/context';
import {hasFeature,useResearch,useResearchQuery} from './session';
import {MarketPreviewSchema,UnreadAlertsSchema} from './contracts';
import {Locked,useFormat,researchErrorKey} from './ui';
import {routeFeature} from './route-access';
import {MeSchema} from '@/features/admin/contracts';
const navigation=[{href:'/app',key:'overview',icon:LayoutDashboard},{href:'/app/radar',key:'radar',icon:Radar},{href:'/app/opportunities',key:'opportunities',icon:Orbit},{href:'/app/tokens',key:'tokens',icon:Coins},{href:'/app/trade',key:'trade',icon:ArrowDownUp},{href:'/app/smart-money',key:'smartMoney',icon:Wallet},{href:'/app/portfolio',key:'portfolio',icon:Briefcase},{href:'/app/alerts',key:'alerts',icon:Bell},{href:'/app/analytics',key:'analytics',icon:ChartColumn},{href:'/app/backtests',key:'backtest',icon:FlaskConical},{href:'/app/agent',key:'agent',icon:Bot},{href:'/app/settings',key:'settings',icon:Settings}];
export function ResearchShell({children,theme}:{children:ReactNode;theme:string}){
  const t=useTranslations('workspace'),pathname=usePathname(),auth=useAuth();
  const locale=useLocale()==='id'?'id':'en',trade=tradeCopy[locale],pro=proCopy[locale],navLabel=(key:string)=>key==='trade'?trade.title:key==='personalRadar'?pro.radar:key==='theses'?pro.thesis:key==='briefing'?pro.briefing:t(key);
 const {access}=useResearch();
 const feature=routeFeature(pathname),locked=!!feature&&!hasFeature(access,feature);
 const isAdmin=useResearchQuery('me',MeSchema).data?.isAdmin===true;
 const unread=useResearchQuery('alerts/unread-count',UnreadAlertsSchema,true,30000);
 const count=unread.isError?null:unread.data?.unread;
 const badge=count?`${count>99?'99':count}${count>99||unread.data?.capped?'+':''}`:null;
  const personal=[{href:'/app/personal-radar',key:'personalRadar',icon:Radar},{href:'/app/theses',key:'theses',icon:FlaskConical},{href:'/app/briefing',key:'briefing',icon:Bell}];
  const items=[...navigation,...personal,...(isAdmin?[{href:'/app/admin',key:'admin',icon:ShieldCheck}]:[])];
 const [collapsed,setCollapsed]=useState(false),[mobile,setMobile]=useState(false),[signingOut,setSigningOut]=useState(false),[logoutError,setLogoutError]=useState(false);
 const signOut=()=>{setSigningOut(true);setLogoutError(false);void auth.logout().catch(()=>setLogoutError(true)).finally(()=>setSigningOut(false));};
  const links=(close=false)=>items.map(({href,key,icon:Icon})=>{
   const required=routeFeature(href),denied=!!required&&!hasFeature(access,required);
    const label=key==='alerts'&&count?`${t(key)} · ${t('alUnread',{count})}${unread.data?.capped?'+':''}`:navLabel(key);
   const name=denied?`${label} · ${t('locked')}`:label;
    return <Link key={href} href={href} prefetch={false} className={denied?'nav-feature-locked':undefined} data-locked={denied||undefined} aria-label={name} title={denied?`${name} · ${t('requiredTier',{tier:access.features[required!]?.requiredTier??'PRO'})}`:collapsed?label:undefined} aria-current={(href==='/app'?pathname===href:pathname.startsWith(href))||key==='radar'&&pathname.startsWith('/app/narratives/')?'page':undefined} onClick={()=>{if(close)setMobile(false);}}><Icon size={18} aria-hidden="true"/><span>{navLabel(key)}</span>{denied&&<LockKeyhole size={14} className="nav-feature-lock" aria-hidden="true"/>}{key==='alerts'&&badge&&<b className="nav-alert-badge" aria-hidden="true">{badge}</b>}</Link>;
  });
 return <div className={`research-shell context-collapsed ${collapsed?'sidebar-collapsed':''}`}>
  <IntelligenceBar/>
  <aside className="research-sidebar"><Link className="research-brand" href="/" prefetch={false} aria-label="Narrax"><BrandMark/><span>NARRAX</span></Link><p className="sidebar-label">{t('workspace')}</p><nav aria-label={t('navigation')}>{links()}</nav><div className="sidebar-bottom"><PoweredBy className="powered-by-side"/><Link href="/early-access" title={t('access')}><ArrowUpRight size={18} aria-hidden="true"/><span>{t('access')}</span></Link><button disabled={signingOut} onClick={signOut} title={t('signOut')}><LogOut size={18} aria-hidden="true"/><span>{t('signOut')}</span></button>{logoutError&&<p role="alert">{t('error')}</p>}<button onClick={()=>setCollapsed(!collapsed)} aria-label={t(collapsed?'expand':'collapse')} aria-expanded={!collapsed}>{collapsed?<PanelLeftOpen size={18}/>:<PanelLeftClose size={18}/>}<span>{t('collapse')}</span></button></div></aside>
  <div className="research-tools"><Dialog.Root open={mobile} onOpenChange={setMobile}><Dialog.Trigger asChild><button className="mobile-research-menu research-control"><Menu size={18} aria-hidden="true"/>{t('menu')}</button></Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="dialog-content research-drawer"><Dialog.Title>{t('navigation')}</Dialog.Title><Dialog.Description>{t('workspace')}</Dialog.Description><nav>{links(true)}</nav><Link href="/early-access">{t('access')}</Link><button className="research-control" disabled={signingOut} onClick={signOut}>{t('signOut')}</button>{logoutError&&<p role="alert">{t('error')}</p>}<Dialog.Close className="research-control">{t('close')}</Dialog.Close></Dialog.Content></Dialog.Portal></Dialog.Root><span className="workspace-label">NARRAX / {t('workspace')}</span><LocaleToggle/><ThemeToggle initial={theme}/></div>
   <main id="main" className="research-main" tabIndex={-1}><div className="research-wrap">{locked?<Locked tier={access.features[feature!]?.requiredTier}/>:children}<p className="research-disclaimer">{t('researchOnly')}</p></div></main>
  <nav className="research-bottom-nav" aria-label={t('navigation')}>{links()}</nav>
 </div>;
}
function IntelligenceBar(){const t=useTranslations('workspace'),f=useFormat(),query=useResearchQuery('market-preview',MarketPreviewSchema,true,60000);const bar=query.isError?null:query.data;
 const state=query.isPending?t('snapshotStates.loading'):query.isError?t('snapshotStates.failed'):!bar?t('unavailable'):null;
 return <header className="intelligence-bar" tabIndex={0} aria-label={t('snapshot')} aria-busy={query.isFetching}>
   <span title={bar?.solUsd?t('updated',{at:f.date(bar.solUsd.at)}):undefined}>SOL <b>{state??(!bar?.solUsd?t('snapshotStates.noPrice'):f.usd(bar.solUsd.priceUsd))}</b>{bar?.solUsd?.stale&&<small className="preview-stale">{t('snapshotStates.stalePrice')}</small>}</span>
  <span>{t('heat')} <b>{state??(bar?.narrativeHeat==null?t('snapshotStates.noNarratives'):f.number(bar.narrativeHeat))}</b></span>
   <span>{t('enhance.trackedWallets')} <b>{state??f.number(bar?.trackedWallets,0)}</b></span>
   <span>{t('opportunityCount')} <b>{state??f.number(bar?.opportunities24h,0)}</b></span>
  {query.isError?<button className="research-control" title={t(researchErrorKey(query.error))} disabled={query.isFetching} onClick={()=>void query.refetch()}>{t('retry')}</button>:<span className="snapshot-label" title={query.data?t('updated',{at:f.date(query.data.at)}):undefined}>{t('snapshot')}</span>}
 </header>;
}
