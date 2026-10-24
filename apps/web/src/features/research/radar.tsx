'use client';
import {useState} from 'react';
import {useTranslations} from 'next-intl';
import {Link} from '@/i18n/navigation';
import {useResearch,useResearchQuery,hasFeature} from './session';
import {NarrativesSchema,RotationSchema,stages,type Narrative} from './contracts';
import {pagePath} from './api';
import {usePagination} from './pagination';
import {PageHeading,Section,Loading,ResourceError,Locked,Empty,Pager,DataTable,Facts,Stamp,useFormat} from './ui';
export function RadarPage(){const t=useTranslations('workspace'),[stage,setStage]=useState('');return <><PageHeading title={t('radarTitle')} body={t('radarBody')}/><div className="research-filters"><label>{t('filterStage')}<select value={stage} onChange={e=>setStage(e.target.value)}><option value="">{t('allStages')}</option>{stages.map(s=><option key={s} value={s}>{t(`stages.${s}`)}</option>)}</select></label></div><RadarResults key={stage} stage={stage}/><RotationPanel/></>;}
function RadarResults({stage}:{stage:string}){
 const t=useTranslations('workspace'),f=useFormat(),{access}=useResearch(),paging=usePagination(),[selected,setSelected]=useState<string>();
 const allowed=hasFeature(access,'research.narratives');
 const query=useResearchQuery(pagePath('narratives',stage?{stage}:{},paging.cursor),NarrativesSchema,allowed);
 if(!allowed)return <Locked tier={access.features['research.narratives']?.requiredTier}/>;
 if(query.isError)return <ResourceError error={query.error} retry={()=>void query.refetch()}/>;
 if(query.isPending)return <Loading/>;
 const rows=query.data.items,current=rows.find(n=>n.slug===selected)??rows[0];
 return <>{current?<div className="radar-composition"><RadarPlot rows={rows} selected={current.slug} select={setSelected}/><div className="radar-detail"><p className="research-note">{t('selected')}</p><h2>{current.name}</h2><Facts items={[{label:t('stage'),value:t(`stages.${current.stage}`)},{label:t('score'),value:f.number(current.score)},{label:t('velocity'),value:f.number(current.velocity)},{label:t('organic'),value:f.number(current.organicScore)}]}/><Stamp at={current.updatedAt}/><Link href={`/app/narratives/${encodeURIComponent(current.slug)}`} className="research-control">{t('openNarrative')} ↗</Link></div></div>:<Empty/>}
 <Section title={t('ranking')}><DataTable caption={t('ranking')} headers={[t('name'),t('stage'),t('score'),t('velocity'),t('organic'),t('saturation'),t('tokenCount')]} rows={rows.map(n=>({key:n.id,cells:[<Link key="name" href={`/app/narratives/${encodeURIComponent(n.slug)}`}>{n.name}</Link>,t(`stages.${n.stage}`),f.number(n.score),f.number(n.velocity),f.number(n.organicScore),f.number(n.saturationRisk),f.number(n.tokenCount,0)]}))}/></Section>
 <Pager page={paging.page} previous={paging.previous} next={()=>paging.next(query.data.nextCursor)} canNext={!!query.data.nextCursor}/></>;
}
function RadarPlot({rows,selected,select}:{rows:Narrative[];selected:string;select:(slug:string)=>void}){const t=useTranslations('workspace');return <figure className="radar-figure"><div className="radar-plot"><svg viewBox="0 0 760 370" role="group" aria-label={t('radarChart')}>
 {[0,25,50,75,100].map(value=><g key={value}><path className="research-gridline" d={`M45 ${310-value*2.6}H735`}/><text x={4} y={315-value*2.6}>{value}</text></g>)}
 {stages.map((stage,i)=><g key={stage}><path className="research-gridline" d={`M${75+i*105} 40V310`}/><text x={75+i*105} y={342} textAnchor="middle">{t(`stages.${stage}`)}</text></g>)}
 {rows.map((n,i)=>{const x=75+stages.indexOf(n.stage)*105+(i%3-1)*10,y=310-Math.min(100,Math.max(0,n.score))*2.6;return <g key={n.id} role="button" tabIndex={0} aria-label={`${n.name}: ${t('score')} ${n.score}, ${t(`stages.${n.stage}`)}`} aria-pressed={selected===n.slug} onClick={()=>select(n.slug)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select(n.slug);}}} className={`radar-point ${selected===n.slug?'selected':''}`}><circle cx={x} cy={y} r={12}/><title>{n.name}</title></g>;})}
 </svg></div><figcaption>{t('radarNote')}</figcaption></figure>;}
function RotationPanel(){
 const t=useTranslations('workspace'),f=useFormat(),[window,setWindow]=useState('24h'),{access}=useResearch(),allowed=hasFeature(access,'research.rotation');
 const query=useResearchQuery(`narratives/rotation?window=${window}`,RotationSchema,allowed);
 return <Section title={t('rotation')} action={<label className="compact-label">{t('window')}<select value={window} onChange={e=>setWindow(e.target.value)}>{['1h','6h','24h','7d'].map(value=><option key={value}>{value}</option>)}</select></label>}>{!allowed?<Locked tier={access.features['research.rotation']?.requiredTier}/>:query.isError?<ResourceError error={query.error} retry={()=>void query.refetch()}/>:query.isPending?<Loading/>:<><Stamp at={query.data.asOf}/><div className="research-columns">{(['rising','falling'] as const).map(direction=><div key={direction}><h3>{t(direction)}</h3>{query.data[direction].map(n=><p key={n.id}><Link href={`/app/narratives/${encodeURIComponent(n.slug)}`}>{n.name}</Link> {f.number(n.from)} → {f.number(n.to)}</p>)}</div>)}</div>{!query.data.detected&&<p>{t('noRotation')}</p>}<p className="research-note">{t('unknownRotation',{count:query.data.unknown})} {t('rotationNote')}</p></>}</Section>;
}
