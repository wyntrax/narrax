'use client';
import {useState,useId} from 'react';
import {useTranslations} from 'next-intl';
import {Clock3,Activity,ShieldCheck,Wallet} from 'lucide-react';
import {TokenHistorySchema,type Token,type PricePoint} from './contracts';
import {useResearchQuery} from './session';
import {Loading,ResourceError,useFormat} from './ui';
import {priceGeometry} from './price-geometry';
import {useTokenMarketState} from './token-brief';

export default function TokenPricePanel({token}:{token:Token}){
 const t=useTranslations('workspace'),[window,setWindow]=useState<'1h'|'24h'|'7d'>('24h');
 const query=useResearchQuery(`tokens/${encodeURIComponent(token.mint)}/history?window=${window}`,TokenHistorySchema,true,60000);
  const marketState=useTokenMarketState(token);
  const current=marketState==='fresh'&&token.observation&&token.metrics?{at:token.metrics.at,priceUsd:token.metrics.priceUsd,source:'dexscreener' as const,pairAddress:token.observation.pairAddress}:null;
 const fallback:PricePoint[]=current&&current.priceUsd!=null&&current.priceUsd>0?[{...current,priceUsd:current.priceUsd}]:[];
 const points=query.data?.points??fallback;
 return <div className="token-market-panel">
  <div className="price-panel-toolbar"><div role="group" aria-label={t('enhance.priceWindow')}>{(['1h','24h','7d'] as const).map(range=><button key={range} className="research-control" aria-pressed={window===range} onClick={()=>setWindow(range)}>{range.toUpperCase()}</button>)}</div><button className="research-control" disabled={query.isFetching} onClick={()=>void query.refetch()}>{t('refresh')}</button></div>
  {query.isError&&<ResourceError error={query.error} retry={()=>void query.refetch()}/>}
  {query.isPending?<Loading/>:<PriceHistoryChart key={window} points={points}/>}
  <p className="research-note">{t('enhance.priceCoverage')}{query.data?.truncated&&` ${t('enhance.priceCapped')}`}</p>
  {!!query.data?.excludedUnverified&&<p className="research-note">{t('enhance.priceExcluded',{count:query.data.excludedUnverified})}</p>}
  <TokenEvents token={token} points={points}/>
 </div>;
}

export function PriceHistoryChart({points}:{points:PricePoint[]}){
 const t=useTranslations('workspace'),f=useFormat(),id=useId(),[selected,setSelected]=useState<number|null>(null);
 const geometry=priceGeometry(points),sample=geometry.samples[Math.min(selected??points.length-1,points.length-1)];
 const first=points[0],last=points[points.length-1],change=first&&last?(last.priceUsd/first.priceUsd-1)*100:null;
 if(!sample)return <div className="price-empty" role="status"><Activity size={28} aria-hidden="true"/><p>{t('enhance.noPriceHistory')}</p></div>;
 return <figure className="token-chart price-history-chart">
  <div className="price-chart-summary"><div><span>{t('enhance.observationPrice')}</span><strong>{f.usd(sample.priceUsd)}</strong><time dateTime={sample.at}>{f.date(sample.at)}</time></div><div><span>{t('enhance.observedChange')}</span><strong className={change!=null&&change<0?'price-down':'price-up'}>{points.length>1?`${change!>=0?'+':''}${f.number(change,2)}%`:'—'}</strong><small>{t('enhance.priceSamples',{count:points.length})}</small></div></div>
  <svg viewBox="0 0 720 260" role="img" aria-label={t('enhance.priceChartLabel',{count:points.length})} onPointerMove={event=>{const rect=event.currentTarget.getBoundingClientRect();if(!rect.width)return;const x=(event.clientX-rect.left)/rect.width*720;let closest=0;geometry.samples.forEach((p,index)=>{if(Math.abs(p.x-x)<Math.abs(geometry.samples[closest]!.x-x))closest=index;});setSelected(closest);}} onPointerLeave={()=>setSelected(null)}>
   {[0,.5,1].map(fraction=>{const y=210-fraction*180;return <g key={fraction}><path className="research-gridline" d={`M90 ${y}H680`}/><text x="78" y={y+4} textAnchor="end">{f.usd(geometry.low+fraction*(geometry.high-geometry.low))}</text></g>;})}
   {geometry.segments.map((segment,index)=>segment.length>1?<polyline key={index} className="price-line" points={segment.map(p=>`${p.x},${p.y}`).join(' ')}/>:<circle key={index} cx={segment[0]!.x} cy={segment[0]!.y} r="4" className="snapshot-point"/>)}
   <path className="price-crosshair" d={`M${sample.x} 25V215`}/><circle className="snapshot-point" cx={sample.x} cy={sample.y} r="5"/>
   <text x="90" y="244">{f.date(first!.at)}</text>{points.length>1&&<text x="680" y="244" textAnchor="end">{f.date(last!.at)}</text>}
  </svg>
  {points.length>1&&<div className="price-scrubber"><label htmlFor={id}>{t('enhance.inspectObservation')}</label><input id={id} type="range" min={0} max={points.length-1} value={selected??points.length-1} onChange={event=>setSelected(Number(event.target.value))} aria-valuetext={`${f.date(sample.at)} · ${f.usd(sample.priceUsd)}`}/></div>}
  <figcaption>{points.length===1?t('chartSingle'):t('enhance.priceLineNote')}</figcaption>
 </figure>;
}

function TokenEvents({token,points}:{token:Token;points:PricePoint[]}){
 const t=useTranslations('workspace'),f=useFormat();
 const events:{key:string;at:string;label:string;detail:string;Icon:typeof Clock3}[]=points.slice(-5).map((point,index)=>({key:`price-${index}`,at:point.at,label:t('enhance.priceObserved'),detail:`${f.usd(point.priceUsd)} · DEX Screener`,Icon:Activity}));
 if(token.observation?.pairCreatedAt)events.push({key:'pool',at:token.observation.pairCreatedAt,label:t('trench.poolCreated'),detail:token.observation.dexId??'DEX Screener',Icon:Clock3});
 if(token.risk)events.push({key:'risk',at:token.risk.at,label:t('enhance.riskObserved'),detail:`${t('risk')}: ${f.number(token.risk.riskScore)} · ${token.risk.flags.length?token.risk.flags.join(' · '):t('noFlags')}`,Icon:ShieldCheck});
 if(token.developerHolding)events.push({key:'holding',at:token.developerHolding.at,label:t('enhance.issuerHolding'),detail:`${f.number(token.developerHolding.holdingPct,4)}%`,Icon:Wallet});
 events.sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
 return <div className="token-observation-events"><h3>{t('events')}</h3><p className="research-note">{t('enhance.eventCoverage')}</p>{events.length?<ol>{events.map(({key,at,label,detail,Icon})=><li key={key}><span className="event-icon"><Icon size={17} aria-hidden="true"/></span><div><strong>{label}</strong><p>{detail}</p><time dateTime={at}>{f.date(at)}</time></div></li>)}</ol>:<p>{t('enhance.noObservedEvents')}</p>}</div>;
}
