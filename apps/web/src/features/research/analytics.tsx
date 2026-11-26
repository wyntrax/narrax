'use client';
import {TokenIdentity} from './token-identity';
import {useState,type ReactNode} from 'react';
import {useTranslations} from 'next-intl';
import {Info} from 'lucide-react';
import {Link} from '@/i18n/navigation';
import {useResearchQuery} from './session';
import {OutcomesSchema,SignalsSchema,SummarySchema,type Described} from './contracts';
import {pagePath} from './api';
import {usePagination} from './pagination';
import {PageHeading,Section,DataTable,Loading,ResourceError,Empty,Pager,useFormat} from './ui';
import './analytics.css';

const DAYS=[7,30,90];
const ACTIONS=['BUY','WATCH','IGNORE','SELL','REDUCE','HOLD'] as const;

function ReturnValue({value,fallback,format}:{value:number|null;fallback:string;format:(v:number)=>string}){
 if(value==null)return <span className="analytics-num analytics-num-muted">{fallback}</span>;
 const tone=value>0?'pos':value<0?'neg':'flat';
 return <span className={`analytics-num analytics-num-${tone}`}>{format(value)}</span>;
}

function OutcomePill({label,known,fallback}:{label:string;known:boolean;fallback:string}){
 const text=known?label:fallback;
 const tone=!known?'muted':label==='WIN'?'pos':label==='LOSS'?'neg':'flat';
 return <span className={`analytics-pill analytics-pill-${tone}`}>{text}</span>;
}

/** Past agent decisions and what happened after them. Every number carries its sample size, and thin samples say so. */
export function AnalyticsPage(){
 const t=useTranslations('workspace'),f=useFormat(),[days,setDays]=useState(30),[action,setAction]=useState<string>('BUY');
 const filters=`days=${days}&action=${action}`;
 const summary=useResearchQuery(`analytics/decisions/summary?${filters}`,SummarySchema);
 const fmtPct=(v:number)=>`${f.number(v,2)}%`;
 const row=(label:string,d:Described)=>({
  key:label,
  cells:[
   <span key="label" className="analytics-group-label">{label}</span>,
   <span key="n" className="analytics-num">{f.number(d.n,0)}</span>,
   <span key="tokens" className="analytics-num">{f.number(d.distinctTokens,0)}</span>,
   <ReturnValue key="mean" value={d.mean} fallback={t('unknown')} format={fmtPct}/>,
   <ReturnValue key="median" value={d.median} fallback={t('unknown')} format={fmtPct}/>,
   <span key="wr" className="analytics-num">{f.percent(d.winRate)}</span>,
   <span key="ev" className={`analytics-pill ${d.sufficient?'analytics-pill-pos':'analytics-pill-warn'}`}>{d.sufficient?t('anEnough'):t('anThin')}</span>,
  ],
 });
 const head=[t('anGroup'),t('anSample'),t('anCoverage.tokens'),t('anMean'),t('anMedian'),t('anCoverage.positiveRate'),t('anEvidence')];
 const d=summary.data;
 const labelTotal=d?d.labels.WIN+d.labels.LOSS+d.labels.FLAT:0;
 const winShare=labelTotal?(d!.labels.WIN/labelTotal)*100:0;
 const lossShare=labelTotal?(d!.labels.LOSS/labelTotal)*100:0;
 const flatShare=labelTotal?(d!.labels.FLAT/labelTotal)*100:0;
 const coverageShare=d&&d.decisions.total>0?Math.min(100,(d.decisions.known/d.decisions.total)*100):0;

 return <div className="analytics-page">
  <PageHeading
   title={t('analytics')}
   body={t('analyticsBody')}
   actions={
    <div className="research-filters analytics-toolbar">
     <label>{t('anCoverage.action')}<select value={action} onChange={e=>setAction(e.target.value)}>{ACTIONS.map(a=><option key={a} value={a}>{a}</option>)}</select></label>
     <label>{t('anWindow')}<select value={days} onChange={e=>setDays(Number(e.target.value))}>{DAYS.map(day=><option key={day} value={day}>{t('anDays',{days:day})}</option>)}</select></label>
    </div>
   }
  />

  <div className="analytics-scope-banner">
   <Info size={15} aria-hidden="true"/>
   <p>{t('anCoverage.priceOnly')}</p>
  </div>

  {summary.isError?<ResourceError error={summary.error} retry={()=>void summary.refetch()}/>:summary.isPending?<Loading/>:<>
   <Section title={t('anDecisions')}>
    <dl className="analytics-kpi-primary">
     <div className="analytics-kpi-card">
      <dt>{t('anCoverage.total')}</dt>
      <dd>{f.number(d!.decisions.total,0)}</dd>
     </div>
     <div className="analytics-kpi-card">
      <dt>{t('anCoverage.known')}</dt>
      <dd>{f.number(d!.decisions.known,0)}</dd>
      <div className="analytics-bar" aria-hidden="true"><span className="analytics-bar-fill" style={{width:`${coverageShare}%`}}/></div>
     </div>
     <div className="analytics-kpi-card">
      <dt>WIN / LOSS / FLAT</dt>
      <dd className="analytics-wlf">{`${d!.labels.WIN} / ${d!.labels.LOSS} / ${d!.labels.FLAT}`}</dd>
      {labelTotal>0&&<div className="analytics-bar analytics-bar-split" aria-hidden="true">
       {winShare>0&&<span className="analytics-bar-pos" style={{width:`${winShare}%`}}/>}
       {flatShare>0&&<span className="analytics-bar-flat" style={{width:`${flatShare}%`}}/>}
       {lossShare>0&&<span className="analytics-bar-neg" style={{width:`${lossShare}%`}}/>}
      </div>}
     </div>
     <div className="analytics-kpi-card">
      <dt>{t('anCoverage.unknownRate')}</dt>
      <dd>{f.percent(d!.decisions.unknownRate)}</dd>
     </div>
    </dl>

    <dl className="analytics-kpi-secondary">
     <div><dt>{t('anCoverage.awaiting')}</dt><dd>{f.number(d!.decisions.awaitingMeasurement,0)}</dd></div>
     <div><dt>{t('anIndependent')}</dt><dd>{f.number(d!.decisions.independent,0)}</dd></div>
     <div><dt>{t('anCoverage.pending')}</dt><dd>{f.number(d!.decisions.pending,0)}</dd></div>
     <div><dt>{t('anCoverage.unavailable')}</dt><dd>{f.number(d!.decisions.unknown,0)}</dd></div>
    </dl>

    <div className="analytics-notes-grid">
     <p>{t('anCoverage.counts',{read:f.number(d!.decisions.read,0),independent:f.number(d!.decisions.independent,0),known:f.number(d!.decisions.known,0),final:f.number(d!.decisions.final,0)})}</p>
     <p>{action==='BUY'?t('anCost',{cost:f.number(d!.costPct,2)}):t('anCoverage.noTradeCost')}</p>
     <p>{t('anCoverage.labels')}</p>
     {d!.decisions.awaitingMeasurement>0&&<p>{t('anCoverage.awaitingHelp')}</p>}
     {d!.returns.note&&<p role="status">{d!.returns.note}</p>}
     {d!.decisions.truncated&&<p>{t('anTruncated')}</p>}
    </div>

    <div className="analytics-table-wrap">
     <DataTable caption={t('anDecisions')} headers={head} rows={[row(t('anAll'),d!.returns),...d!.byConfidence.map(b=>row(`${t('anConfidence')} ${b.label}`,b.described))]}/>
    </div>
   </Section>
  </>}

  <Signals filters={filters} head={head} row={row}/>
  <Outcomes key={filters} days={days} action={action}/>

  {d&&d.caveats.length>0&&<Section title={t('anCaveats')}>
   <ul className="analytics-caveats-list">{d.caveats.map((c,i)=><li key={i}>{c}</li>)}</ul>
  </Section>}
 </div>;
}

function Signals({filters,head,row}:{filters:string;head:string[];row:(label:string,d:Described)=>{key:string;cells:ReactNode[]}}){
 const t=useTranslations('workspace'),query=useResearchQuery(`analytics/signals?${filters}`,SignalsSchema);
 return <Section title={t('anSignals')}>
  {query.isError?<ResourceError error={query.error} retry={()=>void query.refetch()}/>:query.isPending?<Loading/>:<>
   {query.data.truncated&&<p className="research-note">{t('anTruncated')}</p>}
   {!query.data.byReasonCode.length?<Empty body={t('anCoverage.noSignals')}/>:<div className="analytics-table-wrap"><DataTable caption={t('anSignals')} headers={head} rows={query.data.byReasonCode.map(b=>row(b.label,b.described))}/></div>}
  </>}
 </Section>;
}

function Outcomes({days,action}:{days:number;action:string}){
 const t=useTranslations('workspace'),f=useFormat(),paging=usePagination(),query=useResearchQuery(pagePath('analytics/decisions/outcomes',{days:String(days),action},paging.cursor),OutcomesSchema);
 const fmtPct=(v:number)=>`${f.number(v,2)}%`;
 const reason=(code:string|null,final:boolean)=>code==='NO_ENTRY_PRICE'?t('anCoverage.noEntry'):code==='NO_HORIZON_PRICE'?t('anCoverage.noHorizon'):!final?t('anCoverage.waiting'):t('anCoverage.unspecified');
 return <Section title={t('anOutcomes')}>
  <p className="analytics-section-sub">{t('anCoverage.rows')}</p>
  {query.isError?<ResourceError error={query.error} retry={()=>void query.refetch()}/>:query.isPending?<Loading/>:!query.data.items.length?<Empty body={t('anCoverage.noOutcomes')}/>:
   <div className="analytics-outcomes">
    <DataTable
     caption={t('anOutcomes')}
     headers={[t('anToken'),t('anCoverage.decidedAt'),t('decision'),t('confidence'),t('anLabel'),'1h','24h',t('anMaxGain'),t('anMaxDrawdown'),t('anFinality')]}
     rows={query.data.items.map(o=>{
      const known=o.label!=='UNKNOWN'&&o.return24hPct!=null;
      const statusTone=o.isFinal?(known?'pos':'muted'):'warn';
      return {
       key:o.decisionId,
       cells:[
        <Link key="token" href={`/app/tokens/${encodeURIComponent(o.token.mint)}`}><TokenIdentity {...o.token}/></Link>,
        <span key="at" className="analytics-date">{f.date(o.decidedAt)}</span>,
        <span key="action" className="analytics-action">{o.action}</span>,
        <span key="conf" className="analytics-num">{f.percent(o.confidence)}</span>,
        <OutcomePill key="label" label={o.label} known={known} fallback={t('anCoverage.noResult')}/>,
        <ReturnValue key="1h" value={o.return1hPct} fallback={t('anCoverage.notRecorded')} format={fmtPct}/>,
        <ReturnValue key="24h" value={o.return24hPct} fallback={t('anCoverage.notRecorded')} format={fmtPct}/>,
        <ReturnValue key="gain" value={o.maxGainPct} fallback={t('anCoverage.notRecorded')} format={fmtPct}/>,
        <ReturnValue key="dd" value={o.maxDrawdownPct} fallback={t('anCoverage.notRecorded')} format={fmtPct}/>,
        <div key="status" className="analytics-status-cell">
         <span className={`analytics-pill analytics-pill-${statusTone}`}>{o.isFinal?t(known?'anCoverage.measured':'anCoverage.unavailable'):t('anCoverage.pending')}</span>
         {!known&&<p className="analytics-status-reason">{reason(o.unknownReason,o.isFinal)}</p>}
        </div>,
       ],
      };
     })}
    />
   </div>}
  <Pager page={paging.page} previous={paging.previous} next={()=>paging.next(query.data?.nextCursor??null)} canNext={!query.isFetching&&!query.isError&&!!query.data?.nextCursor}/>
 </Section>;
}
