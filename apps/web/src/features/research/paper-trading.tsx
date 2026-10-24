'use client';
import {TokenIdentity} from './token-identity';
import {useEffect,useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {useTranslations} from 'next-intl';
import {isSolanaAddress} from '@narra/shared';
import {ApiError} from '@/lib/api';
import {useResearch,useResearchQuery} from './session';
import {AiAccessSchema,ModeSchema,PaperAccountSchema,PaperPreviewSchema,PaperReceiptSchema,PositionsSchema,type PaperPreview} from './contracts';
import {Loading,ResourceError,useFormat} from './ui';

/** Explicit paper-only order intent. The server owns the reviewed ticket, quote, risk checks and idempotency key. */
export function PaperTrading({positionId:initialPosition,onBusy}:{positionId?:string;onBusy:(busy:boolean)=>void}){
 const t=useTranslations('workspace'),f=useFormat(),client=useQueryClient(),{send,userId}=useResearch();
 const account=useResearchQuery('paper-trades/account',PaperAccountSchema),positions=useResearchQuery('positions',PositionsSchema);
 const [side,setSide]=useState<'BUY'|'SELL'>(initialPosition?'SELL':'BUY'),[mint,setMint]=useState(''),[size,setSize]=useState('0.1'),[positionId,setPosition]=useState(initialPosition??''),[fraction,setFraction]=useState('100');
 const [preview,setPreview]=useState<PaperPreview|null>(null),[ack,setAck]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[uncertain,setUncertain]=useState(false),[receipt,setReceipt]=useState<string|null>(null),[clock,setClock]=useState(Date.now());
 const [settingUp,setSettingUp]=useState(false),[setupError,setSetupError]=useState(false);
 const pending=useRef(false);
 useEffect(()=>onBusy(busy||uncertain||settingUp),[busy,uncertain,settingUp,onBusy]);
 useEffect(()=>{if(!preview)return;setClock(Date.now());const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[preview]);
 const reset=()=>{setPreview(null);setAck(false);setError(null);setReceipt(null);};
 const run=async(work:()=>Promise<void>)=>{if(pending.current)return;pending.current=true;setBusy(true);setError(null);try{await work();}catch(e){const code=e instanceof ApiError?e.code:'UNKNOWN';setError(code);if(preview&&['NETWORK','TIMEOUT','INVALID_RESPONSE','UNKNOWN','PAPER_UNAVAILABLE'].includes(code))setUncertain(true);else setUncertain(false);}finally{pending.current=false;setBusy(false);}};
 // Setup writes only the caller's own account mode and existing AI access; the server re-checks both on every order.
 const settingUpWork=async(work:()=>Promise<void>)=>{if(settingUp)return;setSettingUp(true);setSetupError(false);try{await work();}catch{setSetupError(true);}finally{setSettingUp(false);}};
 const changeMode=(mode:'PAPER'|'SHADOW')=>settingUpWork(async()=>{await send('mode',ModeSchema,'PUT',{mode});await client.invalidateQueries({queryKey:['research',userId]}).catch(()=>undefined);});
 const enableEntries=()=>settingUpWork(async()=>{await send('ai-access',AiAccessSchema,'PUT',{enabled:true});await client.invalidateQueries({queryKey:['research',userId]}).catch(()=>undefined);});
  const available=positions.data?.items.filter(p=>p.simulated===true&&p.paperCloseEligible===true)??[];
  const selectedPosition=available.find(p=>p.id===positionId);
 const value=Number(size),valid=side==='BUY'?isSolanaAddress(mint.trim())&&/^\d+(?:\.\d{1,9})?$/.test(size)&&value>=.000001&&value<=10:available.some(p=>p.id===positionId);
 const ready=account.data?.mode==='PAPER'&&account.data.quotesAvailable&&!account.data.paused;
 const canBuy=ready&&account.data?.entryPermission;
 const expired=!!preview&&Date.parse(preview.expiresAt)<=clock;
 const review=()=>run(async()=>{setReceipt(null);setAck(false);const data=side==='BUY'?{side,mint:mint.trim(),sizeSol:value}:{side,positionId,fractionPct:Number(fraction)};setPreview(await send('paper-trades/preview',PaperPreviewSchema,'POST',data));});
 const confirm=()=>run(async()=>{
  if(!preview||!ack||expired&&!uncertain)return;
  const result=await send('paper-trades/confirm',PaperReceiptSchema,'POST',{previewId:preview.previewId,paperAcknowledged:true});
  setReceipt(result.orderId);setUncertain(false);setPreview(null);setAck(false);
  await client.invalidateQueries({queryKey:['research',userId]}).catch(()=>undefined);
 });
 const errorText=error&&t.has(`pm.errors.${error}`)?t(`pm.errors.${error}`):t('pm.errorGeneric');
 return <section className="paper-trading" id="paper-trading" aria-labelledby="paper-trading-title">
  <div className="paper-trading-heading"><div><span className="pf-badge">{t('pm.simulated')}</span><h2 id="paper-trading-title">{t('pm.title')}</h2></div></div>
  <p className="research-note">{t('pm.help')}</p>
  {account.isPending?<Loading/>:account.isError?<ResourceError error={account.error} retry={()=>void account.refetch()}/>:<>
   <dl className="paper-account"><div><dt>{t('pm.balance')}</dt><dd>{f.number(account.data.balanceSol,4)} SOL</dd></div><div><dt>{t('pm.fee')}</dt><dd>{f.number(account.data.feeSol,4)} SOL</dd></div></dl>
   <div className="paper-setup">
    <label>{t('pm.modeLabel')}<select value={account.data.mode??''} disabled={busy||settingUp||!!preview||uncertain} onChange={e=>void changeMode(e.target.value as 'PAPER'|'SHADOW')}>{account.data.mode&&!['PAPER','SHADOW'].includes(account.data.mode)&&<option value={account.data.mode} disabled>{account.data.mode}</option>}<option value="PAPER">{t('pm.modePaper')}</option><option value="SHADOW">{t('pm.modeShadow')}</option></select></label>
    <p className="research-note">{t('pm.modeHelp')}</p>
    {account.data.mode==='PAPER'&&!account.data.entryPermission&&<div className="paper-setup-action"><button type="button" className="research-control admin-primary" disabled={busy||settingUp} onClick={()=>void enableEntries()}>{settingUp?t('pm.applying'):t('pm.enableEntries')}</button><span className="research-note">{t('pm.entriesHelp')}</span></div>}
    {setupError&&<p className="paper-error" role="alert">{t('pm.setupError')}</p>}
   </div>
   {account.data.mode!=='PAPER'?<p className="research-note">{t('pm.paperRequired')}</p>:!account.data.quotesAvailable?<p className="research-note">{t('pm.noQuotes')}</p>:account.data.paused?<p className="research-note">{t('pm.paused')}</p>:<>
    {!account.data.entryPermission&&<p className="research-note">{t('pm.permission')}</p>}
    <form onSubmit={e=>{e.preventDefault();if(valid&&!busy&&!preview&&!uncertain&&(side==='SELL'||canBuy))void review();}}>
     <fieldset disabled={busy||uncertain||!!preview} className="paper-fields"><legend className="sr-only">{t('pm.order')}</legend>
      <label>{t('pm.side')}<select value={side} onChange={e=>{reset();setSide(e.target.value as 'BUY'|'SELL');}}><option value="BUY">{t('pm.buy')}</option><option value="SELL">{t('pm.sell')}</option></select></label>
      {side==='BUY'?<><label>{t('pm.mint')}<input value={mint} onChange={e=>{reset();setMint(e.target.value);}} spellCheck={false} autoComplete="off" maxLength={44}/></label><label>{t('pm.size')}<input inputMode="decimal" value={size} onChange={e=>{reset();setSize(e.target.value);}} maxLength={14}/></label></>:<><label>{t('pm.position')}<select value={positionId} onChange={e=>{reset();setPosition(e.target.value);}}><option value="">{t('pm.choosePosition')}</option>{available.map(p=><option value={p.id} key={p.id}>{p.token.symbol} · {p.id.slice(-6)}</option>)}</select></label><label>{t('pm.fraction')}<select value={fraction} onChange={e=>{reset();setFraction(e.target.value);}}>{[25,50,75,100].map(p=><option key={p} value={p}>{p}%</option>)}</select></label></>}
     </fieldset>
     {!preview&&<button className="research-control admin-primary" disabled={!valid||busy||uncertain||side==='BUY'&&!canBuy}>{busy?t('pm.working'):t('pm.review')}</button>}
    </form>
    <p className="research-note">{t('pm.evidence')}</p>
   </>}
  </>}
  {/* Native select options are text-only; the selected token's artwork is shown alongside the control. */}
  {side==='SELL'&&selectedPosition&&<p><TokenIdentity {...selectedPosition.token} compact/></p>}
  {preview&&<section className="paper-review" aria-labelledby="paper-review-title"><h3 id="paper-review-title">{t('pm.reviewTitle')}</h3><p>{t(preview.side==='BUY'?'pm.buy':'pm.sell')} · <TokenIdentity symbol={preview.symbol??preview.mint} name={preview.name} imageUrl={preview.imageUrl} compact/></p><code className="paper-mint">{preview.mint}</code>
   <dl className="paper-review-facts"><div><dt>{t(preview.side==='BUY'?'pm.approvedSize':'pm.fraction')}</dt><dd>{preview.side==='BUY'?`${f.number(preview.sizeSol,6)} SOL`:`${f.number(preview.fractionPct,0)}%`}</dd></div>{preview.side==='SELL'&&<div><dt>{t('pm.proceeds')}</dt><dd>{f.number(preview.estimatedProceedsSol,6)} SOL</dd></div>}<div><dt>{t('pm.fee')}</dt><dd>{f.number(preview.feeSol,4)} SOL</dd></div><div><dt>{t('pm.impact')}</dt><dd>{f.number(preview.priceImpactPct,2)}%</dd></div><div><dt>{t('pm.slippage')}</dt><dd>{f.number(preview.slippageBps,0)} bps</dd></div></dl>
   {preview.requestedSizeSol!=null&&preview.requestedSizeSol!==preview.sizeSol&&<p className="research-note">{t('pm.clamped',{requested:f.number(preview.requestedSizeSol,6),approved:f.number(preview.sizeSol,6)})}</p>}
   <p className="research-note">{t('pm.reviewNote')}</p><p className="research-note">{t(expired?'pm.expired':'pm.expires',{at:f.date(preview.expiresAt)})}</p>
   <label className="paper-ack"><input type="checkbox" checked={ack} disabled={busy||uncertain} onChange={e=>setAck(e.target.checked)}/>{t('pm.ack')}</label>
   <div className="paper-actions"><button type="button" className="research-control admin-primary" disabled={busy||!ack||expired&&!uncertain} onClick={()=>void confirm()}>{busy?t('pm.working'):t(uncertain?'pm.retrySame':'pm.confirm')}</button><button type="button" className="research-control" disabled={busy||uncertain} onClick={reset}>{t('pm.cancel')}</button></div>
  </section>}
  {error&&<p className="paper-error" role="alert">{uncertain?t('pm.uncertain'):errorText} <code>{error}</code></p>}
  {receipt&&<p className="paper-success" role="status">{t('pm.filled')} <code>{receipt}</code></p>}
 </section>;
}
