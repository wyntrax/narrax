'use client';
import {TokenIdentity} from './token-identity';
import {useLocale,useTranslations} from 'next-intl';
import {Activity,ArrowUpRight,Bell,Briefcase,Clock,Compass,Flame,Info,RefreshCw,TrendingDown,TrendingUp,Wallet} from 'lucide-react';
import {snapshotCopy} from '@/content/research-snapshot';
import {Link} from '@/i18n/navigation';
import {useResearchQuery} from './session';
import {OverviewSchema} from './contracts';
import {PageHeading,Section,Metrics,Loading,ResourceError,Locked,Empty,Stamp,useFormat} from './ui';
import './overview.css';

function stageTone(stage:string){
 if(stage==='ACCELERATING')return 'pos';
 if(stage==='EMERGING')return 'accent';
 if(stage==='COOLING'||stage==='DYING')return 'neg';
 return 'neutral';
}

export function OverviewPage(){
 const t=useTranslations('workspace'),f=useFormat(),query=useResearchQuery('overview',OverviewSchema);
 const copy=snapshotCopy[useLocale()==='id'?'id':'en'];
 return <div className="overview-page">
  <PageHeading
   title={t('overviewTitle')}
   body={t('overviewBody')}
   actions={
    <button className="research-control overview-refresh" disabled={query.isFetching} onClick={()=>void query.refetch()}>
     <RefreshCw size={14} className={query.isFetching?'overview-spin':undefined} aria-hidden="true"/>
     {t('refresh')}
    </button>
   }
  />

  {query.isError?<ResourceError error={query.error} retry={()=>void query.refetch()}/>:query.isPending?<Loading/>:(()=>{
   const data=query.data,bar=data.bar;
   const heatPct=bar?.narrativeHeat!=null?Math.max(0,Math.min(100,bar.narrativeHeat)):null;
   return <>
    <div className="overview-meta-bar">
     <div className="overview-context-note"><Info size={14} aria-hidden="true"/><span>{t('trench.context')}</span></div>
     <Stamp at={data.at}/>
    </div>

    <div className="overview-kpi-grid">
     <Link href="/app/portfolio" className="overview-kpi-card">
      <div className="overview-kpi-head"><Briefcase size={15} aria-hidden="true"/><span>{t('openPositions')}</span><ArrowUpRight size={14} className="overview-kpi-arrow" aria-hidden="true"/></div>
      <strong className="overview-kpi-value">{f.number(data.me.openPositions,0)}</strong>
     </Link>
     <Link href="/app/portfolio" className="overview-kpi-card">
      <div className="overview-kpi-head"><Clock size={15} aria-hidden="true"/><span>{t('pending')}</span><ArrowUpRight size={14} className="overview-kpi-arrow" aria-hidden="true"/></div>
      <strong className="overview-kpi-value">{f.number(data.me.pendingConfirmations,0)}</strong>
     </Link>
     <Link href="/app/alerts" className={`overview-kpi-card${data.me.unreadAlerts>0?' overview-kpi-highlight':''}`}>
      <div className="overview-kpi-head"><Bell size={15} aria-hidden="true"/><span>{t('unread')}</span><ArrowUpRight size={14} className="overview-kpi-arrow" aria-hidden="true"/></div>
      <strong className="overview-kpi-value">{f.number(data.me.unreadAlerts,0)}</strong>
     </Link>
     {bar&&<>
      <Link href="/app/radar" className="overview-kpi-card">
       <div className="overview-kpi-head"><Compass size={15} aria-hidden="true"/><span>{t('activeNarratives')}</span><ArrowUpRight size={14} className="overview-kpi-arrow" aria-hidden="true"/></div>
       <strong className="overview-kpi-value">{f.number(bar.counts.activeNarratives,0)}</strong>
       {heatPct!=null&&<div className="overview-bar" aria-hidden="true"><span style={{width:`${heatPct}%`}}/></div>}
      </Link>
      <Link href="/app/radar" className="overview-kpi-card">
       <div className="overview-kpi-head"><Flame size={15} aria-hidden="true"/><span>{t('accelerating')}</span><ArrowUpRight size={14} className="overview-kpi-arrow" aria-hidden="true"/></div>
       <strong className={`overview-kpi-value${bar.counts.acceleratingNarratives>0?' overview-num-pos':''}`}>{f.number(bar.counts.acceleratingNarratives,0)}</strong>
      </Link>
      <Link href="/app/smart-money" className="overview-kpi-card">
       <div className="overview-kpi-head"><Wallet size={15} aria-hidden="true"/><span>{t('trackedWallets')}</span><ArrowUpRight size={14} className="overview-kpi-arrow" aria-hidden="true"/></div>
       <strong className="overview-kpi-value">{f.number(bar.counts.trackedWallets,0)}</strong>
      </Link>
     </>}
    </div>

    <Section title={t('marketBrief')}>
     {data.locked.overview?<Locked/>:<div className="market-brief overview-brief">
      <p className="overview-brief-caption"><Activity size={13} aria-hidden="true"/><span>{t('rulesBrief')} {t('sourceLanguage')}</span></p>
      {data.brief.points.length?<ul className="overview-brief-list">{data.brief.points.map((point,i)=><li key={i}>{point}</li>)}</ul>:<Empty/>}
     </div>}
    </Section>

    <Section title={copy.listTitle} action={<Link href="/app/radar">{t('openRadar')} ↗</Link>}>
     <p className="overview-section-sub">{copy.listHelp}</p>
     {data.locked.narratives?<Locked/>:!data.strip.topNarratives.length?<Empty/>:<div className="narrative-list overview-narratives">
      {data.strip.topNarratives.map((n,idx)=>{
       const pct=Math.max(0,Math.min(100,n.score));
       return <Link className="narrative-row overview-narrative-row" href={`/app/narratives/${encodeURIComponent(n.slug)}`} key={n.id}>
        <span className="overview-rank">{String(idx+1).padStart(2,'0')}</span>
        <div className="overview-narrative-main">
         <strong>{n.name}</strong>
         <span className={`research-tag overview-stage overview-stage-${stageTone(n.stage)}`}>{t(`stages.${n.stage}`)}</span>
        </div>
        <div className="overview-narrative-stats">
         <span className="overview-stat"><small>{t('score')}</small><b>{f.number(n.score)}</b><span className="overview-mini-bar" aria-hidden="true"><span style={{width:`${pct}%`}}/></span></span>
         <span className="overview-stat"><small>{t('velocity')}</small><b>{f.number(n.velocity)}</b></span>
        </div>
        <ArrowUpRight size={16} className="overview-row-arrow" aria-hidden="true"/>
       </Link>;
      })}
     </div>}
    </Section>

    <div className="overview-lower-grid">
     <Section title={t('rotation')}>
      {data.locked.rotation?<Locked/>:data.rotation?<>
       <div className="overview-rotation-grid">
        {(['rising','falling'] as const).map(direction=><div key={direction} className={`overview-rotation-col overview-rotation-${direction}`}>
         <h3 className="overview-rotation-heading">
          {direction==='rising'?<TrendingUp size={15} aria-hidden="true"/>:<TrendingDown size={15} aria-hidden="true"/>}
          {t(direction)}
         </h3>
         {data.rotation![direction].length?<ul className="overview-rotation-list">
          {data.rotation![direction].map(n=><li key={n.id}>
           <Link href={`/app/narratives/${encodeURIComponent(n.slug)}`}>{n.name}</Link>
           <span className={`overview-delta overview-delta-${direction}`}>{f.number(n.from)} → {f.number(n.to)}</span>
          </li>)}
         </ul>:<p className="overview-rotation-empty">—</p>}
        </div>)}
       </div>
       {!data.rotation.detected&&<p className="overview-section-sub">{t('noRotation')}</p>}
       <p className="overview-footnote">{t('unknownRotation',{count:data.rotation.unknown})} {t('rotationNote')}</p>
      </>:<Empty/>}
     </Section>

     <Section title={t('topOpportunity')} action={<Link href="/app/opportunities">{t('opportunities')} ↗</Link>}>
      {data.locked.opportunities?<Locked/>:data.strip.hottestOpportunity?<details className="research-history overview-opportunity-details">
       <summary>{t('trench.historicalModels')}</summary>
       <p className="research-notice overview-history-note">{t('trench.historyNote')}</p>
       <div className="opportunity-highlight overview-opportunity-card">
        <div className="overview-opp-head">
         <span className="overview-opp-narrative">{data.strip.hottestOpportunity.narrative?.name??t('noLinkedNarrative')}</span>
         <h3><Link href={`/app/tokens/${encodeURIComponent(data.strip.hottestOpportunity.token.mint)}`}><TokenIdentity {...data.strip.hottestOpportunity.token} compact/> <ArrowUpRight size={15} aria-hidden="true"/></Link></h3>
        </div>
        <Metrics items={[{label:t('score'),value:f.number(data.strip.hottestOpportunity.score)},{label:t('price'),value:f.usd(data.strip.hottestOpportunity.token.priceUsd)},{label:t('marketCap'),value:f.usd(data.strip.hottestOpportunity.token.marketCapUsd)}]}/>
       </div>
      </details>:<Empty/>}
     </Section>
    </div>
   </>;
  })()}
 </div>;
}
