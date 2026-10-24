'use client';
import {useState} from 'react';
import {useTranslations} from 'next-intl';
import {MeSchema} from '@/features/admin/contracts';
import {useResearchQuery} from './session';
import {BacktestSummarySchema,BacktestRunsSchema,BacktestDetailSchema,type BacktestCoverage} from './backtest-contracts';
import {PageHeading,Section,Metrics,Facts,DataTable,Loading,Empty,ResourceError,useFormat} from './ui';
import './backtests.css';

function Coverage({value}:{value:BacktestCoverage|null}){
 const t=useTranslations('workspace.backtests'),f=useFormat();
 if(!value)return <p className="research-note">{t('coverageMissing')}</p>;
 return <><Facts items={[{label:t('requestedRange'),value:`${f.date(value.from)} — ${f.date(value.to)}`},{label:t('observedRange'),value:`${f.date(value.firstPointAt)} — ${f.date(value.lastPointAt)}`} ]}/><Metrics items={[{label:t('tokens'),value:f.number(value.tokens,0)},{label:t('points'),value:f.number(value.metricPoints,0)},{label:t('decisions'),value:f.number(value.decisions,0)},{label:t('buys'),value:f.number(value.buyDecisions,0)},{label:t('gap'),value:f.number(value.medianGapMinutes)}]}/>{(!value.tokens||!value.metricPoints||!value.firstPointAt||!value.lastPointAt)&&<p role="status" className="research-note">{t('noHistory')}</p>}<p className="research-note">{t('coverageNote')}</p></>;
}
function Findings({findings,noConclusion}:{findings:string[];noConclusion:string[]}){
 const t=useTranslations('workspace.backtests');
 return <><Section title={t('findings')}>{findings.length?<ul>{findings.map((s,i)=><li key={i}>{s}</li>)}</ul>:<p className="research-note">{t('noFindings')}</p>}</Section><Section title={t('noConclusion')}>{noConclusion.length?<ul>{noConclusion.map((s,i)=><li key={i}>{s}</li>)}</ul>:<p className="research-note">{t('noWarnings')}</p>}</Section></>;
}
export function BacktestsPage(){
 const t=useTranslations('workspace'),b=useTranslations('workspace.backtests'),f=useFormat();
 const summary=useResearchQuery('analytics/backtest-summary',BacktestSummarySchema);
 const me=useResearchQuery('me',MeSchema);
 return <div className="backtest-page"><PageHeading title={t('backtest')} body={b('body')} actions={<button className="research-control" disabled={summary.isFetching} onClick={()=>void summary.refetch()}>{t('refresh')}</button>}/><p className="research-note">{b('readOnly')}</p>
  {summary.isPending?<Loading/>:summary.isError?<ResourceError error={summary.error} retry={()=>void summary.refetch()}/>:summary.data?.available?<><Section title={b('latest')}><Facts items={[{label:b('saved'),value:f.date(summary.data.createdAt)},{label:b('generated'),value:f.date(summary.data.generatedAt)}]}/><Coverage value={summary.data.coverage}/></Section><Findings findings={summary.data.findings} noConclusion={summary.data.noConclusion}/><Section title={b('caveats')}><ul>{summary.data.caveats.map((s,i)=><li key={i}>{s}</li>)}</ul></Section></>:<Empty body={b('empty')}/>}
  <Section title={b('limitations')}><p className="research-note">{b('limitationsBody')}</p></Section>
  {me.isError?<ResourceError error={me.error} retry={()=>void me.refetch()}/>:me.data?.isAdmin?<AdminBacktests/>:me.isPending?<Loading/>:<p className="research-note">{b('adminOnly')}</p>}
 </div>;
}
function AdminBacktests(){
 const b=useTranslations('workspace.backtests'),t=useTranslations('workspace'),f=useFormat(),[selected,setSelected]=useState('');
 const runs=useResearchQuery('analytics/backtests?limit=50',BacktestRunsSchema);
 return <Section title={b('history')} action={<button className="research-control" disabled={runs.isFetching} onClick={()=>void runs.refetch()}>{t('refresh')}</button>}><p className="research-note">{b('historyNote')}</p><p className="research-note">{b('generateHelp')} <code>npm run backtest -- --days 30</code></p>
  {runs.isPending?<Loading/>:runs.isError?<ResourceError error={runs.error} retry={()=>void runs.refetch()}/>:!runs.data?.items.length?<Empty body={b('empty')}/>:<><label className="research-note" htmlFor="backtest-run">{b('select')}</label><select className="research-control" id="backtest-run" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">{b('choose')}</option>{runs.data.items.map(run=><option key={run.id} value={run.id}>{f.date(run.createdAt)} · {run.kind} · {run.id}</option>)}</select>{selected&&<Report key={selected} id={selected}/>}</>}
 </Section>;
}
function Report({id}:{id:string}){
 const b=useTranslations('workspace.backtests'),t=useTranslations('workspace'),f=useFormat();
 const query=useResearchQuery(`analytics/backtests/${encodeURIComponent(id)}`,BacktestDetailSchema);
 if(query.isPending)return <Loading/>;
 if(query.isError)return <ResourceError error={query.error} retry={()=>void query.refetch()}/>;
 if(!query.data)return null;
 const {report:r,gates}=query.data,pct=(n:number|null)=>n==null?t('unknown'):`${f.number(n,2)}%`;
 const headers=[b('strategy'),b('sample'),b('tokens'),b('mean'),b('interval'),b('median'),b('winRate'),b('evidence')];
 return <div aria-live="polite"><Section title={b('report')}><Facts items={[{label:b('generated'),value:f.date(r.generatedAt)},{label:b('cost'),value:pct(r.costPct)}]}/><Coverage value={r.coverage}/><p className="research-note">{b('gates',{sample:gates.minSample,tokens:gates.minDistinctTokens})}</p><p className="research-note">{b('returnsNote')}</p></Section>
  {(['hold','withRules','withOwnExit'] as const).map(mode=><Section key={mode} title={b(mode)}><DataTable caption={b(mode)} headers={headers} rows={r.strategies.map((s,i)=>{const d=s[mode];return {key:String(i),cells:[s.name,d?f.number(d.n,0):t('unknown'),d?f.number(d.distinctTokens,0):t('unknown'),pct(d?.mean??null),d?.meanCi?`${pct(d.meanCi[0])} — ${pct(d.meanCi[1])}`:t('unknown'),pct(d?.median??null),f.percent(d?.winRate),<span key="note">{d?.sufficient?b('enough'):b('thin')}{d?.note&&` · ${d.note}`}</span>]};})}/></Section>)}
  <Section title={b('missing')}><DataTable caption={b('missing')} headers={[b('strategy'),b('events'),b('pending'),b('unknown'),b('unknownRate'),b('worstCase')]} rows={r.strategies.map((s,i)=>({key:String(i),cells:[s.name,f.number(s.events,0),f.number(s.pending,0),f.number(s.unknown,0),f.percent(s.unknownRate),pct(s.holdMeanIfUnknownTotalLoss)]}))}/></Section>
  <Section title={b('comparisons')}><DataTable caption={b('comparisons')} headers={[b('strategy'),b('method'),b('verdict'),b('difference'),b('interval'),b('note')]} rows={r.comparisons.flatMap((s,i)=>(['vsBaselineHold','vsBaselineRules'] as const).map(mode=>{const c=s[mode];return {key:`${i}-${mode}`,cells:[s.name,b(mode),b(`verdicts.${c.verdict}`),c.diff==null?t('unknown'):b('pp',{value:f.number(c.diff,2)}),c.ci?`${f.number(c.ci[0],2)} — ${f.number(c.ci[1],2)}`:t('unknown'),c.note??'—']};}))}/></Section>
  <Findings findings={r.findings} noConclusion={r.noConclusion}/>
 </div>;
}
