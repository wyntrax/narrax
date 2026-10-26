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
import './analytics.css';

const DAYS=[7,30,90];
const ACTIONS=['BUY','WATCH','IGNORE','SELL','REDUCE','HOLD'] as const;
/** Past agent decisions and what happened after them. Every number carries its sample size, and thin samples say so. */
export function AnalyticsPage(){
 const t=useTranslations('workspace'),f=useFormat(),[days,setDays]=useState(30),[action,setAction]=useState<string>('BUY');
 const filters=`days=${days}&action=${action}`;
 const summary=useResearchQuery(`analytics/decisions/summary?${filters}`,SummarySchema);
 const pct=(v:number|null)=>v==null?t('unknown'):`${f.number(v,2)}%`;
 const row=(label:string,d:Described)=>({key:label,cells:[label,f.number(d.n,0),f.number(d.distinctTokens,0),pct(d.mean),pct(d.median),f.percent(d.winRate),d.sufficient?t('anEnough'):t('anThin')]});
 const head=[t('anGroup'),t('anSample'),t('anCoverage.tokens'),t('anMean'),t('anMedian'),t('anCoverage.positiveRate'),t('anEvidence')];
 return <><PageHeading title={t('analytics')} body={t('analyticsBody')} actions={<div className="research-filters"><label>{t('anCoverage.action')}<select value={action} onChange={e=>setAction(e.target.value)}>{ACTIONS.map(a=><option key={a} value={a}>{a}</option>)}</select></label><label>{t('anWindow')}<select value={days} onChange={e=>setDays(Number(e.target.value))}>{DAYS.map(d=><option key={d} value={d}>{t('anDays',{days:d})}</option>)}</select></label></div>}/>
   <p className="research-note">{t('anCoverage.priceOnly')}</p>
  {summary.isError?<ResourceError error={summary.error} retry={()=>void summary.refetch()}/>:summary.isPending?<Loading/>:<>
   <Section title={t('anDecisions')}>
    <Metrics items={[{label:t('anCoverage.total'),value:f.number(summary.data.decisions.total,0)},{label:t('anCoverage.awaiting'),value:f.number(summary.data.decisions.awaitingMeasurement,0)},{label:t('anIndependent'),value:f.number(summary.data.decisions.independent,0)},{label:t('anCoverage.known'),value:f.number(summary.data.decisions.known,0)},{label:t('anCoverage.pending'),value:f.number(summary.data.decisions.pending,0)},{label:t('anCoverage.unavailable'),value:f.number(summary.data.decisions.unknown,0)},{label:t('anCoverage.unknownRate'),value:f.percent(summary.data.decisions.unknownRate)},{label:'WIN / LOSS / FLAT',value:`${summary.data.labels.WIN} / ${summary.data.labels.LOSS} / ${summary.data.labels.FLAT}`}]}/>
    <p className="research-note">{t('anCoverage.counts',{read:f.number(summary.data.decisions.read,0),independent:f.number(summary.data.decisions.independent,0),known:f.number(summary.data.decisions.known,0),final:f.number(summary.data.decisions.final,0)})}</p>
    {summary.data.decisions.awaitingMeasurement>0&&<p className="research-note">{t('anCoverage.awaitingHelp')}</p>}
    {summary.data.returns.note&&<p className="research-note" role="status">{summary.data.returns.note}</p>}
    {summary.data.decisions.truncated&&<p className="research-note">{t('anTruncated')}</p>}
    <p className="research-note">{action==='BUY'?t('anCost',{cost:f.number(summary.data.costPct,2)}):t('anCoverage.noTradeCost')}</p>
    <p className="research-note">{t('anCoverage.labels')}</p>
    <DataTable caption={t('anDecisions')} headers={head} rows={[row(t('anAll'),summary.data.returns),...summary.data.byConfidence.map(b=>row(`${t('anConfidence')} ${b.label}`,b.described))]}/>
   </Section>
   <Section title={t('anCaveats')}><ul>{summary.data.caveats.map((c,i)=><li key={i}>{c}</li>)}</ul></Section></>}
  <Signals filters={filters} head={head} row={row}/><Outcomes key={filters} days={days} action={action}/></>;
}
function Signals({filters,head,row}:{filters:string;head:string[];row:(label:string,d:Described)=>{key:string;cells:React.ReactNode[]}}){
 const t=useTranslations('workspace'),query=useResearchQuery(`analytics/signals?${filters}`,SignalsSchema);
 return <Section title={t('anSignals')}>{query.isError?<ResourceError error={query.error} retry={()=>void query.refetch()}/>:query.isPending?<Loading/>:<>{query.data.truncated&&<p className="research-note">{t('anTruncated')}</p>}{!query.data.byReasonCode.length?<Empty body={t('anCoverage.noSignals')}/>:<DataTable caption={t('anSignals')} headers={head} rows={query.data.byReasonCode.map(b=>row(b.label,b.described))}/>}</>}</Section>;
}
function Outcomes({days,action}:{days:number;action:string}){
 const t=useTranslations('workspace'),f=useFormat(),paging=usePagination(),query=useResearchQuery(pagePath('analytics/decisions/outcomes',{days:String(days),action},paging.cursor),OutcomesSchema);
 const pct=(v:number|null)=>v==null?t('anCoverage.notRecorded'):`${f.number(v,2)}%`;
 const reason=(code:string|null,final:boolean)=>code==='NO_ENTRY_PRICE'?t('anCoverage.noEntry'):code==='NO_HORIZON_PRICE'?t('anCoverage.noHorizon'):!final?t('anCoverage.waiting'):t('anCoverage.unspecified');
 return <Section title={t('anOutcomes')}><p className="research-note">{t('anCoverage.rows')}</p>{query.isError?<ResourceError error={query.error} retry={()=>void query.refetch()}/>:query.isPending?<Loading/>:!query.data.items.length?<Empty body={t('anCoverage.noOutcomes')}/>:
   <div className="analytics-outcomes"><DataTable caption={t('anOutcomes')} headers={[t('anToken'),t('anCoverage.decidedAt'),t('decision'),t('confidence'),t('anLabel'),'1h','24h',t('anMaxGain'),t('anMaxDrawdown'),t('anFinality')]} rows={query.data.items.map(o=>{const known=o.label!=='UNKNOWN'&&o.return24hPct!=null;return {key:o.decisionId,cells:[<Link key="token" href={`/app/tokens/${encodeURIComponent(o.token.mint)}`}><TokenIdentity {...o.token}/></Link>,f.date(o.decidedAt),o.action,f.percent(o.confidence),known?o.label:t('anCoverage.noResult'),pct(o.return1hPct),pct(o.return24hPct),pct(o.maxGainPct),pct(o.maxDrawdownPct),<div key="status">{o.isFinal?t(known?'anCoverage.measured':'anCoverage.unavailable'):t('anCoverage.pending')}{!known&&<p className="research-note">{reason(o.unknownReason,o.isFinal)}</p>}</div>]};})}/></div>}
  <Pager page={paging.page} previous={paging.previous} next={()=>paging.next(query.data?.nextCursor??null)} canNext={!query.isFetching&&!query.isError&&!!query.data?.nextCursor}/></Section>;
}
