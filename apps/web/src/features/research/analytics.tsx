'use client';
import {TokenIdentity} from './token-identity';
import {useState} from 'react';
import {useTranslations} from 'next-intl';
import {Link} from '@/i18n/navigation';
import {useResearchQuery} from './session';
import {OutcomesSchema,SignalsSchema,SummarySchema,type Described} from './contracts';
import {pagePath} from './api';
import {usePagination} from './pagination';
import {PageHeading,Section,Metrics,DataTable,Loading,ResourceError,Empty,Pager,useFormat} from './ui';

const DAYS=[7,30,90];
/** Past agent decisions and what happened after them. Every number carries its sample size, and thin samples say so. */
export function AnalyticsPage(){
 const t=useTranslations('workspace'),f=useFormat(),[days,setDays]=useState(30);
 const summary=useResearchQuery(`analytics/decisions/summary?days=${days}`,SummarySchema);
 const pct=(v:number|null)=>v==null?t('unknown'):`${f.number(v,2)}%`;
 const row=(label:string,d:Described)=>({key:label,cells:[label,f.number(d.n,0),pct(d.mean),pct(d.median),f.percent(d.winRate),d.sufficient?t('anEnough'):t('anThin')]});
 const head=[t('anGroup'),t('anSample'),t('anMean'),t('anMedian'),t('anWinRate'),t('anEvidence')];
 return <><PageHeading title={t('analytics')} body={t('analyticsBody')} actions={<label className="research-filters">{t('anWindow')}<select value={days} onChange={e=>setDays(Number(e.target.value))}>{DAYS.map(d=><option key={d} value={d}>{t('anDays',{days:d})}</option>)}</select></label>}/>
  {summary.isError?<ResourceError error={summary.error} retry={()=>void summary.refetch()}/>:summary.isPending?<Loading/>:<>
   <Section title={t('anDecisions')}>
    <Metrics items={[{label:t('anIndependent'),value:f.number(summary.data.decisions.independent,0)},{label:t('anFinal'),value:f.number(summary.data.decisions.final,0)},{label:t('anPending'),value:f.number(summary.data.decisions.pending,0)},{label:t('anUnknown'),value:f.number(summary.data.decisions.unknown,0)},{label:'WIN / LOSS / FLAT',value:`${summary.data.labels.WIN} / ${summary.data.labels.LOSS} / ${summary.data.labels.FLAT}`},{label:t('anLead'),value:summary.data.medianLeadTimeSeconds==null?t('unknown'):`${f.number(summary.data.medianLeadTimeSeconds/60,0)} min`}]}/>
    {summary.data.returns.note&&<p className="research-note" role="status">{summary.data.returns.note}</p>}
    {summary.data.decisions.truncated&&<p className="research-note">{t('anTruncated')}</p>}
    <p className="research-note">{t('anCost',{cost:f.number(summary.data.costPct,2)})}</p>
    <DataTable caption={t('anDecisions')} headers={head} rows={[row(t('anAll'),summary.data.returns),...summary.data.byConfidence.map(b=>row(`${t('anConfidence')} ${b.label}`,b.described))]}/>
   </Section>
   <Section title={t('anCaveats')}><ul>{summary.data.caveats.map((c,i)=><li key={i}>{c}</li>)}</ul></Section></>}
  <Signals days={days} head={head} row={row}/><Outcomes/></>;
}
function Signals({days,head,row}:{days:number;head:string[];row:(label:string,d:Described)=>{key:string;cells:React.ReactNode[]}}){
 const t=useTranslations('workspace'),query=useResearchQuery(`analytics/signals?days=${days}`,SignalsSchema);
 return <Section title={t('anSignals')}>{query.isError?<ResourceError error={query.error} retry={()=>void query.refetch()}/>:query.isPending?<Loading/>:!query.data.byReasonCode.length?<Empty/>:<DataTable caption={t('anSignals')} headers={head} rows={query.data.byReasonCode.map(b=>row(b.label,b.described))}/>}</Section>;
}
function Outcomes(){
 const t=useTranslations('workspace'),f=useFormat(),paging=usePagination(),query=useResearchQuery(pagePath('analytics/decisions/outcomes',{},paging.cursor),OutcomesSchema);
 const pct=(v:number|null)=>v==null?t('unknown'):`${f.number(v,2)}%`;
 return <Section title={t('anOutcomes')}>{query.isError?<ResourceError error={query.error} retry={()=>void query.refetch()}/>:query.isPending?<Loading/>:!query.data.items.length?<Empty/>:
   <DataTable caption={t('anOutcomes')} headers={[t('anToken'),t('decision'),t('confidence'),t('anLabel'),'1h','24h',t('anMaxGain'),t('anMaxDrawdown'),t('anFinality')]} rows={query.data.items.map(o=>({key:o.decisionId,cells:[<Link key="token" href={`/app/tokens/${encodeURIComponent(o.token.mint)}`}><TokenIdentity {...o.token}/></Link>,o.action,f.percent(o.confidence),o.label,pct(o.return1hPct),pct(o.return24hPct),pct(o.maxGainPct),pct(o.maxDrawdownPct),o.isFinal?t('anFinal'):t('anPending')]}))}/>}
  <Pager page={paging.page} previous={paging.previous} next={()=>paging.next(query.data?.nextCursor??null)} canNext={!query.isFetching&&!query.isError&&!!query.data?.nextCursor}/></Section>;
}
