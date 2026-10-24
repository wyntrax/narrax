'use client';
import {useQuery} from '@tanstack/react-query';
import {useTranslations} from 'next-intl';
import {Activity,RefreshCw} from 'lucide-react';
import type {AdminApi} from './api';
import type {DataHealth} from './contracts';
import {DataTable,Facts,Loading,ResourceError,useFormat} from '@/features/research/ui';
import './data-health.css';
import {ResearchCoverage} from './research-coverage';
import {CollectorHealth} from './collector-health';

export function DataHealthCard({api,queryKey}:{api:AdminApi;queryKey:readonly unknown[]}){
 const t=useTranslations('workspace.dataHealth'),f=useFormat();
 const query=useQuery({queryKey,queryFn:()=>api.dataHealth(),retry:false,gcTime:0,refetchInterval:30000});
 return <section className="admin-card admin-wide data-health" aria-labelledby="data-health-title">
  <div className="health-heading"><div><h2 id="data-health-title"><Activity size={20} aria-hidden="true"/> {t('title')}</h2><p>{t('help')}</p></div><button className="research-control" disabled={query.isFetching} onClick={()=>void query.refetch()}><RefreshCw size={14} aria-hidden="true"/> {t('refresh')}</button></div>
  {query.isError&&<ResourceError error={query.error} retry={()=>void query.refetch()}/>}
  {query.isPending?<Loading/>:query.data&&<><p className="research-note">{t('checked',{at:f.date(query.data.checkedAt)})}{query.isError&&` · ${t('cached')}`}</p><HealthEvidence data={query.data}/></>}
 </section>;
}
export function HealthEvidence({data:d}:{data:DataHealth}){
 const t=useTranslations('workspace.dataHealth'),f=useFormat();
 const state=(value:boolean|null)=>t(value===null?'unknown':value?'configured':'notConfigured');
 const receipt=d.webhook.lastReceipt,sync=d.webhook.sync,w=d.wallets,m=d.market,a=d.analysis;
 const lastAnalysis=d.queues.find(q=>q.name==='ai-analysis')?.lastRun;
  return <>
   <CollectorHealth data={d}/>
  <div className="health-grid">
   <section aria-labelledby="health-webhook"><h3 id="health-webhook">{t('webhook')}</h3><Facts items={[{label:t('configuration'),value:state(d.webhook.configured)},{label:t('lastDelivery'),value:f.date(receipt?.at)},{label:t('lastSync'),value:f.date(sync?.at)},{label:t('providerActive'),value:sync?.active==null?t('unknown'):t(sync.active?'yes':'no')}]}/>{receipt&&<p>{t('receipt',{items:receipt.items,parsed:receipt.parsed,queued:receipt.queued,skipped:receipt.skipped})}</p>}<p className="research-note">{t('webhookNote')}</p></section>
   <section aria-labelledby="health-wallets"><h3 id="health-wallets">{t('wallets')}</h3><Facts items={[{label:t('tracked'),value:f.number(w.tracked,0)},{label:t('profiles'),value:f.number(w.profiles,0)},{label:t('withoutProfile'),value:f.number(w.withoutProfile,0)},{label:t('trades30d'),value:f.number(w.trades30d,0)},{label:t('lastTrade'),value:f.date(w.lastTradeAt)},{label:t('lastComputed'),value:f.date(w.lastComputedAt)}]}/><p className="research-note">{t('walletNote')}</p>{w.historyCapped>0&&<p>{t('historyCapped',{count:w.historyCapped})}</p>}{w.capped&&<p>{t('scanCapped',{scanned:w.scanned,total:w.tracked})}</p>}</section>
   <section aria-labelledby="health-market"><h3 id="health-market">{t('market')}</h3><Facts items={[{label:t('collection'),value:t(m.enabled?'enabled':'disabled')},{label:t('fresh'),value:f.number(m.fresh,0)},{label:t('stale'),value:f.number(m.stale,0)},{label:t('unverified'),value:f.number(m.unverified,0)},{label:t('lastMarket'),value:f.date(m.lastAt)},{label:t('missingNames'),value:f.number(m.unknownNames,0)}]}/><p className="research-note">{t('marketNote',{scanned:m.scanned,total:m.total})}</p>{m.capped&&<p>{t('scanCapped',{scanned:m.scanned,total:m.total})}</p>}</section>
   <section aria-labelledby="health-analysis"><h3 id="health-analysis">{t('analysis')}</h3><Facts items={[{label:t('analysisSwitch'),value:t(a.enabled?'enabled':'disabled')},{label:t('provider'),value:state(a.providerConfigured)},{label:t('models'),value:`${a.fastModel} / ${a.reasoningModel}`},{label:t('budget'),value:`${f.number(a.usedToday,0)} / ${f.number(a.budget,0)}`},{label:t('candidates'),value:f.number(a.recentCandidates,0)},{label:t('belowThreshold'),value:f.number(a.recentBelowThreshold,0)},{label:t('expired'),value:f.number(a.olderUnanalyzed,0)},{label:t('lastAnalysed'),value:f.number(lastAnalysis?.analyzed,0)},{label:t('providerFailures'),value:f.number(lastAnalysis?.providerFailures,0)}]}/>{lastAnalysis?.skipped&&<p>{t('runSkipped',{reason:lastAnalysis.skipped})}</p>}<p className="research-note">{t('analysisNote')}</p></section>
  </div>
  <ResearchCoverage data={d.coverage}/>
  <h3>{t('workers')}</h3><p className="research-note">{t('workerNote')}</p>
  <DataTable caption={t('workers')} headers={[t('queue'),t('status'),t('consumers'),t('waiting'),t('active'),t('failed'),t('lastComplete'),t('lastFailure')]} rows={d.queues.map(q=>({key:q.name,cells:[q.name,<span key="state" className="health-status" data-state={q.state}>{t(`states.${q.state}`)}</span>,q.counts?.consumers==null?t('unknown'):f.number(q.counts.consumers,0),f.number(q.counts?.waiting,0),f.number(q.counts?.active,0),f.number(q.counts?.failed,0),f.date(q.lastCompletedAt),f.date(q.lastFailedAt)]}))}/>
  <section className="health-explanations" aria-labelledby="health-explanations"><h3 id="health-explanations">{t('explanations')}</h3>{d.issues.length?<ul>{d.issues.map(code=><li key={code}>{t.has(`issues.${code}`)?t(`issues.${code}`):t('unknownIssue')}</li>)}</ul>:<p>{t('noIssues')}</p>}</section>
 </>;
}
