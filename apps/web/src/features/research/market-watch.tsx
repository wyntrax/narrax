'use client';
import {useState} from 'react';
import {useTranslations} from 'next-intl';
import {RefreshCw} from 'lucide-react';
import {Link} from '@/i18n/navigation';
import {useResearch,useResearchQuery,hasFeature} from './session';
import {TokensSchema} from './contracts';
import {pagePath} from './api';
import {usePagination} from './pagination';
import {DataTable,Empty,Loading,Locked,Pager,ResourceError,useFormat} from './ui';
import {TOKEN_MARKET_MAX_AGE_MS} from './token-brief';
import {TokenIdentity} from './token-identity';
import './research-pages.css';

export function MarketWatch({search=''}:{search?:string}){
 const t=useTranslations('workspace.trench'),e=useTranslations('workspace.enhance'),[mode,setMode]=useState('liquidity'),[cap,setCap]=useState('all'),{access}=useResearch(),screener=hasFeature(access,'research.screener'),effectiveMode=screener?mode:'all',effectiveCap=screener?cap:'all';
 return <>
  {screener&&<>
   <div className="tokens-screener-bar">
    <div className="research-filters market-tabs" role="group" aria-label={t('scanMode')}>
     {['liquidity','newPools','volume'].map(key=><button key={key} className="research-control" aria-pressed={mode===key} onClick={()=>setMode(key)}>{t(key)}</button>)}
    </div>
    <div className="research-filters token-screen-controls">
     <label>{e('capRange')}<select value={cap} onChange={event=>setCap(event.target.value)}>{Object.keys(CAP_RANGES).map(key=><option key={key} value={key}>{e(`caps.${key}`)}</option>)}</select></label>
     <label>{e('marketSort')}<select value={mode} onChange={event=>setMode(event.target.value)}><option value="capAsc">{e('capAsc')}</option><option value="capDesc">{e('capDesc')}</option><option value="liquidity">{t('liquidity')}</option><option value="volume">{t('volume')}</option><option value="newPools">{t('newPools')}</option></select></label>
     {(cap!=='all'||mode!=='liquidity')&&<button className="research-control" onClick={()=>{setCap('all');setMode('liquidity');}}>{e('resetFilters')}</button>}
    </div>
   </div>
   {cap!=='all'&&<p className="research-note">{e('capBasis')}</p>}
  </>}
  <p className="research-note">{t('coverage')}</p>
  <MarketRows key={`${effectiveMode}:${effectiveCap}:${search}`} mode={effectiveMode} cap={effectiveCap} search={search}/>
 </>;
}

const CAP_RANGES:Record<string,{min?:string;max?:string}>={all:{},micro:{min:'5000',max:'50000'},small:{min:'50000',max:'100000'},growing:{min:'100000',max:'500000'},mid:{min:'500000',max:'1000000'},large:{min:'1000000',max:'10000000'},major:{min:'10000000'}};

function MarketRows({mode,search,cap}:{mode:string;search:string;cap:string}){
 const t=useTranslations('workspace.trench'),w=useTranslations('workspace'),f=useFormat(),{access}=useResearch(),paging=usePagination(),feature=mode==='all'?'research.tokens':'research.screener',allowed=hasFeature(access,feature);
 const range=CAP_RANGES[cap]!;
 const filters={verifiedOnly:'true',sort:mode==='all'?'symbol':mode.startsWith('cap')?'marketCap':mode==='newPools'?'age':mode==='volume'?'volume24h':'liquidity',...(mode.startsWith('cap')?{order:mode==='capAsc'?'asc':'desc'}:{}),...(cap!=='all'?{marketCapOnly:'true',...(range.min?{minMarketCapUsd:range.min}:{}),...(range.max?{maxMarketCapUsd:range.max}:{})}:{}),...(mode==='newPools'?{maxAgeMinutes:'1440'}:{}),...(search?{q:search}:{})};
 const query=useResearchQuery(pagePath('tokens',filters,paging.cursor),TokensSchema,allowed,60000);
 if(!allowed)return <Locked tier={access.features[feature]?.requiredTier}/>;
 if(query.isError)return <ResourceError error={query.error} retry={()=>void query.refetch()}/>;
 if(query.isPending)return <Loading/>;
 return <>
  <div className="market-results-bar">
   <span>{t('sample',{count:query.data.items.length})}</span>
   <button className="research-control rp-refresh" onClick={()=>void query.refetch()} disabled={query.isFetching}>
    <RefreshCw size={14} className={query.isFetching?'rp-spin':undefined} aria-hidden="true"/>
    {w('refresh')}
   </button>
  </div>
  {query.data.items.length?<DataTable
   rowHref={mint=>`/app/tokens/${encodeURIComponent(mint)}`}
   caption={t('marketScan')}
   headers={[w('token'),w('price'),t('valuation'),w('liquidity'),w('volume'),t('change1h'),t('turnover'),t('poolCreated'),t('source')]}
   rows={query.data.items.map(token=>{
    const o=token.observation,at=o?Date.parse(o.at):NaN,observable=!!o&&Number.isFinite(at)&&at<=Date.now(),fresh=observable&&!o.stale&&Date.now()-at<=TOKEN_MARKET_MAX_AGE_MS,liq=token.liquidityUsd,volume=token.volume24hUsd;
    const chg=observable?o.priceChange1hPct:null;
    const chgTone=chg==null?'muted':chg>0?'pos':chg<0?'neg':'flat';
    return {
     key:token.mint,
     cells:[
      <Link key="token" href={`/app/tokens/${encodeURIComponent(token.mint)}`}><TokenIdentity symbol={token.symbol} name={token.name} imageUrl={token.imageUrl}/></Link>,
      observable?<span key="price" className="rp-num">{f.usd(token.priceUsd)}{!fresh&&<small>{t('lastObserved')}</small>}</span>:<span key="price" className="rp-num rp-num-muted">{t('unverified')}</span>,
      observable?<span key="cap" className="rp-num">{f.usd(token.marketCapUsd)}<small>{t(o.marketCapIsFdv?'fdv':'marketCap')}</small></span>:<span key="cap" className="rp-num rp-num-muted">{w('unknown')}</span>,
      <span key="liq" className="rp-num">{observable?f.usd(liq):w('unknown')}</span>,
      <span key="vol" className="rp-num">{observable?f.usd(volume):w('unknown')}</span>,
      <span key="chg" className={`rp-num rp-num-${chgTone}`}>{chg!=null?`${f.number(chg,2)}%`:w('unknown')}</span>,
      <span key="turn" className="rp-num">{observable&&liq!=null&&liq>0&&volume!=null?`${f.number(volume/liq,2)}×`:w('unknown')}</span>,
      <span key="age" className="rp-num rp-num-muted">{observable?f.date(o.pairCreatedAt):w('unknown')}</span>,
      observable?<span key="source" className="tokens-source-cell"><a href={`https://dexscreener.com/solana/${encodeURIComponent(o.pairAddress)}`} target="_blank" rel="noopener noreferrer">{o.dexId??'DEX Screener'} ↗</a><small>{f.date(o.at)} · <span className={`rp-pill ${fresh?'rp-pill-pos':'rp-pill-warn'}`}>{t(fresh?'snapshot':'stale')}</span></small></span>:<span key="source" className="rp-num rp-num-muted">{t('unverified')}</span>,
     ],
    };
   })}
  />:<Empty body={t('noMarket')}/>}
  <p className="research-note">{t('turnoverNote')}</p>
  <Pager page={paging.page} previous={paging.previous} next={()=>paging.next(query.data?.nextCursor??null)} canNext={!query.isFetching&&!!query.data.nextCursor}/>
 </>;
}
