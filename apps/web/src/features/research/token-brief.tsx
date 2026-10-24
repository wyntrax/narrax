'use client';
import {useEffect,useState} from 'react';
import {useTranslations} from 'next-intl';
import type {Token} from './contracts';
import {Facts,Metrics,Section,useFormat} from './ui';

// Matches the API's source-linked observation window, not signal quality.
export const TOKEN_MARKET_MAX_AGE_MS=15*60*1000;
/** Display a past observation without certifying that it describes the current market. */
export function observedTokenMetrics(token:Token,now=Date.now()){
 const o=token.observation,m=token.metrics;
 if(!o||!m)return null;
 const at=Date.parse(o.at),metricAt=Date.parse(m.at);
 return Number.isFinite(at)&&at===metricAt&&at<=now?m:null;
}
export function tokenMarketState(token:Token,now:number):'missing'|'stale'|'fresh'{
 const o=token.observation;
 if(!o||!token.metrics)return 'missing';
 const at=Date.parse(o.at),metricAt=Date.parse(token.metrics.at);
 if(o.stale||!Number.isFinite(at)||!Number.isFinite(metricAt)||at!==metricAt||at>now||metricAt>now||now-at>TOKEN_MARKET_MAX_AGE_MS||now-metricAt>TOKEN_MARKET_MAX_AGE_MS)return 'stale';
 return 'fresh';
}
export function useTokenMarketState(token?:Token){
 const [now,setNow]=useState(()=>Date.now());
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),15000);return ()=>clearInterval(timer);},[]);
 return token?tokenMarketState(token,Math.max(now,Date.now())):'missing';
}

export function TokenBrief({token,state}:{token:Token;state:ReturnType<typeof tokenMarketState>}){
 const t=useTranslations('workspace.brief'),w=useTranslations('workspace'),f=useFormat();
 const o=token.observation,m=state==='fresh'?token.metrics:null;
 const change=m?o?.priceChange1hPct:null;
 const turnover=m&&m.liquidityUsd!=null&&m.liquidityUsd>0&&m.volume24hUsd!=null&&m.volume24hUsd>=0?m.volume24hUsd/m.liquidityUsd:null;
 return <Section title={t('title')}>
  <div className="token-brief-status" role="status"><strong>{t(`states.${state}`)}</strong><span>{t(`stateHelp.${state}`)}</span></div>
  <Metrics items={[{label:w('trench.change1h'),value:change==null?t('needsFresh'):`${change>0?'+':''}${f.number(change,2)}%`},{label:w('trench.turnover'),value:turnover==null?t('needsFresh'):`${f.number(turnover,2)}×`},{label:t('network'),value:'Solana'}]}/>
  <p className="research-note">{w('trench.turnoverNote')}</p>
  <Facts items={[{label:t('marketAt'),value:f.date(o?.at)},{label:w('trench.poolCreated'),value:f.date(o?.pairCreatedAt)},{label:t('tokenCreated'),value:f.date(token.createdOnChainAt)}]}/>
  <p className="research-note">{t('timingNote')}</p>
  <h3>{t('coverage')}</h3>
  <ul className="token-evidence-list">
   <li><strong>{w('holders')}</strong><span>{token.holders?t('storedAt',{at:f.date(token.holders.at)}):t('holdersMissing')}</span></li>
   <li><strong>{w('riskFlags')}</strong><span>{token.risk?t('storedAt',{at:f.date(token.risk.at)}):t('riskMissing')}</span></li>
   <li><strong>{w('enhance.issuerHolding')}</strong><span>{token.developerHolding?t('storedAt',{at:f.date(token.developerHolding.at)}):t('issuerMissing')}</span></li>
   <li><strong>{w('relatedNarratives')}</strong><span>{token.narratives.length?t('narrativeCount',{count:token.narratives.length}):t('narrativesMissing')}</span></li>
  </ul>
  <p className="research-note">{t('coverageNote')}</p>
  <div className="market-links"><a className="research-control" href="#token-narratives">{t('inspectNarratives')}</a><a className="research-control" href="#token-history" onClick={()=>{const history=document.getElementById('token-history');if(history instanceof HTMLDetailsElement){history.open=true;history.querySelector('summary')?.focus();}}}>{t('inspectSnapshots')}</a></div>
 </Section>;
}
