'use client';
import {useTranslations} from 'next-intl';
import type {DataHealth} from './contracts';
import {DataTable,Facts,useFormat} from '@/features/research/ui';

export function ResearchCoverage({data}:{data:DataHealth['coverage']}){
 const t=useTranslations('workspace.coverage'),f=useFormat();
 return <section className="health-explanations" aria-labelledby="research-coverage-title">
  <h3 id="research-coverage-title">{t('title')}</h3><p className="research-note">{t('help')}</p>
  {!data?<p>{t('unknown')}</p>:<>
   <p>{t('scope',{scanned:data.scanned,total:data.total})}{data.capped&&` · ${t('capped')}`}</p>
   <Facts items={[{label:t('paired'),value:f.number(data.freshPriceAndHolders,0)},{label:t('priority'),value:f.number(data.socialPriorityCount,0)},{label:t('published'),value:f.number(data.calls.published24h,0)},{label:t('unknownEntry'),value:f.number(data.calls.unknownEntry24h,0)}]}/>
   <DataTable caption={t('freshness')} headers={[t('source'),t('fresh'),t('stale'),t('missing'),t('future'),t('unverified')]} rows={(['price','holders','risk'] as const).map(key=>({key,cells:[t(key),...(['fresh','stale','missing','future'] as const).map(state=>f.number(data[key][state],0)),key==='price'?f.number(data.price.unverified,0):'—']}))}/>
   <p className="research-note">{t('limits')}</p>
   <DataTable caption={t('runs')} headers={[t('stage'),t('state'),t('last'),t('dailyRuns')]} rows={data.stages.map(s=>({key:s.stage,cells:[t(s.stage),t(s.stale?'staleRun':'recent'),f.date(s.latest?.at),s.today?f.number(s.today.runs,0):t('unknown')]}))}/>
   {data.stages.map(s=><details key={s.stage}><summary>{t('counters',{stage:t(s.stage)})}</summary>{!s.today?<p>{t('unknown')}</p>:<Facts items={Object.entries(s.today.counters).map(([key,value])=>({label:key,value:f.number(value,0)}))}/>}</details>)}
   <p className="research-note">{t('counterNote')}</p>
  </>}
 </section>;
}
