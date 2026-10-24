'use client';
import {TokenIdentity} from './token-identity';
import {useState} from 'react';
import {useTranslations} from 'next-intl';
import {Link} from '@/i18n/navigation';
import {useResearchQuery} from './session';
import {FlowPageSchema,EmergingSchema,type Qualification} from './wallet-research-contracts';
import {DataTable,Empty,Loading,ResourceError,Pager,useFormat} from './ui';
import {usePagination} from './pagination';
import {pagePath} from './api';

export function QualificationBadge({value}:{value:Qualification|null|undefined}){
 const t=useTranslations('workspace.smartResearch'),f=useFormat();
 return <div><b>{t(value?.status??'PROVISIONAL')}</b>{value?.sample&&<small>{t('sample',{closes:f.number(value.sample.closedTrades,0),tokens:f.number(value.sample.closedTokens,0),days:f.number(value.sample.observedDays,1)})}</small>}{!!value?.reasons.length&&<details><summary>{t('reasons')}</summary><ul>{value.reasons.map(code=><li key={code}>{t.has(`issues.${code}`)?t(`issues.${code}`):code}</li>)}</ul></details>}</div>;
}

export function WalletResearchViews(){
 const t=useTranslations('workspace.smartResearch'),[view,setView]=useState<'flows'|'emerging'|null>(null);
 return <section><h2>{t('title')}</h2><p className="research-note">{t('help')}</p><div className="research-filters"><button type="button" className="research-control" aria-expanded={view==='flows'} onClick={()=>setView(view==='flows'?null:'flows')}>{t('flows')}</button><button type="button" className="research-control" aria-expanded={view==='emerging'} onClick={()=>setView(view==='emerging'?null:'emerging')}>{t('emerging')}</button></div>{view==='flows'&&<Flows/>}{view==='emerging'&&<Emerging/>}</section>;
}
function Flows(){
 const t=useTranslations('workspace.smartResearch'),f=useFormat(),paging=usePagination();
 const query=useResearchQuery(pagePath('smart-money/flows',{},paging.cursor),FlowPageSchema,true,30000);
 return <>{query.isError?<ResourceError error={query.error} retry={()=>void query.refetch()}/>:query.isPending?<Loading/>:!query.data.items.length?<Empty body={t('noFlows')}/>:<><p>{t('outcomeNote')}</p><DataTable caption={t('flows')} headers={[t('time'),t('token'),t('direction'),t('entities'),t('netSol'),t('evidence'),t('outcomes')]} rows={query.data.items.map(s=>({key:s.id,cells:[<span key="at">{f.date(s.createdAt)}{s.stale&&<small>{t('stale')}</small>}</span>,<Link key="token" href={`/app/tokens/${encodeURIComponent(s.token.mint)}`}><TokenIdentity {...s.token}/></Link>,t(s.side),f.number(s.independentEntities,0),f.number(s.netFlowSol,4),<details key="evidence"><summary>{t('transactions',{count:s.evidence.trades.length})}</summary><ul>{s.evidence.trades.map(trade=><li key={trade.id}><Link href={`/app/smart-money/${encodeURIComponent(trade.wallet)}`}>{trade.wallet.slice(0,6)}…</Link> · {trade.side} · {f.number(trade.amountSol,4)} SOL · {f.date(trade.at)} {(/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(trade.signature))&&<a href={`https://solscan.io/tx/${encodeURIComponent(trade.signature)}`} target="_blank" rel="noopener noreferrer">Solscan ↗</a>}</li>)}</ul></details>,<ul key="outcomes">{s.measurements.map(m=><li key={m.horizonHours}>{m.horizonHours}h: {m.status==='MEASURED'?`${f.number(m.returnPct,2)}%`:t(m.status)}</li>)}</ul>]}))}/></>}
 <Pager page={paging.page} previous={paging.previous} next={()=>paging.next(query.data?.nextCursor??null)} canNext={!query.isFetching&&!query.isError&&!!query.data?.nextCursor}/></>;
}
function Emerging(){
 const t=useTranslations('workspace.smartResearch'),f=useFormat(),query=useResearchQuery('smart-money/emerging',EmergingSchema,true,60000);
 if(query.isError)return <ResourceError error={query.error} retry={()=>void query.refetch()}/>;
 if(query.isPending)return <Loading/>;
 const s=query.data.snapshot;
 return <><p>{t('emergingNote')}</p>{!s?<Empty body={t('noEmerging')}/>:<><p>{f.date(s.checkedAt)} · {(s.stale)?t('stale'):t('recorded')}{s.capped&&` · ${t('capped')}`}</p><DataTable caption={t('emerging')} headers={[t('wallet'),t('scannedTokens')]} rows={s.items.map(w=>({key:w.address,cells:[<a key="wallet" href={`https://solscan.io/account/${encodeURIComponent(w.address)}`} target="_blank" rel="noopener noreferrer">{w.address}</a>,f.number(w.scannedTokens,0)]}))}/></>}</>;
}
