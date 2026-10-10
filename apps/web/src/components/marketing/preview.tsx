'use client';
import {useState} from 'react';
import {useTranslations} from 'next-intl';
import {Tabs, Badge} from '@/components/ui/primitives';
import data from './sample.json';
export default function Preview() {
  const t = useTranslations('landing'), c = useTranslations('common'); const [tab,setTab]=useState('narratives'),[selected,setSelected]=useState(0);
  const rows = data[tab as keyof typeof data], item = rows[selected] ?? rows[0]!;
  return <div className="preview"><div className="preview-bar"><span className="preview-dot"/><span>NARRA / {t('researchDesk')}</span><Badge>{c('sample')}</Badge></div><Tabs.Root value={tab} onValueChange={v=>{setTab(v);setSelected(0);}}><Tabs.List className="preview-tabs" aria-label={t('previewTabs')}>{Object.keys(data).map(k=><Tabs.Trigger key={k} value={k}>{t(k)}</Tabs.Trigger>)}</Tabs.List>{Object.keys(data).map(k=><Tabs.Content key={k} value={k}><div className="preview-grid"><div className="preview-ranking"><div className="preview-labels"><span>{t('ranking')}</span><span>{t('score')}</span></div>{rows.map((row,i)=><button key={row.name} className={i===selected?'selected':''} onClick={()=>setSelected(i)} onMouseEnter={()=>setSelected(i)} aria-pressed={i===selected}><span className="rank-number">0{i+1}</span><span>{row.name}<small>{t(i===0?'accelerating':'emerging')}</small></span><strong>{row.score}</strong></button>)}</div><div className="preview-chart"><div><span className="muted">{item.name}</span><Badge>{c('sample')}</Badge></div><p className="metric">{item.score}<span>/ 100</span></p><svg viewBox="0 0 440 160" role="img" aria-label={t('chartLabel',{name:item.name})}><path className="chart-grid" d="M0 40H440M0 80H440M0 120H440"/><polyline className="chart-line" points={item.values.map((v,i)=>`${i*44},${150-v*1.4}`).join(' ')}/></svg><p className="preview-caption">{t('sampleNote')}</p></div></div></Tabs.Content>)}</Tabs.Root></div>;
}
