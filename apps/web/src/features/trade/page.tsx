'use client';
import {useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {useLocale} from 'next-intl';
import {ArrowDownUp,ArrowRight,ArrowUpRight,BookOpen,Check,Clock3,Copy,Layers,Plus,Search,ShieldCheck,Wallet,Activity,RefreshCw} from 'lucide-react';
import type {z} from 'zod';
import {isSolanaAddress,TradeConfig,TradeReview,TradePreview,TradeRecord,TradeHistory,TradeBalances,tradeBaseUnits,tradeDisplayUnits,type TradeReviewData} from '@narra/shared';
import {Link} from '@/i18n/navigation';
import {useAuth,type ResearchWallet} from '@/components/auth/context';
import {ApiError,createApi} from '@/lib/api';
import {validateChallenge,encodeSignature} from '@/features/access/proof';
import {hasFeature,useResearch,useResearchQuery} from '@/features/research/session';
import {Locked,ResourceError,useFormat} from '@/features/research/ui';
import {tradeCopy} from './copy';
import {TokenAvatar,TokenIdentity} from '@/features/research/token-identity';
import './trade.css';

type Preview=z.infer<typeof TradePreview>;
const short=(v:string)=>`${v.slice(0,6)}…${v.slice(-5)}`;
const decode=(v:string)=>Uint8Array.from(atob(v),c=>c.charCodeAt(0));
const encode=(v:Uint8Array)=>btoa(Array.from(v,b=>String.fromCharCode(b)).join(''));
function useCopy(){return tradeCopy[useLocale()==='id'?'id':'en'];}

export function TradePage({initialMint=''}:{initialMint?:string}){
 const c=useCopy(),{access}=useResearch(),[draft,setDraft]=useState(initialMint),[mint,setMint]=useState(isSolanaAddress(initialMint)?initialMint:''),[invalid,setInvalid]=useState(false),[busy,setBusy]=useState(false);
 const config=useResearchQuery('manual-trades/config',TradeConfig);
 return <div className="trade-page">
  <header className="trade-heading"><div><p className="trade-eyebrow">{c.eyebrow}</p><h1>{c.headline}</h1><p>{c.intro}</p></div><span className="trade-network"><span/>{c.mainnet}</span></header>
  {!hasFeature(access,'research.tokens')?<Locked tier={access.features['research.tokens']?.requiredTier}/>:<>
   <form className="trade-lookup" onSubmit={e=>{e.preventDefault();const value=draft.trim();setInvalid(!isSolanaAddress(value));if(isSolanaAddress(value))setMint(value);}}>
    <label htmlFor="trade-mint">{c.mint}</label><div><Search size={18} aria-hidden="true"/><input id="trade-mint" value={draft} disabled={busy} onChange={e=>setDraft(e.target.value)} placeholder={c.placeholder} maxLength={44} spellCheck={false} autoComplete="off" aria-invalid={invalid}/><button disabled={busy} className="trade-primary">{c.analyze}<ArrowRight size={16} aria-hidden="true"/></button></div>{invalid&&<p role="alert">{c.invalid}</p>}
   </form>
   {config.isError?<ResourceError error={config.error} retry={()=>void config.refetch()}/>:config.isPending?<p role="status">{c.loading}</p>:<>
    {!config.data.enabled&&<p className="trade-notice" role="status">{c.disabled}</p>}
    {mint?<TradeDesk key={mint} mint={mint} config={config.data} onBusy={setBusy} onConfigChanged={()=>config.refetch().then(()=>undefined)}/>:<div className="trade-empty"><BookOpen size={32}/><h2>{c.emptyTitle}</h2><p>{c.emptyBody}</p><div className="trade-journey">{[c.select,c.research,c.swap].map((s,i)=><span key={s}><b>0{i+1}</b>{s}</span>)}</div></div>}
   </>}
  </>}
  <History/>
 </div>;
}

function TradeDesk({mint,config,onBusy,onConfigChanged}:{mint:string;config:z.infer<typeof TradeConfig>;onBusy:(busy:boolean)=>void;onConfigChanged:()=>Promise<void>}){
 const c=useCopy(),f=useFormat(),auth=useAuth(),{send,read}=useResearch();
 const [review,setReview]=useState<TradeReviewData|null>(null),[reviewed,setReviewed]=useState(false),[phase,setPhase]=useState<'research'|'quote'|'sign'|'send'|null>('research'),[error,setError]=useState<string|null>(null);
 const [side,setSide]=useState<'BUY'|'SELL'>('BUY'),[amount,setAmount]=useState(''),[slippage,setSlippage]=useState(100),[address,setAddress]=useState(''),[preview,setPreview]=useState<Preview|null>(null),[active,setActive]=useState<string|null>(null),[clock,setClock]=useState(Date.now());
 const [walletBusy,setWalletBusy]=useState<string|null>(null),[pendingWallet,setPendingWallet]=useState<string|null>(null),[copied,setCopied]=useState<string|null>(null);
 const mounted=useRef(true),operation=useRef(false),walletRef=useRef(address);walletRef.current=address;
 const verified=auth.wallets.filter(w=>config.wallets.includes(w.address)),connected=verified.filter(w=>!!w.signTransaction),attention=auth.wallets.filter(w=>!config.wallets.includes(w.address)||!w.signTransaction),unsupported=verified.filter(w=>!w.signTransaction),hasPrivy=auth.wallets.some(w=>w.name.toLowerCase().includes('privy'));
 const connectedKey=connected.map(w=>w.address).join(','),wallet=connected.find(w=>w.address===address),currentWallet=useRef(wallet);currentWallet.current=wallet;
 const getAccessToken=auth.getAccessToken,api=useMemo(()=>createApi(process.env.NEXT_PUBLIC_API_URL??'',()=>getAccessToken()),[getAccessToken]);
 const balances=useResearchQuery(`manual-trades/balances?${new URLSearchParams({wallet:address,mint})}`,TradeBalances,config.enabled&&!!wallet,30000);
 const status=useResearchQuery(`manual-trades/${active??''}`,TradeRecord,!!active,active?10000:false);
 const finished=!!status.data&&['CONFIRMED','FAILED','EXPIRED'].includes(status.data.status),pending=!!active&&!finished;
 const quoteExpired=!!preview&&Date.parse(preview.expiresAt)<=clock,reviewExpired=!!review&&Date.parse(review.expiresAt)<=clock;
 const busy=!!phase;
 useEffect(()=>{onBusy(busy||pending);return()=>onBusy(false);},[busy,pending,onBusy]);
 useEffect(()=>{const ids=connectedKey?connectedKey.split(','):[];let next=address;if(address&&!ids.includes(address))next=ids.length===1?ids[0]!:'';else if(!address&&ids.length===1)next=ids[0]!;if(next!==address)setAddress(next);},[address,connectedKey]);
 useEffect(()=>{if(pendingWallet&&connectedKey.split(',').includes(pendingWallet)){setAddress(pendingWallet);setPendingWallet(null);}},[pendingWallet,connectedKey]);
 useEffect(()=>{mounted.current=true;const t=setInterval(()=>setClock(Date.now()),1000);return()=>{mounted.current=false;clearInterval(t);};},[]);
 useEffect(()=>{if(status.data?.status==='CONFIRMED')void balances.refetch();},[status.data?.status]); // eslint-disable-line react-hooks/exhaustive-deps
 const report=(e:unknown)=>setError(c.errors[e instanceof ApiError?e.code:e instanceof Error?e.message:'UNKNOWN']??c.errors.UNKNOWN!);
 async function research(){
  if(operation.current)return;operation.current=true;setPhase('research');setError(null);setReview(null);setReviewed(false);setPreview(null);
  try{const r=await send('manual-trades/research',TradeReview,'POST',{mint});if(mounted.current)setReview(r);}catch(e){if(mounted.current)report(e);}finally{operation.current=false;if(mounted.current)setPhase(null);}
 }
 useEffect(()=>{void research();},[]); // eslint-disable-line react-hooks/exhaustive-deps
 function change(work:()=>void){setPreview(null);setError(null);work();}
 async function copyAddress(value:string){try{await navigator.clipboard.writeText(value);setCopied(value);window.setTimeout(()=>{if(mounted.current)setCopied(current=>current===value?null:current);},1800);}catch{if(mounted.current)setError(c.errors.copyFailed!);}}
 async function verifyWallet(w:ResearchWallet){
  if(walletBusy||busy||operation.current)return;
  setWalletBusy(w.address);setError(null);
  try{
   const challenge=await api.challenge(w.address);validateChallenge(challenge,window.location.origin,w.address);
   let signature:Uint8Array;try{signature=await w.signMessage(new TextEncoder().encode(challenge.message));}catch{throw new ApiError('WALLET_REJECTED');}
   await api.verify({challengeId:challenge.challengeId,message:challenge.message,signature:encodeSignature(signature)});
   await onConfigChanged();
   if(mounted.current)setPendingWallet(w.address);
  }catch(e){if(mounted.current)report(e);}finally{if(mounted.current)setWalletBusy(null);}
 }
 async function quote(){
  if(operation.current||pending||!review||!reviewed||!wallet)return;
  operation.current=true;setPhase('quote');setError(null);setPreview(null);
  try{
   if(Date.parse(review.expiresAt)<=Date.now())throw Error('REVIEW_EXPIRED');
   if(!balances.data||balances.isError)throw Error('TRADE_UNAVAILABLE');
   const units=tradeBaseUnits(amount,side==='BUY'?9:balances.data.decimals);
   if(units>BigInt(side==='BUY'?balances.data.sol:balances.data.token))throw Error('INVALID_AMOUNT');
   const q=await send('manual-trades/preview',TradePreview,'POST',{reviewId:review.id,mint,wallet:address,side,amount,slippageBps:slippage});
   if(mounted.current&&currentWallet.current?.address===address)setPreview(q);
  }catch(e){if(mounted.current)report(e);}finally{operation.current=false;if(mounted.current)setPhase(null);}
 }
 async function approve(){
  if(operation.current||pending||!preview||!wallet?.signTransaction)return;
  operation.current=true;setPhase('sign');setError(null);const q=preview;
  try{
   if(Date.parse(q.expiresAt)<=Date.now())throw Error('QUOTE_EXPIRED');
   let signed:Uint8Array;
   try{signed=await wallet.signTransaction(decode(q.transaction));}catch{throw Error('WALLET_REJECTED');}
   if(!mounted.current)return;
   if(currentWallet.current?.address!==q.wallet||walletRef.current!==q.wallet)throw Error('WALLET_CHANGED');
   if(Date.parse(q.expiresAt)<=Date.now())throw Error('QUOTE_EXPIRED');
   setPhase('send');setActive(q.id);
   // Track the known ticket before the HTTP request. A lost response must lead to status checks, not another signature.
   await send('manual-trades/submit',TradeRecord,'POST',{id:q.id,signedTransaction:encode(signed)});
   if(mounted.current){setPreview(null);await read(`manual-trades/${q.id}`,TradeRecord).catch(()=>undefined);}
  }catch(e){if(mounted.current)report(e);}finally{operation.current=false;if(mounted.current)setPhase(null);}
 }
 return <>
  <ol className="trade-steps" aria-label={c.title}>{[c.select,c.research,c.swap].map((label,i)=><li key={label} aria-current={i===(reviewed?2:1)?'step':undefined}><span>{i<(reviewed?2:1)?<Check size={14}/>:i+1}</span>{label}</li>)}</ol>
  {error&&<div className="trade-error" role="alert">{error}{!review&&!busy&&<button className="research-control" onClick={()=>void research()}>{c.retry}</button>}</div>}
  <div className="trade-layout">
   <div className="trade-research">
    {!review?<div className="trade-panel trade-loading" aria-busy={busy}><Activity size={24}/><h2>{c.research}</h2><p role="status">{busy?c.loading:c.unknown}</p></div>:<>
     <header className="trade-token"><TokenAvatar symbol={review.symbol} imageUrl={review.imageUrl}/><div><h2>{review.symbol}<span>{review.name}</span></h2><code>{mint}</code></div><Link href={`/app/tokens/${mint}`} aria-label={c.details} title={c.details}><ArrowUpRight size={20}/></Link></header>
     <div className="trade-panel"><div className="trade-panel-title"><h3><BookOpen size={17}/>{c.research}</h3><span className="trade-tag">{review.buyBlockers.length?c.blocked:c.ready}</span></div><p>{c.reviewNote}</p><p className="trade-stamp">{f.date(review.at)}</p>
      {(review.buyBlockers.length>0||review.notes.length>0)&&<div className="trade-evidence-notes"><h4>{c.limits}</h4><ul>{[...review.buyBlockers,...review.notes].map(code=><li key={code}>{c.reasons[code]??code}</li>)}</ul></div>}
     </div>
     <div className="trade-evidence-grid">
      <section className="trade-panel"><div className="trade-panel-title"><h3><Activity size={17}/>{c.market}</h3><Fresh at={review.market}/></div><dl className="trade-facts"><Fact label={c.price} value={f.usd(review.market?.priceUsd)}/><Fact label={c.liquidity} value={f.usd(review.market?.liquidityUsd)}/><Fact label={c.volume} value={f.usd(review.market?.volume24hUsd)}/><Fact label={review.market?.marketCapIsFdv?c.fdv:c.cap} value={f.usd(review.market?.marketCapUsd)}/></dl><p className="trade-stamp">{review.market?`${review.market.source} · ${f.date(review.market.at)}`:c.unknown}</p></section>
      <section className="trade-panel"><div className="trade-panel-title"><h3><Layers size={17}/>{c.holders}</h3><Fresh at={review.holders}/></div><dl className="trade-facts"><Fact label={c.count} value={review.holders?f.number(review.holders.count,0):c.unknown}/><Fact label={c.top10} value={review.holders?`${f.number(review.holders.top10Pct)}%`:c.unknown}/></dl><p className="trade-stamp">{review.holders?f.date(review.holders.at):c.unknown}</p></section>
     </div>
     <section className="trade-panel"><div className="trade-panel-title"><h3><ShieldCheck size={17}/>{c.risk}</h3><Fresh at={review.risk}/></div>{!review.risk?<p>{c.unknown}</p>:<><p>{review.risk.flags.length?review.risk.flags.join(' · '):c.noFlags}</p><p className="trade-stamp">{f.date(review.risk.at)}</p></>}</section>
     <section className="trade-panel"><h3><Wallet size={17}/>{c.smart}</h3>{!review.smartMoney.access?<p>{c.locked}</p>:<>{!review.smartMoney.items.some(i=>i.fresh)&&<p>{c.noFlows}</p>}{review.smartMoney.items.map(flow=><div className="trade-flow" key={flow.id}><span className="trade-tag">{flow.side==='BUY'?c.buy:c.sell} · {flow.fresh?c.fresh:c.stale}</span><strong>{f.number(flow.netSol)} SOL</strong><p>{flow.entities} {c.entities} · {flow.wallets} {c.wallets}</p><time className="trade-stamp">{f.date(flow.at)}</time></div>)}<p className="trade-stamp">{c.flowNote}</p></>}</section>
     <section className="trade-panel"><h3><Layers size={17}/>{c.narratives}</h3>{!review.narratives.access?<p>{c.locked}</p>:review.narratives.items.length?<ul className="trade-narratives">{review.narratives.items.map(n=><li key={n.slug}><Link href={`/app/narratives/${n.slug}`}>{n.name}<ArrowUpRight size={14}/></Link><span>{n.relation}</span></li>)}</ul>:<p>{c.noNarrative}</p>}</section>
     <div className="trade-research-actions"><button className="research-control" disabled={busy||pending} onClick={()=>void research()}><RefreshCw size={14}/>{c.refresh}</button><button className="trade-primary" disabled={busy||pending||reviewExpired||reviewed} onClick={()=>setReviewed(true)}>{reviewed?<Check size={16}/>:null}{c.continue}<ArrowRight size={16}/></button></div>
    </>}
   </div>
   <aside className="trade-swap trade-panel" aria-label={c.swap}>
    <div className="trade-panel-title"><h2><ArrowDownUp size={19}/>{c.swap}</h2><span className="trade-tag">Mainnet</span></div>
    <div className="trade-side" role="group" aria-label={c.swap}>{(['BUY','SELL'] as const).map(s=><button key={s} disabled={busy||pending} aria-pressed={side===s} onClick={()=>change(()=>setSide(s))}>{s==='BUY'?c.buy:c.sell}</button>)}</div>
    <fieldset disabled={!reviewed||busy||pending||!!walletBusy||!config.enabled}>
     <label htmlFor="trade-wallet">{c.wallet}</label><select id="trade-wallet" value={address} onChange={e=>change(()=>setAddress(e.target.value))}><option value="">{c.chooseWallet}</option>{connected.map(w=><option key={w.address} value={w.address}>{w.name} · {short(w.address)}</option>)}</select>
     <div className="trade-amount"><label htmlFor="trade-amount">{c.amount}<TokenIdentity symbol={side==='BUY'?'SOL':review?.symbol??c.unknown} imageUrl={side==='SELL'?review?.imageUrl:undefined} compact/></label><input id="trade-amount" inputMode="decimal" autoComplete="off" placeholder="0.00" maxLength={23} value={amount} onChange={e=>change(()=>setAmount(e.target.value))}/><p>{c.balance}: {balances.isError||!balances.data?c.unknown:tradeDisplayUnits(side==='BUY'?balances.data.sol:balances.data.token,side==='BUY'?9:balances.data.decimals)}</p></div>
     <label htmlFor="trade-slippage">{c.slippage}</label><select id="trade-slippage" value={slippage} onChange={e=>change(()=>setSlippage(Number(e.target.value)))}>{[50,100,200,300].map(bps=><option value={bps} key={bps}>{bps/100}%</option>)}</select>
    </fieldset>
    {!reviewed&&<p className="trade-notice">{c.reviewFirst}</p>}
    {reviewExpired&&<p className="trade-notice">{c.researchExpired}</p>}
    <div className="trade-wallet-manager">
     {!connected.length&&<p className="trade-wallet-help">{c.walletHelp}</p>}
     {address?<div className="trade-wallet-address">
      <span className="trade-eyebrow">{c.receiveAddress}</span>
      <div><code>{address}</code><button type="button" className="research-control" onClick={()=>void copyAddress(address)}>{copied===address?<><Check size={14}/>{c.copied}</>:<><Copy size={14}/>{c.copyAddress}</>}</button></div>
      <p>{c.fundNote}</p>
     </div>:<p className="trade-stamp">{c.noWalletAddress}</p>}
     {attention.length>0&&<div className="trade-wallet-pending">
      <p className="trade-wallet-list-title">{c.connectedWallets}</p>
      {attention.map(w=>{const isVerified=config.wallets.includes(w.address),canSign=!!w.signTransaction;return <div className="trade-wallet-row" key={w.address}>
       <div className="trade-wallet-ident"><strong>{w.name}</strong><code>{w.address}</code></div>
       <div className="trade-wallet-row-actions"><span className="trade-tag">{isVerified?c.verified:c.needsVerification}</span><button type="button" className="research-control" aria-label={`${c.copyAddress}: ${w.address}`} title={c.copyAddress} onClick={()=>void copyAddress(w.address)}>{copied===w.address?<Check size={14}/>:<Copy size={14}/>}</button>{!isVerified&&canSign?<button type="button" className="research-control button-primary" disabled={!!walletBusy||busy||pending} onClick={()=>void verifyWallet(w)}>{walletBusy===w.address?c.verifying:c.verifyNow}</button>:!canSign?<span className="trade-wallet-warning">{c.unsupportedWallet}</span>:null}</div>
      </div>})}
     </div>}
     {unsupported.length>0&&<p className="trade-wallet-warning">{c.signerHelp}</p>}
     <div className="trade-wallet-actions">
      <button type="button" className="research-control" disabled={busy||pending||!!walletBusy} onClick={()=>void Promise.resolve(auth.connectWallet()).catch(()=>setError(c.errors.WALLET_REJECTED!))}><Plus size={14}/>{auth.wallets.length?c.connectAnother:c.connect}</button>
      {!hasPrivy&&<button type="button" className="research-control" disabled={busy||pending||!!walletBusy} onClick={()=>void Promise.resolve(auth.createWallet()).catch(()=>setError(c.errors.WALLET_REJECTED!))}><Wallet size={14}/>{c.createPrivy}</button>}
      <Link className="research-control" href="/early-access">{c.manageWallets}</Link>
     </div>
    </div>
    {side==='SELL'&&<p className="trade-stamp">{c.sellNote}</p>}
    {preview&&<div className="trade-quote"><p className="trade-eyebrow">{c.receive}</p><strong className="trade-receive">{tradeDisplayUnits(preview.quote.outAmount,preview.quote.outputDecimals)} <small><TokenIdentity symbol={side==='BUY'?review?.symbol??c.unknown:'SOL'} imageUrl={side==='BUY'?review?.imageUrl:undefined} compact/></small></strong><dl className="trade-facts"><Fact label={c.minimum} value={<span>{tradeDisplayUnits(preview.quote.minOut,preview.quote.outputDecimals)} <TokenIdentity symbol={side==='BUY'?review?.symbol??c.unknown:'SOL'} imageUrl={side==='BUY'?review?.imageUrl:undefined} compact/></span>}/><Fact label={c.networkFee} value={`${tradeDisplayUnits(preview.quote.networkFeeLamports,9)} SOL`}/><Fact label={c.priorityFee} value={`${tradeDisplayUnits(preview.quote.priorityFeeLamports,9)} SOL`}/><Fact label={c.overhead} value={`${tradeDisplayUnits(preview.quote.maxOverheadLamports,9)} SOL`}/><Fact label={c.impact} value={preview.quote.priceImpactPct===null?c.unknown:`${f.number(preview.quote.priceImpactPct)}%`}/></dl><p className="trade-stamp">{c.route}</p><p className="trade-expiry"><Clock3 size={14}/>{quoteExpired?c.quoteExpired:`${c.quoteExpires} ${Math.max(0,Math.floor((Date.parse(preview.expiresAt)-clock)/1000))}${c.seconds}`}</p></div>}
    {!active&&(preview&&!quoteExpired?<button className="trade-primary trade-submit" onClick={()=>void approve()} disabled={busy||!!walletBusy||!wallet||!config.enabled}>{phase==='sign'?c.signing:phase==='send'?c.sending:c.approve}<Wallet size={16}/></button>:<button className="trade-primary trade-submit" onClick={()=>void quote()} disabled={busy||!!walletBusy||!reviewed||reviewExpired||!config.enabled||!wallet||!amount||balances.isPending||balances.isError||side==='BUY'&&!!review?.buyBlockers.length}>{phase==='quote'?c.quoting:c.quote}<ArrowRight size={16}/></button>)}
    {active&&<div className="trade-result" role="status"><h3>{status.data?.status==='CONFIRMED'?c.confirmed:status.data?.status==='FAILED'?c.failed:status.data?.status==='EXPIRED'?c.expired:c.pending}</h3><p>{status.data?.status==='CONFIRMED'?c.done:finished?'':c.uncertain}</p>{status.data?.signature&&<a href={`https://solscan.io/tx/${status.data.signature}`} target="_blank" rel="noopener noreferrer">{c.explorer} ↗</a>}<button className="research-control" disabled={status.isFetching||busy} onClick={()=>void status.refetch()}>{c.check}</button>{finished&&<button className="research-control" onClick={()=>{setActive(null);setPreview(null);setError(null);setAmount('');}}>{c.reset}</button>}</div>}
    <p className="trade-stamp trade-sign-note"><ShieldCheck size={15}/>{c.walletNote}</p>
   </aside>
  </div>
 </>;
}
function Fresh({at}:{at:{fresh:boolean}|null}){const c=useCopy();return <span className="trade-fresh" data-fresh={at?.fresh??false}>{at?(at.fresh?c.fresh:c.stale):c.unknown}</span>;}
function Fact({label,value}:{label:string;value:ReactNode}){return <div><dt>{label}</dt><dd>{value}</dd></div>;}
function History(){
 const c=useCopy(),f=useFormat(),{read}=useResearch(),[error,setError]=useState(false),[checking,setChecking]=useState(false),query=useResearchQuery('manual-trades',TradeHistory,true,30000);
 const state={PREPARED:c.prepared,SUBMITTED:c.pending,CONFIRMED:c.confirmed,FAILED:c.failed,EXPIRED:c.expired};
 async function refresh(){setChecking(true);setError(false);try{for(const row of query.data?.items.filter(r=>r.status==='SUBMITTED'||r.status==='PREPARED')??[])await read(`manual-trades/${row.id}`,TradeRecord);await query.refetch();}catch{setError(true);}finally{setChecking(false);}}
 return <section className="trade-panel trade-history"><div className="trade-panel-title"><h2>{c.history}</h2><button className="research-control" disabled={checking||query.isFetching} onClick={()=>void refresh()}><RefreshCw size={14}/>{c.check}</button></div><p className="trade-stamp">{c.historyNote}</p>{query.isError?<ResourceError error={query.error} retry={()=>void query.refetch()}/>:query.isPending?<p>{c.loading}</p>:!query.data.items.length?<p>{c.noHistory}</p>:<ul>{query.data.items.map(row=><li key={row.id}><span className="trade-history-icon"><ArrowDownUp size={16}/></span><div><strong>{row.side==='BUY'?c.buy:c.sell} · {short(row.mint)}</strong><small>{short(row.wallet)} · {f.date(row.createdAt)}</small></div><span className="trade-tag">{state[row.status]}</span>{row.signature&&<a href={`https://solscan.io/tx/${row.signature}`} target="_blank" rel="noopener noreferrer" aria-label={`${c.explorer}: ${short(row.signature)}`}><ArrowUpRight size={18}/></a>}</li>)}</ul>}{error&&<p role="alert">{c.uncertain}</p>}</section>;
}
