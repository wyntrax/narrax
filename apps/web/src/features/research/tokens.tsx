'use client';
import {useState} from 'react';
import dynamic from 'next/dynamic';
import {useTranslations,useLocale} from 'next-intl';
import {ArrowDownUp,ArrowUpRight} from 'lucide-react';
import {tradeCopy} from '@/features/trade/copy';
import {Link} from '@/i18n/navigation';
import {useResearch,useResearchQuery,hasFeature} from './session';
import {TokensSchema,TokenSchema} from './contracts';
import {pagePath} from './api';
import {usePagination} from './pagination';
import {PageHeading,Section,Metrics,Facts,DataTable,Loading,ResourceError,Locked,Empty,Pager,Stamp,useFormat} from './ui';
import {MarketWatch} from './market-watch';
import {isSolanaAddress} from '@narra/shared';
import {ApiError} from '@/lib/api';
import {MintLookup,CopyMint} from './mint-lookup';
import {TokenBrief,useTokenMarketState,observedTokenMetrics} from './token-brief';
import {TokenIdentity,TokenAvatar} from './token-identity';
import {SafetyEvidence} from './safety-evidence';
import {LatestObservedEvidence} from './latest-evidence';
import './token-brief.css';
const TokenPricePanel=dynamic(()=>import('./token-chart'),{loading:Loading});
export function TokensPage(){const t=useTranslations('workspace'),[input,setInput]=useState(''),[search,setSearch]=useState(''),[history,setHistory]=useState(false);return <><PageHeading title={t('tokens')} body={t('trench.tokensBody')}/><MintLookup/><form className="research-search" onSubmit={e=>{e.preventDefault();setSearch(input.trim());}}><label htmlFor="token-search">{t('search')}</label><div><input id="token-search" type="search" maxLength={64} value={input} onChange={e=>setInput(e.target.value)}/><button className="research-control" type="submit">{t('searchButton')}</button>{search&&<button className="research-control" type="button" onClick={()=>{setInput('');setSearch('');}}>{t('clear')}</button>}</div></form><MarketWatch search={search}/><button className="research-control" aria-expanded={history} onClick={()=>setHistory(!history)}>{t('trench.history')}</button>{history&&<><p className="research-notice">{t('trench.historyNote')}</p><TokenResults key={search} search={search}/></>}</>;}
function TokenResults({search}:{search:string}){
 const t=useTranslations('workspace'),f=useFormat(),{access}=useResearch(),allowed=hasFeature(access,'research.tokens'),paging=usePagination();
 const query=useResearchQuery(pagePath('tokens',search?{q:search}:{},paging.cursor),TokensSchema,allowed);
 if(!allowed)return <Locked tier={access.features['research.tokens']?.requiredTier}/>;
 if(query.isError)return <ResourceError error={query.error} retry={()=>void query.refetch()}/>;
 if(query.isPending)return <Loading/>;
  return <>{query.data.items.length?<DataTable rowHref={mint=>`/app/tokens/${encodeURIComponent(mint)}`} caption={t('tokens')} headers={[t('token'),t('price'),t('marketCap'),t('liquidity')]} rows={query.data.items.map(token=>({key:token.mint,cells:[<Link key="token" href={`/app/tokens/${encodeURIComponent(token.mint)}`}><TokenIdentity symbol={token.symbol} name={token.name} imageUrl={token.imageUrl}/></Link>,f.usd(token.priceUsd),f.usd(token.marketCapUsd),f.usd(token.liquidityUsd)]}))}/>:<Empty/>}<Pager page={paging.page} previous={paging.previous} next={()=>paging.next(query.data.nextCursor)} canNext={!!query.data.nextCursor}/></>;
}
export function TokenPage({mint}:{mint:string}){
 const trade=tradeCopy[useLocale()==='id'?'id':'en'];
 const t=useTranslations('workspace'),f=useFormat(),{access}=useResearch(),allowed=hasFeature(access,'research.tokens');
   const valid=isSolanaAddress(mint),query=useResearchQuery(`tokens/${encodeURIComponent(mint)}`,TokenSchema,allowed&&valid,60000),marketState=useTokenMarketState(query.data);
  if(!allowed)return <Locked tier={access.features['research.tokens']?.requiredTier}/>;
  if(!valid)return <><Link className="research-back" href="/app/tokens">← {t('tokens')}</Link><PageHeading title={t('brief.lookup')} body={t('brief.invalid')}/><MintLookup/></>;
  if(query.isError&&query.error instanceof ApiError&&query.error.code==='NOT_FOUND')return <><Link className="research-back" href="/app/tokens">← {t('tokens')}</Link><PageHeading title={t('brief.notIndexed')} body={t('brief.notIndexedHelp')}/><p className="token-address"><code>{mint}</code></p><div className="market-links"><a className="research-control" href={`https://solscan.io/token/${encodeURIComponent(mint)}`} target="_blank" rel="noopener noreferrer">Solscan ↗</a><a className="research-control" href={`https://dexscreener.com/solana/${encodeURIComponent(mint)}`} target="_blank" rel="noopener noreferrer">DEX Screener ↗</a><button className="research-control" onClick={()=>void query.refetch()} disabled={query.isFetching}>{t('refresh')}</button></div><MintLookup/></>;
 if(query.isError)return <ResourceError error={query.error} retry={()=>void query.refetch()}/>;
 if(query.isPending)return <Loading/>;
    const token=query.data,m=observedTokenMetrics(token),h=token.holders,r=token.risk,c=token.consensus;
  return <><Link className="research-back" href="/app/tokens">← {t('tokens')}</Link><div className="token-detail-heading"><TokenAvatar symbol={token.symbol} imageUrl={token.imageUrl}/><PageHeading title={`${token.symbol} / ${token.name}`} actions={<button className="research-control" onClick={()=>void query.refetch()} disabled={query.isFetching}>{t('brief.refresh')}</button>}/></div><p className="token-address"><span>{t('mint')}</span> <code>{token.mint}</code></p><Stamp at={m?.at}/>{token.blacklisted&&<div className="research-notice" role="status"><strong>{t('blacklisted')}</strong><p>{t('blacklistBody')}</p></div>}
    <div className="token-trade-cta"><div className="token-trade-cta-copy"><span className="trade-eyebrow">{trade.ctaEyebrow}</span><h2>{trade.ctaTitle}</h2><p>{trade.ctaBody}</p></div><div className="token-trade-cta-actions"><Link className="research-control button-primary" href={`/app/trade?mint=${encodeURIComponent(token.mint)}`}><ArrowDownUp size={16}/>{trade.ctaButton}<ArrowUpRight size={15}/></Link><CopyMint key={token.mint} mint={token.mint}/></div></div><p className="research-notice">{token.observation?t('trench.sourceDetail',{source:token.observation.source,at:f.date(token.observation.at)}):t('trench.historyNote')}{marketState==='stale'&&` · ${t('trench.stale')}`}</p>
   <section aria-label={t(marketState==='fresh'?'brief.states.fresh':'brief.lastObserved')}>
    {m&&marketState!=='fresh'&&<div className="research-notice" role="status"><strong>{t('brief.lastObserved')}</strong><p>{t('brief.staleDisplay',{at:f.date(m.at)})}</p></div>}
    {!m&&<p className="research-notice" role="status">{t('brief.marketMissing')}</p>}
    <Metrics items={[{label:t('price'),value:f.usd(m?.priceUsd)},{label:t(token.observation?.marketCapIsFdv?'trench.fdv':'marketCap'),value:f.usd(m?.marketCapUsd)},{label:t('liquidity'),value:f.usd(m?.liquidityUsd)},{label:t('volume'),value:f.usd(m?.volume24hUsd)}]}/>
   </section>
  <div className="market-links"><a className="research-control" href={`https://dexscreener.com/solana/${encodeURIComponent(token.observation?.pairAddress??token.mint)}`} target="_blank" rel="noopener noreferrer">DEX Screener ↗</a><a className="research-control" href={`https://solscan.io/token/${encodeURIComponent(token.mint)}`} target="_blank" rel="noopener noreferrer">Solscan ↗</a></div>
    <TokenBrief token={token} state={marketState}/>
     <LatestObservedEvidence value={token.latestEvidence}/>
     <SafetyEvidence value={token.radarSafety}/>
   <Section title={t('enhance.issuerHolding')}>{token.developerHolding?<><Facts items={[{label:t('devHolding'),value:`${f.number(token.developerHolding.holdingPct,4)}%`},{label:t('smWallet'),value:<a href={`https://solscan.io/account/${encodeURIComponent(token.developerHolding.wallet)}`} target="_blank" rel="noopener noreferrer"><code>{token.developerHolding.wallet}</code> ↗</a>}]}/><p className="research-note">{t('enhance.issuerEvidence')}</p><Stamp at={token.developerHolding.at}/><a href={`https://solscan.io/tx/${encodeURIComponent(token.developerHolding.signature)}`} target="_blank" rel="noopener noreferrer">{t('enhance.transaction')} ↗</a></>:<p className="research-note">{t('enhance.issuerUnknown')}</p>}</Section>
  <Section title={t('priceEvents')}><TokenPricePanel token={token}/></Section>
   <details id="token-history" className="research-history"><summary>{t('trench.historicalModels')}</summary><p className="research-notice">{t('trench.historyNote')}</p><div className="research-columns"><Section title={t('holders')}><Facts items={[{label:t('holders'),value:f.number(h?.holders,0)},{label:t('top10'),value:f.number(h?.top10Pct)},{label:t('devHolding'),value:f.number(h?.devHoldingPct)},{label:t('smartHolders'),value:f.number(h?.smartWalletHolders,0)}]}/><Stamp at={h?.at}/></Section>
 <Section title={t('riskFlags')}><Facts items={[{label:t('risk'),value:f.number(r?.riskScore)}]}/>{!r?<p>{t('unavailable')}</p>:r.flags.length?<ul>{r.flags.map((flag,i)=><li key={i}>{flag}</li>)}</ul>:<p>{t('noFlags')}</p>}<Stamp at={r?.at}/></Section></div>
 <Section title={t('consensus')}><Metrics items={[{label:t('score'),value:f.number(c?.score)},{label:t('walletCount'),value:f.number(c?.walletCount,0)},{label:t('entities'),value:f.number(c?.independentEntities,0)},{label:t('leaders'),value:f.number(c?.leaderCount,0)},{label:t('netFlow'),value:f.number(c?.netFlowSol)},{label:t('concentration'),value:f.number(c?.timingConcentration)}]}/></Section>
   </details><div id="token-narratives"><Section title={t('relatedNarratives')}>{token.narratives.length?<DataTable caption={t('relatedNarratives')} headers={[t('name'),t('stage'),t('relation'),t('og')]} rows={token.narratives.map(n=>({key:n.slug,cells:[<Link key="name" href={`/app/narratives/${encodeURIComponent(n.slug)}`}>{n.name}</Link>,t(`stages.${n.stage}`),n.relation,f.number(n.ogScore)]}))}/>:<Empty body={t('brief.narrativesMissing')}/>}<p className="research-note">{t('ogNote')}</p></Section></div></>;
}
