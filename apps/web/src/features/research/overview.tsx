'use client';
import {TokenIdentity} from './token-identity';
import {useTranslations} from 'next-intl';
import {Link} from '@/i18n/navigation';
import {useResearchQuery} from './session';
import {OverviewSchema} from './contracts';
import {PageHeading,Section,Metrics,Loading,ResourceError,Locked,Empty,Stamp,useFormat} from './ui';
export function OverviewPage(){
 const t=useTranslations('workspace'),f=useFormat(),query=useResearchQuery('overview',OverviewSchema);
 return <><PageHeading title={t('overviewTitle')} body={t('overviewBody')} actions={<button className="research-control" disabled={query.isFetching} onClick={()=>void query.refetch()}>{t('refresh')}</button>}/>
 {query.isError?<ResourceError error={query.error} retry={()=>void query.refetch()}/>:query.isPending?<Loading/>:(()=>{const data=query.data,bar=data.bar;return <>
   <Stamp at={data.at}/><p className="research-notice">{t('trench.context')}</p>
  <Metrics items={[{label:t('openPositions'),value:f.number(data.me.openPositions,0)},{label:t('pending'),value:f.number(data.me.pendingConfirmations,0)},{label:t('unread'),value:f.number(data.me.unreadAlerts,0)},...(bar?[{label:t('activeNarratives'),value:f.number(bar.counts.activeNarratives,0)},{label:t('accelerating'),value:f.number(bar.counts.acceleratingNarratives,0)},{label:t('trackedWallets'),value:f.number(bar.counts.trackedWallets,0)}]:[])]}/>
  <Section title={t('marketBrief')}>{data.locked.overview?<Locked/>:<div className="market-brief"><p className="research-note">{t('rulesBrief')} {t('sourceLanguage')}</p>{data.brief.points.length?data.brief.points.map((point,i)=><p key={i}>{point}</p>):<Empty/>}</div>}</Section>
  <Section title={t('emerging')} action={<Link href="/app/radar">{t('openRadar')} ↗</Link>}>{data.locked.narratives?<Locked/>:!data.strip.topNarratives.length?<Empty/>:<div className="narrative-list">{data.strip.topNarratives.map(n=><Link className="narrative-row" href={`/app/narratives/${encodeURIComponent(n.slug)}`} key={n.id}><strong>{n.name}</strong><span className="research-tag">{t(`stages.${n.stage}`)}</span><span>{t('score')} <b>{f.number(n.score)}</b></span><span>{t('velocity')} <b>{f.number(n.velocity)}</b></span><span aria-hidden="true">↗</span></Link>)}</div>}</Section>
    <Section title={t('topOpportunity')} action={<Link href="/app/opportunities">{t('opportunities')} ↗</Link>}>{data.locked.opportunities?<Locked/>:data.strip.hottestOpportunity?<details className="research-history"><summary>{t('trench.historicalModels')}</summary><p className="research-notice">{t('trench.historyNote')}</p><div className="opportunity-highlight"><div><span className="research-note">{data.strip.hottestOpportunity.narrative?.name??t('noLinkedNarrative')}</span><h3><Link href={`/app/tokens/${encodeURIComponent(data.strip.hottestOpportunity.token.mint)}`}><TokenIdentity {...data.strip.hottestOpportunity.token} compact/> ↗</Link></h3></div><Metrics items={[{label:t('score'),value:f.number(data.strip.hottestOpportunity.score)},{label:t('price'),value:f.usd(data.strip.hottestOpportunity.token.priceUsd)},{label:t('marketCap'),value:f.usd(data.strip.hottestOpportunity.token.marketCapUsd)}]}/></div></details>:<Empty/>}</Section>
  <Section title={t('rotation')}>{data.locked.rotation?<Locked/>:data.rotation?<><div className="research-columns">{(['rising','falling'] as const).map(direction=><div key={direction}><h3>{t(direction)}</h3>{data.rotation![direction].map(n=><p key={n.id}><Link href={`/app/narratives/${encodeURIComponent(n.slug)}`}>{n.name}</Link> <span>{f.number(n.from)} → {f.number(n.to)}</span></p>)}</div>)}</div>{!data.rotation.detected&&<p>{t('noRotation')}</p>}<p className="research-note">{t('unknownRotation',{count:data.rotation.unknown})} {t('rotationNote')}</p></>:<Empty/>}</Section>
 </>;})()}</>;
}
