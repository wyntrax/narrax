'use client';
import {TokenIdentity} from './token-identity';
import {useState} from 'react';
import {useLocale,useTranslations} from 'next-intl';
import {Link} from '@/i18n/navigation';
import {useResearchQuery} from './session';
import {FlowPageSchema,EmergingSchema,type Qualification} from './wallet-research-contracts';
import {DataTable,Empty,Loading,Metrics,ResourceError,Pager,useFormat} from './ui';
import {usePagination} from './pagination';
import {pagePath} from './api';

export function QualificationBadge({value}:{value:Qualification|null|undefined}){
 const t=useTranslations('workspace.smartResearch'),f=useFormat();
 return <div><b>{t(value?.status??'PROVISIONAL')}</b>{value?.sample&&<small>{t('sample',{closes:f.number(value.sample.closedTrades,0),tokens:f.number(value.sample.closedTokens,0),days:f.number(value.sample.observedDays,1)})}</small>}{!!value?.reasons.length&&<details><summary>{t('reasons')}</summary><ul>{value.reasons.map(code=><li key={code}>{t.has(`issues.${code}`)?t(`issues.${code}`):code}</li>)}</ul></details>}</div>;
}

export function WalletResearchViews(){
 const t=useTranslations('workspace.smartResearch'),[view,setView]=useState<'flows'|'emerging'|null>(null);
  return <section><h2>{t('title')}</h2><p className="research-note">{t('help')}</p><div className="research-filters"><button type="button" className="research-control" aria-expanded={view==='flows'} onClick={()=>setView(view==='flows'?null:'flows')}>{t('flows')}</button><button type="button" className="research-control" aria-expanded={view==='emerging'} onClick={()=>setView(view==='emerging'?null:'emerging')}>{t('emerging')}</button></div>{view==='flows'&&<WalletFlows/>}{view==='emerging'&&<EmergingWallets/>}</section>;
}
const MIN_FLOW_LIQUIDITY_USD = 20_000; // Matches WALLET_FLOW_LIMITS.minLiquidityUsd.
const MAX_FLOW_TOP10_PCT = 80; // Matches WALLET_FLOW_LIMITS.maxTop10Pct.

export function WalletFlows(){
 const id=useLocale()==='id',t=useTranslations('workspace.smartResearch'),f=useFormat(),paging=usePagination(),[includeFiltered,setIncludeFiltered]=useState(false);
 const query=useResearchQuery(pagePath('smart-money/flows',includeFiltered?{includeFiltered:'true'}:{},paging.cursor),FlowPageSchema,true,30000);
 const isLowQuality=(s:NonNullable<typeof query.data>['items'][number])=>{
  if(s.currentLiquidityUsd!=null&&Number(s.currentLiquidityUsd)<MIN_FLOW_LIQUIDITY_USD)return true;
  if(s.entryTop10Pct!=null&&s.entryTop10Pct>MAX_FLOW_TOP10_PCT)return true;
  const settled=s.measurements.filter(m=>m.status!=='PENDING');
  return settled.length>0&&settled.every(m=>m.status==='UNKNOWN'&&m.reason==='THIN_LIQUIDITY');
 };
 const rawItems=query.data?.items??[];
 const items=includeFiltered?rawItems:rawItems.filter(s=>!isLowQuality(s));
 const hiddenCount=query.data?.filteredCount??rawItems.filter(isLowQuality).length;
 const meta=query.data?.walletMeta??{},track=query.data?.trackRecord??[];
 return <>{query.isError?<ResourceError error={query.error} retry={()=>void query.refetch()}/>:query.isPending?<Loading/>:<>
  <div className="research-filters"><p className="research-note">{t('qualityNote')}</p>{(hiddenCount>0||includeFiltered)&&<button type="button" className="research-control" aria-pressed={includeFiltered} onClick={()=>setIncludeFiltered(!includeFiltered)}>{includeFiltered?t('hideFiltered'):t('showFiltered')}</button>}</div>
  {!includeFiltered&&hiddenCount>0&&<p className="research-note">{t('filteredHidden',{count:hiddenCount})}</p>}
  {track.length>0&&<Metrics items={track.map(h=>({label:id?`Rekam jejak ${h.horizonHours}j`:`${h.horizonHours}h track record`,value:h.measured>0?`${f.percent(h.hitRate)} hit · ${f.number(h.medianReturnPct,1)}% (${h.measured}/${h.total})`:id?`0/${h.total} terukur`:`0/${h.total} measured`}))}/>}
  {!items.length?<Empty body={t('noFlows')}/>:<><p>{t('outcomeNote')}</p><DataTable caption={t('flows')} headers={[t('time'),t('token'),t('direction'),t('entities'),t('netSol'),t('evidence'),t('outcomes')]} rows={items.map(s=>({key:s.id,cells:[<span key="at">{f.date(s.createdAt)}{s.stale&&<small>{t('stale')}</small>}</span>,<Link key="token" href={`/app/tokens/${encodeURIComponent(s.token.mint)}`}><TokenIdentity {...s.token}/></Link>,t(s.side),f.number(s.independentEntities,0),f.number(s.netFlowSol,4),<details key="evidence"><summary>{t('transactions',{count:s.evidence.trades.length})}</summary><ul>{s.evidence.trades.map(trade=>{const info=meta[trade.wallet];return <li key={trade.id}><Link href={`/app/smart-money/${encodeURIComponent(trade.wallet)}`}>{info?.label??`${trade.wallet.slice(0,6)}…`}</Link>{info?.score!=null&&` (${f.number(info.score,0)}${info.style?` · ${info.style}`:''})`} · {trade.side} · {f.number(trade.amountSol,4)} SOL · {f.date(trade.at)} {(/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(trade.signature))&&<a href={`https://solscan.io/tx/${encodeURIComponent(trade.signature)}`} target="_blank" rel="noopener noreferrer">Solscan ↗</a>}</li>;})}</ul></details>,<ul key="outcomes">{s.measurements.map(m=><li key={m.horizonHours}>{m.horizonHours}h: {m.status==='MEASURED'?`${f.number(m.returnPct,2)}%`:t(m.status)}</li>)}{(s.currentLiquidityUsd!=null&&Number(s.currentLiquidityUsd)<MIN_FLOW_LIQUIDITY_USD)&&<li className="research-notice">{t('illiquid')}</li>}{(s.entryTop10Pct!=null&&s.entryTop10Pct>MAX_FLOW_TOP10_PCT)&&<li className="research-notice">{t('concentrated')}</li>}</ul>]}))}/></>}
 </>}
 <Pager page={paging.page} previous={paging.previous} next={()=>paging.next(query.data?.nextCursor??null)} canNext={!query.isFetching&&!query.isError&&!!query.data?.nextCursor}/></>;
}
export function EmergingWallets(){
 const t=useTranslations('workspace.smartResearch'),f=useFormat(),query=useResearchQuery('smart-money/emerging',EmergingSchema,true,60000);
 if(query.isError)return <ResourceError error={query.error} retry={()=>void query.refetch()}/>;
 if(query.isPending)return <Loading/>;
 const s=query.data.snapshot;
 return <><p>{t('emergingNote')}</p>{!s?<Empty body={t('noEmerging')}/>:<><p>{f.date(s.checkedAt)} · {(s.stale)?t('stale'):t('recorded')}{s.capped&&` · ${t('capped')}`}</p><DataTable caption={t('emerging')} headers={[t('wallet'),t('scannedTokens')]} rows={s.items.map(w=>({key:w.address,cells:[<span key="wallet"><Link href={`/app/smart-money/${encodeURIComponent(w.address)}`}>{w.address}</Link> <a href={`https://solscan.io/account/${encodeURIComponent(w.address)}`} target="_blank" rel="noopener noreferrer">Solscan ↗</a></span>,f.number(w.scannedTokens,0)]}))}/></>}</>;
}
