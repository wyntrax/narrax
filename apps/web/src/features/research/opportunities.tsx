'use client';
import {useState,useEffect,useRef} from 'react';
import {useTranslations} from 'next-intl';
import {Link} from '@/i18n/navigation';
import {useResearchQuery} from './session';
import {OpportunitiesSchema,AnalysisSchema,TokenSchema,type Opportunity} from './contracts';
import {pagePath} from './api';
import {usePagination} from './pagination';
import {PageHeading,Section,Metrics,Loading,ResourceError,Empty,Pager,Stamp,useFormat} from './ui';
import {ApiError} from '@/lib/api';
import {TokenIdentity} from './token-identity';
import {SafetyEvidence} from './safety-evidence';
import {LatestObservedEvidence} from './latest-evidence';
export function OpportunitiesPage(){
 const t=useTranslations('workspace');
 return <><PageHeading title={t('opportunities')} body={t('enhance.ideasBody')} actions={<Link className="research-control" href="/app/tokens">{t('enhance.openScreener')} ↗</Link>}/><details className="idea-guide"><summary>{t('enhance.howIdeas')}</summary><div className="idea-workflow">{['discover','evaluate','verify'].map((step,i)=><div key={step}><b>0{i+1}</b><strong>{t(`enhance.${step}`)}</strong><p>{t(`enhance.${step}Body`)}</p></div>)}</div></details><p className="research-notice">{t('trench.historyNote')}</p><RecordedOpportunities/></>;
}
function RecordedOpportunities(){
  const t=useTranslations('workspace'),f=useFormat(),paging=usePagination(),[selected,setSelectedState]=useState<string>(),[sort,setSort]=useState('score'),[history,setHistory]=useState(false),[reviewCount,setReviewCount]=useState(0);
  const setSelected=(id:string)=>{setSelectedState(id);setReviewCount(count=>count+1);};
 // This mixed endpoint also returns the user's own analyses. Do not block it using a shared-feature tier check.
  const query=useResearchQuery(pagePath('opportunities',{},paging.cursor),OpportunitiesSchema,true,30000);
 const rows=query.data?[...query.data.items].sort((a,b)=>sort==='score'?b.score-a.score:Date.parse(b.createdAt)-Date.parse(a.createdAt)):[];
  const current=rows.find(o=>o.id===selected)??rows[0];
  const detail=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(!history)return;detail.current?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});detail.current?.focus({preventScroll:true});},[history,selected,reviewCount]);
   return <><div className="research-filters"><label>{t('sort')}<select value={sort} onChange={e=>setSort(e.target.value)}><option value="score">{t('scoreSort')}</option><option value="recent">{t('recentSort')}</option></select></label><p className="research-note">{t('loadedPageOnly')} {t('enhance.ideaCoverage')}</p><button className="research-control" disabled={query.isFetching} onClick={()=>void query.refetch()}>{t('refresh')}</button></div>
  {query.isError?<ResourceError error={query.error} retry={()=>void query.refetch()}/>:query.isPending?<Loading/>:!rows.length?<Empty body={t('enhance.noIdeas')}/>:<><Metrics items={[{label:t('enhance.ideasLoaded'),value:rows.length},{label:t('enhance.withAnalysis'),value:rows.filter(o=>o.decision).length},{label:t('enhance.linkedNarratives'),value:new Set(rows.flatMap(o=>o.narrative?[o.narrative.slug]:[])).size}]}/><div className="idea-board" aria-label={t('opportunities')}>{rows.map(o=><article className="idea-card" key={o.id} data-selected={current?.id===o.id}><div className="idea-card-head"><Link href={`/app/tokens/${encodeURIComponent(o.token.mint)}`}><TokenIdentity {...o.token} compact/></Link><span className="research-tag">{t('enhance.recordedIdea')}</span></div><p>{o.narrative?<Link href={`/app/narratives/${encodeURIComponent(o.narrative.slug)}`}>{o.narrative.name} · {t(`stages.${o.narrative.stage}`)}</Link>:t('noLinkedNarrative')}</p><dl className="research-facts"><div><dt>{t('enhance.recordedDecision')}</dt><dd>{o.decision?.action??t('enhance.awaitingAnalysis')}</dd></div><div><dt>{t('enhance.recordedAt')}</dt><dd>{f.date(o.createdAt)}</dd></div></dl>
    <LatestObservedEvidence value={o.latestEvidence} compact/>
    <SafetyEvidence value={o.radarSafety} compact/>
   <button className="research-control" aria-pressed={current?.id===o.id} onClick={()=>{setSelected(o.id);setHistory(true);}}>{t('enhance.reviewIdea')} ↘</button></article>)}</div>
  <button className="research-control" aria-expanded={history} onClick={()=>setHistory(!history)}>{t('trench.historicalModels')}</button>
   {history&&current&&<div ref={detail} tabIndex={-1} className="idea-detail" aria-label={current.token.name}><CurrentQuote mint={current.token.mint}/><OpportunityDetail key={current.id} opportunity={current}/></div>}</>}
  <Pager page={paging.page} previous={paging.previous} next={()=>paging.next(query.data?.nextCursor??null)} canNext={!query.isFetching&&!query.isError&&!!query.data?.nextCursor}/></>;
}
function CurrentQuote({mint}:{mint:string}){const t=useTranslations('workspace'),f=useFormat(),query=useResearchQuery(`tokens/${encodeURIComponent(mint)}`,TokenSchema,true,60000);const token=query.data,m=token?.observation&&!token.observation.stale?token.metrics:null;return <Section title={t('enhance.currentQuote')}>{query.isError?<ResourceError error={query.error} retry={()=>void query.refetch()}/>:query.isPending?<Loading/>:m?<><Metrics items={[{label:t('price'),value:f.usd(m.priceUsd)},{label:t('liquidity'),value:f.usd(m.liquidityUsd)},{label:t('volume'),value:f.usd(m.volume24hUsd)}]}/><Stamp at={m.at}/><a href={`https://dexscreener.com/solana/${encodeURIComponent(token!.observation!.pairAddress)}`} target="_blank" rel="noopener noreferrer">DEX Screener ↗</a></>:<p>{t('trench.noMarket')}</p>}<p className="research-note">{t('enhance.quoteSeparate')}</p></Section>;}
function OpportunityDetail({opportunity:o}:{opportunity:Opportunity}){const t=useTranslations('workspace'),f=useFormat(),[analysis,setAnalysis]=useState(false);return <>
 <Section title={<TokenIdentity {...o.token} compact/>} action={<Link href={`/app/tokens/${encodeURIComponent(o.token.mint)}`}>{t('openToken')} ↗</Link>}><p>{o.narrative?<><Link href={`/app/narratives/${encodeURIComponent(o.narrative.slug)}`}>{o.narrative.name}</Link> · {t(`stages.${o.narrative.stage}`)}</>:t('noLinkedNarrative')}</p><Stamp at={o.createdAt}/><Metrics items={[{label:t('price'),value:f.usd(o.token.priceUsd)},{label:t('marketCap'),value:f.usd(o.token.marketCapUsd)},{label:t('liquidity'),value:f.usd(o.token.liquidityUsd)},{label:t('attention'),value:f.number(o.attentionGrowth)},{label:t('priceGrowth'),value:f.number(o.priceGrowth)}]}/><h3>{t('breakdown')}</h3><div className="score-breakdown">{Object.entries(o.scores).map(([key,value])=><div key={key}><span>{t(`scoreLabels.${key}`)}</span><b>{f.number(value)}</b><div className="score-track" aria-hidden="true"><i style={{width:`${Math.min(100,Math.max(0,value))}%`}}/></div></div>)}</div><p className="research-note">{t('ogNote')}</p><button className="research-control" onClick={()=>setAnalysis(!analysis)} aria-expanded={analysis}>{t('viewAnalysis')}</button></Section>
   <LatestObservedEvidence value={o.latestEvidence}/>
   <SafetyEvidence value={o.radarSafety}/>
  {analysis&&<AnalysisPanel id={o.id}/>}</>;}
function AnalysisPanel({id}:{id:string}){const t=useTranslations('workspace'),f=useFormat(),query=useResearchQuery(`opportunities/${encodeURIComponent(id)}/analysis`,AnalysisSchema,true,30000);
  if(query.isError&&query.error instanceof ApiError&&query.error.code==='NOT_FOUND')return <Section title={t('analysis')} action={<button className="research-control" disabled={query.isFetching} onClick={()=>void query.refetch()}>{t('refresh')}</button>}><Empty body={t('enhance.analysisCoverage')}/></Section>;
 return <Section title={t('analysis')}>{query.isError?<ResourceError error={query.error} retry={()=>void query.refetch()}/>:query.isPending?<Loading/>:<><p className="research-note">{t('analysisAt',{at:f.date(query.data.analyzedAt)})} · {t('model')}: {query.data.model}</p><p>{query.data.decision.summary}</p><p className="research-tag">{query.data.decision.action} · {t('confidence')}: {f.percent(query.data.decision.confidence)}</p><div className="research-columns">{(['bull','bear'] as const).map(side=><div key={side}><h3>{t(side)}</h3>{query.data[side]?<ul>{[...query.data[side]!.arguments,...query.data[side]!.keyUncertainties].map((point,i)=><li key={i}>{point}</li>)}</ul>:<p>{t('unavailable')}</p>}</div>)}</div><h3>{t('risks')}</h3>{query.data.risk?<><ul>{query.data.risk.risks.map((risk,i)=><li key={i}><b>{risk.severity} · {risk.code}</b> {risk.description}</li>)}</ul><p>{query.data.risk.maxLossScenario}</p></>:<p>{t('unavailable')}</p>}<h3>{t('guardrails')}</h3><ul>{query.data.guardrails.map((rule,i)=><li key={i}>{rule}</li>)}</ul>{!!query.data.decision.invalidationConditions?.length&&<><h3>{t('invalidation')}</h3><ul>{query.data.decision.invalidationConditions.map((rule,i)=><li key={i}>{rule}</li>)}</ul></>}<p className="research-note">{t('sourceLanguage')} {t('researchOnly')}</p></>}</Section>;
}
