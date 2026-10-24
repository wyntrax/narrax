'use client';
import {useState} from 'react';
import {useTranslations} from 'next-intl';
import {Activity} from 'lucide-react';
import {Link} from '@/i18n/navigation';
import {useResearch,useResearchQuery} from './session';
import {MyBalancesSchema,MyWalletsSchema,PerformanceSchema,PositionsSchema,TradesSchema,EquitySchema,type Equity,type PositionEvaluation} from './contracts';
import {pagePath} from './api';
import {usePagination} from './pagination';
import {saveTextFile} from './download';
import {PageHeading,Section,Metrics,DataTable,Loading,ResourceError,Empty,Pager,useFormat} from './ui';
import './portfolio.css';
import {PaperTrading} from './paper-trading';
import {TokenIdentity} from './token-identity';

const DAYS=[7,30,90],DAILY_ROWS=7;
// A recorded action code maps to copy; an unexpected code is shown as it came from the server.
const ACTIONS:Record<string,string>={HOLD:'pf.actHold',REDUCE:'pf.actReduce',SELL:'pf.actSell'};
const short=(value:string)=>value.length>14?`${value.slice(0,6)}…${value.slice(-6)}`:value;
/** A plausible base58 transaction signature. Anything else stays plain text rather than a dead link. */
const signature=/^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const pnlClass=(value:number|null)=>value==null?'':value>0?'pf-up':value<0?'pf-down':'';

/** The signed-in user's own paper and real account: open positions with the monitor's reading, results, trades and wallets. */
export function PortfolioPage(){
  const t=useTranslations('workspace'),[days,setDays]=useState(30),[simulated,setSimulated]=useState(true);
 const [selectedPosition,setSelectedPosition]=useState<{id:string;key:number}>(),[tradingBusy,setTradingBusy]=useState(false);
 return <div className="pf-page">
  <PageHeading title={t('portfolio')} body={t('pf.body')} actions={<div className="research-filters">
   <label>{t('pf.account')}<select disabled={tradingBusy} value={simulated?'paper':'real'} onChange={e=>setSimulated(e.target.value==='paper')}><option value="paper">{t('pf.paper')}</option><option value="real">{t('pf.real')}</option></select></label>
   <label>{t('anWindow')}<select value={days} onChange={e=>setDays(Number(e.target.value))}>{DAYS.map(d=><option key={d} value={d}>{t('anDays',{days:d})}</option>)}</select></label>
  </div>}/>
  {simulated?<PaperTrading key={selectedPosition?.key??'buy'} positionId={selectedPosition?.id} onBusy={setTradingBusy}/>:<p className="research-note">{t('pm.realReadOnly')}</p>}
  <Positions closeDisabled={tradingBusy} onClose={id=>{setSelectedPosition(previous=>({id,key:(previous?.key??0)+1}));setSimulated(true);document.getElementById('paper-trading')?.scrollIntoView?.({behavior:'smooth',block:'start'});}}/>
  <Results days={days} simulated={simulated}/>
  <EquityCurve days={days} simulated={simulated}/>
  <Trades/>
  <Wallets/>
 </div>;
}

/** Open positions. The monitor column is a fixed-rule recommendation, and it says so. */
function Positions({onClose,closeDisabled}:{onClose:(id:string)=>void;closeDisabled:boolean}){
 const t=useTranslations('workspace'),f=useFormat();
 const query=useResearchQuery('positions',PositionsSchema);
 return <Section title={t('pf.positions')}>
  {query.isError?<ResourceError error={query.error} retry={()=>void query.refetch()}/>:query.isPending?<Loading/>:!query.data.items.length?<Empty body={t('pf.noPositions')}/>:
   <DataTable caption={t('pf.positions')} headers={[t('anToken'),t('pf.mode'),t('pf.size'),t('pf.entry'),t('pf.current'),t('pf.pnl'),t('pf.opened'),t('pf.monitor')]} rows={query.data.items.map(p=>({key:p.id,cells:[
     <Link key="token" href={`/app/tokens/${encodeURIComponent(p.token.mint)}`}><TokenIdentity {...p.token}/></Link>,
    p.mode,
    f.number(p.sizeSol,4),
    f.usd(p.entryPriceUsd),
    f.usd(p.currentPriceUsd),
    <span key="pnl" className={pnlClass(p.pnlPct)}>{p.pnlPct==null?t('unknown'):`${p.pnlPct>=0?'+':''}${p.pnlPct.toFixed(2)}%`}</span>,
    f.date(p.openedAt),
    <span key="reading"><Reading evaluation={p.evaluation}/>{p.simulated===true&&p.paperCloseEligible===true&&<button type="button" disabled={closeDisabled} className="research-control" onClick={()=>onClose(p.id)}>{t('pm.closePosition')}</button>}</span>]}))}/>}
  <p className="research-note">{t('pf.monitorNote')}</p>
 </Section>;
}

function Reading({evaluation}:{evaluation:PositionEvaluation|null}){
 const t=useTranslations('workspace'),f=useFormat();
 if(!evaluation)return <span className="pf-evidence"><b>{t('pf.monitorNone')}</b><small>{t('pf.monitorPending')}</small></span>;
 const key=ACTIONS[evaluation.action];
 return <span className="pf-evidence">
  <b>{key?t(key):evaluation.action}{evaluation.fractionPct>0&&` · ${t('pf.fraction',{value:evaluation.fractionPct})}`}</b>
  <small>{t('pf.readAt',{at:f.date(evaluation.at)})}</small>
  {evaluation.blind&&<small className="pf-warn">{t('pf.blind')}</small>}
  {evaluation.signals.length>0&&<details><summary>{t('pf.signals',{count:evaluation.signals.length})}</summary><ul>{evaluation.signals.map(s=><li key={`${s.code}:${s.detail}`}><code>{s.code}</code> {s.detail}</li>)}</ul></details>}
  {evaluation.unavailable.length>0&&<details><summary>{t('pf.unavailable',{count:evaluation.unavailable.length})}</summary><ul>{evaluation.unavailable.map(u=><li key={u}><span>{u}</span></li>)}</ul></details>}
 </span>;
}

/** Paper and real results are never mixed: the toggle chooses one account, and the copy names which one is showing. */
function Results({days,simulated}:{days:number;simulated:boolean}){
 const t=useTranslations('workspace'),f=useFormat();
 const query=useResearchQuery(`analytics/me/performance?days=${days}`,PerformanceSchema);
 const results=query.data?.[simulated?'paper':'real'];
 const daily=results?[...results.daily].reverse().slice(0,DAILY_ROWS):[];
 return <Section title={t('pf.results')} action={<span className="pf-badge">{t(simulated?'pf.paper':'pf.real')}</span>}>
  {query.isError?<ResourceError error={query.error} retry={()=>void query.refetch()}/>:query.isPending?<Loading/>:!results?null:<>
   <Metrics items={[{label:t('pf.tradesCount'),value:f.number(results.trades,0)},{label:t('pf.realizedPnl'),value:`${f.number(results.realizedPnlSol,4)} SOL`},{label:t('pf.fees'),value:`${f.number(results.feesSol,4)} SOL`},{label:t('pf.closedPositions'),value:f.number(results.closedPositions.count,0)},{label:t('pf.wins'),value:f.number(results.closedPositions.wins,0)},{label:t('pf.winRate'),value:results.closedPositions.winRate==null?t('unknown'):f.percent(results.closedPositions.winRate)}]}/>
   {results.closedPositions.winRateCi&&<p className="research-note">{t('pf.winRateCi',{low:f.percent(results.closedPositions.winRateCi[0]),high:f.percent(results.closedPositions.winRateCi[1])})}</p>}
   <p className="research-note" role="status">{results.closedPositions.sufficient?t('pf.sampleEnough'):t('pf.sampleThin')}</p>
   {results.closedPositions.note&&<p className="research-note">{results.closedPositions.note}</p>}
   {query.data?.truncated&&<p className="research-note">{t('pf.truncated')}</p>}
   <h3>{t('pf.daily')}</h3>
   {daily.length?<DataTable caption={t('pf.daily')} headers={[t('pf.day'),t('pf.pnlSol')]} rows={daily.map(d=>({key:d.day,cells:[d.day,<span key="pnl" className={pnlClass(d.pnlSol)}>{f.number(d.pnlSol,4)} SOL</span>]}))}/>:<p className="research-note">{t('pf.noDaily')}</p>}
   {results.daily.length>daily.length&&<p className="research-note">{t('pf.dailyCap',{shown:daily.length,total:results.daily.length})}</p>}
   <h3>{t('pf.caveats')}</h3><ul className="pf-caveats">{query.data!.caveats.map((c,i)=><li key={i}>{c}</li>)}</ul></>}
 </Section>;
}

function EquityCurve({days,simulated}:{days:number;simulated:boolean}){
 const t=useTranslations('workspace'),f=useFormat();
 const query=useResearchQuery(`analytics/me/equity?days=${days}&simulated=${simulated}`,EquitySchema);
 const equity=query.data;
 return <Section title={t('pf.equity')} action={<span className="pf-badge">{t(simulated?'pf.paper':'pf.real')}</span>}>
  {query.isError?<ResourceError error={query.error} retry={()=>void query.refetch()}/>:query.isPending?<Loading/>:!equity?null:<>
   <Metrics items={[{label:t('pf.peak'),value:`${f.number(equity.peakSol,4)} SOL`},{label:t('pf.latest'),value:`${f.number(equity.latestSol,4)} SOL`},{label:t('pf.drawdown'),value:equity.drawdownPct==null?t('unknown'):`${f.number(equity.drawdownPct,2)}%`},{label:t('pf.points'),value:f.number(equity.points.length,0)}]}/>
   <EquityChart equity={equity}/>
   {equity.downsampled&&<p className="research-note">{t('pf.downsampled')}</p>}
   <p className="research-note">{t('pf.equityNote',{from:f.date(equity.range.from),to:f.date(equity.range.to)})}</p></>}
 </Section>;
}

/** A stored equity curve. Stored readings only: no interpolation, and a single reading is not a trend. */
export function EquityChart({equity}:{equity:Equity}){
 const t=useTranslations('workspace'),f=useFormat(),points=equity.points;
 if(!points.length)return <div className="pf-chart-empty" role="status"><Activity size={26} aria-hidden="true"/><p>{t('pf.equityEmpty')}</p></div>;
 const values=points.map(p=>p.valueSol),min=Math.min(...values),max=Math.max(...values),padding=(max-min||Math.abs(max)||1)*.1;
 const low=Math.max(0,min-padding),high=max+padding,first=Date.parse(points[0]!.at),last=Date.parse(points[points.length-1]!.at);
 const x=(at:string)=>last===first?385:70+(Date.parse(at)-first)/(last-first)*630;
 const y=(value:number)=>high===low?110:180-(value-low)/(high-low)*160;
 return <figure className="pf-chart">
  <svg viewBox="0 0 720 210" role="img" aria-label={t('pf.equityChartLabel',{count:points.length,peak:f.number(max,4),latest:f.number(values[values.length-1]!,4)})}>
   {[0,.5,1].map(fraction=>{const line=180-fraction*160;return <g key={fraction}><path className="research-gridline" d={`M70 ${line}H700`}/><text x="60" y={line+4} textAnchor="end">{f.number(low+fraction*(high-low),4)}</text></g>;})}
   {points.length>1&&<polyline className="pf-line" points={points.map(p=>`${x(p.at)},${y(p.valueSol)}`).join(' ')}/>}
   <circle className="pf-point" cx={x(points[points.length-1]!.at)} cy={y(values[values.length-1]!)} r="4"/>
   <text x="70" y="202">{f.date(points[0]!.at)}</text>{points.length>1&&<text x="700" y="202" textAnchor="end">{f.date(points[points.length-1]!.at)}</text>}
  </svg>
  <figcaption>{points.length===1?t('pf.equitySingle'):t('pf.equityChartNote')}</figcaption>
 </figure>;
}

/** The user's own trades, newest first. The audited export is the only place fees and realized P&L per trade appear. */
function Trades(){
 const t=useTranslations('workspace'),f=useFormat(),paging=usePagination();
 const {download}=useResearch();
 const query=useResearchQuery(pagePath('trades',{},paging.cursor),TradesSchema);
 const [state,setState]=useState<{format:'csv'|'json'}|'error'|null>(null),[busy,setBusy]=useState(false);
 const grab=async(format:'csv'|'json')=>{
  setBusy(true);setState(null);
  try{const text=await download(`trades/export?format=${format}`);saveTextFile(`narra-trades.${format}`,text,format==='csv'?'text/csv;charset=utf-8':'application/json');setState({format});}
  catch{setState('error');}
  finally{setBusy(false);}
 };
 return <Section title={t('pf.trades')} action={<div className="pf-export"><button className="research-control" disabled={busy} onClick={()=>void grab('csv')}>{t('pf.exportCsv')}</button><button className="research-control" disabled={busy} onClick={()=>void grab('json')}>{t('pf.exportJson')}</button></div>}>
  {query.isError?<ResourceError error={query.error} retry={()=>void query.refetch()}/>:query.isPending?<Loading/>:!query.data.items.length?<Empty body={t('pf.noTrades')}/>:
   <DataTable caption={t('pf.trades')} headers={[t('pf.executedAt'),t('pf.side'),t('pf.mode'),t('anToken'),t('pf.size'),t('pf.expected'),t('pf.actual'),t('pf.slippage'),t('pf.reason'),t('pf.signature')]} rows={query.data.items.map(trade=>({key:trade.id,cells:[
    f.date(trade.executedAt),
    trade.side,
     trade.simulated===true?`${trade.mode} · ${t('pf.paper')}`:trade.mode,
     <Link key="token" href={`/app/tokens/${encodeURIComponent(trade.token.mint)}`}><TokenIdentity {...trade.token}/></Link>,
    f.number(trade.sizeSol,4),
    f.usd(trade.expectedPriceUsd),
    f.usd(trade.actualPriceUsd),
    trade.slippageBps==null?t('unknown'):t('pf.bps',{value:f.number(trade.slippageBps,1)}),
    trade.reason,
    signature.test(trade.signature)?<a key="sig" href={`https://solscan.io/tx/${encodeURIComponent(trade.signature)}`} target="_blank" rel="noopener noreferrer" title={trade.signature}>{short(trade.signature)} ↗</a>:<code key="sig">{short(trade.signature)}</code>]}))}/>}
  {query.data&&<Pager page={paging.page} previous={paging.previous} next={()=>paging.next(query.data?.nextCursor??null)} canNext={!query.isFetching&&!query.isError&&!!query.data?.nextCursor}/>}
  <p className="research-note">{t('pf.exportNote')}</p>
  {state==='error'?<p className="research-note pf-warn" role="alert">{t('pf.exportFailed')}</p>:state&&<p className="research-note" role="status">{t('pf.exported',{format:state.format.toUpperCase()})}</p>}
 </Section>;
}

/** Own trading wallets and their SOL balance. A missing or failed read stays unknown, never zero. */
function Wallets(){
 const t=useTranslations('workspace'),f=useFormat();
 const wallets=useResearchQuery('me/wallets',MyWalletsSchema),balances=useResearchQuery('me/wallets/balances',MyBalancesSchema);
 const balance=new Map((balances.data?.items??[]).map(b=>[b.address,b]));
 const rows=(wallets.data?.items??[]).map(w=>{const b=balance.get(w.address);return {key:w.id,cells:[<code key="address" title={w.address}>{short(w.address)}</code>,w.kind,b?.status==='OK'?`${f.number(b.balanceSol,4)} SOL`:t('pf.balanceUnknown')]};});
 return <Section title={t('pf.wallets')}>
  {wallets.isError?<ResourceError error={wallets.error} retry={()=>void wallets.refetch()}/>:wallets.isPending?<Loading/>:!rows.length?<Empty body={t('pf.walletsEmpty')}/>:<DataTable caption={t('pf.wallets')} headers={[t('pf.address'),t('pf.kind'),t('pf.balance')]} rows={rows}/>}
  {!!rows.length&&balances.isError&&<ResourceError error={balances.error} retry={()=>void balances.refetch()}/>}
  {!!rows.length&&balances.data&&!balances.data.available&&<p className="research-note">{t('pf.balancesUnavailable')}</p>}
  <p className="research-note">{t('pf.walletNote')}</p>
 </Section>;
}
