'use client';
import {useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {useTranslations} from 'next-intl';
import {isSolanaAddress} from '@narra/shared';
import {Link} from '@/i18n/navigation';
import type {AdminApi} from './api';
import {QualificationBadge} from '@/features/research/wallet-research';
import {Empty,Loading,ResourceError,DataTable,Facts,Pager,useFormat} from '@/features/research/ui';
import {usePagination} from '@/features/research/pagination';

export function WalletResearchCard({api,queryKey}:{api:AdminApi;queryKey:readonly unknown[]}){
 const t=useTranslations('workspace.smartResearch'),[open,setOpen]=useState(false);
 return <section className="admin-card admin-wide"><h2>{t('adminTitle')}</h2><p>{t('adminHelp')}</p><button className="research-control" aria-expanded={open} onClick={()=>setOpen(!open)}>{t('reviewPanel')}</button>{open&&<ReviewPanel api={api} queryKey={queryKey}/>}</section>;
}
function ReviewPanel({api,queryKey}:{api:AdminApi;queryKey:readonly unknown[]}){
 const t=useTranslations('workspace.smartResearch'),f=useFormat(),client=useQueryClient(),candidatePage=usePagination();
 const [sort,setSort]=useState<'recommended'|'id'>('recommended');
 const [readyOnly,setReadyOnly]=useState(false);
 const [flowOnly,setFlowOnly]=useState(false);
 const [review,setReview]=useState<''|'APPROVED'|'PROVISIONAL'|'REJECTED'>('');
 const [queryInput,setQueryInput]=useState('');
 const [query,setQuery]=useState('');
 const health=useQuery({queryKey:[...queryKey,'health'],queryFn:()=>api.researchHealth(),retry:false});
 const candidates=useQuery({queryKey:[...queryKey,'candidates',candidatePage.cursor],queryFn:()=>api.walletCandidates(candidatePage.cursor??undefined),retry:false});
 const refresh=()=>{void client.invalidateQueries({queryKey});};
 const d=health.data?.discovery,w=health.data?.wallets,s=health.data?.tokenScans,fl=health.data?.flow;
 const reasons=fl?.withheldReasons?Object.entries(fl.withheldReasons).filter(([,count])=>count>0):[];
 const pendingReasons=fl?.pendingReasons?Object.entries(fl.pendingReasons).filter(([,count])=>count>0):[];
 const pendingExpired=fl?.pendingExpiredReasons?Object.entries(fl.pendingExpiredReasons).filter(([,count])=>count>0):[];
 return <><button className="research-control" onClick={refresh}>{t('refresh')}</button>{health.isError&&<ResourceError error={health.error} retry={()=>void health.refetch()}/>}
 {health.data&&<p>{t(health.data.enabled?'enabled':'disabled')}</p>}{w&&<Facts items={[{label:t('activeWallets'),value:f.number(w.active,0)},{label:t('discoveredWallets'),value:f.number(w.discovered,0)},{label:t('approvedWallets'),value:f.number(w.approved,0)}]}/>}
 {fl&&<><h3>{t('flowHealth')}</h3><p>{f.date(fl.checkedAt)}</p><Facts items={[{label:t('flowConsidered'),value:f.number(fl.considered,0)},{label:t('flowCreated'),value:f.number(fl.created,0)},{label:t('flowWithheld'),value:f.number(fl.withheld,0)},{label:t('flowPending'),value:f.number(fl.pending??0,0)}]}/>
  {reasons.length>0&&<><p>{t('flowWithheldNote')}</p><ul>{reasons.map(([reason,count])=><li key={reason}>{t(`flowReasons.${reason}`)}: {f.number(count,0)}</li>)}</ul></>}
  {pendingReasons.length>0&&<><p>{t('flowPendingNote')}</p><ul>{pendingReasons.map(([reason,count])=><li key={reason}>{t(`flowReasons.${reason}`)}: {f.number(count,0)}</li>)}</ul></>}
  {pendingExpired.length>0&&<><p>{t('flowPendingExpiredNote')}</p><ul>{pendingExpired.map(([reason,count])=><li key={reason}>{t(`flowReasons.${reason}`)}: {f.number(count,0)}</li>)}</ul></>}
 </>}
 {d&&<><p>{t('discovery')} · {f.date(d.checkedAt)}</p><Facts items={(['completeScans','noPrice','stalePrice','insufficientObservations','tokensJudged','winners','candidates','emerging'] as const).map(k=>({label:t(k),value:f.number(d[k],0)}))}/></>}
 {s&&s.length>0&&<><h3>{t('tokenScans')}</h3><Facts items={[{label:t('scanNewWallets'),value:f.number(s.reduce((sum,x)=>sum+x.newWallets,0),0)},{label:t('scanStoredSwaps'),value:f.number(s.reduce((sum,x)=>sum+x.createdTrades,0),0)}]}/><p>{s[0]!.status}{s[0]!.error?` · ${s[0]!.error}`:''} · {f.date(s[0]!.checkedAt)}</p></>}
 <h3>{t('wallets')}</h3>
 <form className="research-search" onSubmit={e=>{e.preventDefault();setQuery(queryInput.trim());}}>
  <label htmlFor="admin-wallet-search">{t('walletSearch')}</label>
  <div><input id="admin-wallet-search" type="search" maxLength={64} value={queryInput} onChange={e=>setQueryInput(e.target.value)}/><button type="submit" className="research-control">{t('search')}</button>{query&&<button type="button" className="research-control" onClick={()=>{setQueryInput('');setQuery('');}}>{t('clear')}</button>}</div>
 </form>
 <div className="research-filters">
  <label>{t('sortLabel')}<select value={sort} onChange={e=>setSort(e.target.value as 'recommended'|'id')}><option value="recommended">{t('sortRecommended')}</option><option value="id">{t('sortDefault')}</option></select></label>
  <label>{t('reviewStatus')}<select value={review} onChange={e=>setReview(e.target.value as ''|'APPROVED'|'PROVISIONAL'|'REJECTED')}><option value="">{t('reviewAll')}</option><option value="APPROVED">{t('reviewApproved')}</option><option value="PROVISIONAL">{t('reviewProvisional')}</option><option value="REJECTED">{t('reviewRejected')}</option></select></label>
  <button type="button" className="research-control" aria-pressed={readyOnly} onClick={()=>setReadyOnly(!readyOnly)}>{t('readyOnly')}</button>
  <button type="button" className="research-control" aria-pressed={flowOnly} onClick={()=>setFlowOnly(!flowOnly)}>{t('flowOnly')}</button>
 </div>
 <TrackedWalletsSection key={`${sort}:${readyOnly}:${flowOnly}:${review}:${query}`} api={api} queryKey={queryKey} sort={sort} readyOnly={readyOnly} flowOnly={flowOnly} review={review||undefined} query={query||undefined}/>
 <h3>{t('candidates')}</h3><p>{t('candidateNote')}</p>{candidates.isError?<ResourceError error={candidates.error} retry={()=>void candidates.refetch()}/>:candidates.isPending?<Loading/>:<DataTable caption={t('candidates')} headers={[t('wallet'),t('evidence'),t('review')]} rows={candidates.data.items.map(c=>({key:c.address,cells:[c.address,<div key="evidence">{t('winnerCount',{count:c.winnerTokens})} · {f.number(c.score,1)}<small>{f.date(c.evidence?.checkedAt)}</small><ul>{c.evidence?.winnerMints?.map(m=><li key={m}><a href={`https://solscan.io/token/${encodeURIComponent(m)}`} target="_blank" rel="noopener noreferrer">{m}</a></li>)}</ul></div>,<ReviewForm key="review" api={api} address={c.address} queryKey={queryKey} candidate/>]}))}/>}
 <Pager page={candidatePage.page} previous={candidatePage.previous} next={()=>candidatePage.next(candidates.data?.nextCursor??null)} canNext={!candidates.isFetching&&!!candidates.data?.nextCursor}/></>;
}
function TrackedWalletsSection({api,queryKey,sort,readyOnly,flowOnly,review,query}:{api:AdminApi;queryKey:readonly unknown[];sort:'recommended'|'id';readyOnly:boolean;flowOnly:boolean;review?:'APPROVED'|'PROVISIONAL'|'REJECTED';query?:string}){
 const t=useTranslations('workspace.smartResearch'),f=useFormat(),walletPage=usePagination();
 const wallets=useQuery({queryKey:[...queryKey,'wallets',sort,readyOnly,flowOnly,review,query,walletPage.cursor],queryFn:()=>api.researchWallets(walletPage.cursor??undefined,{sort,readyOnly,...(flowOnly?{flowOnly}:{}),...(review?{review}:{}),...(query?{q:query}:{})}),retry:false});
 return <>
  {wallets.isError?<ResourceError error={wallets.error} retry={()=>void wallets.refetch()}/>:wallets.isPending?<Loading/>:!wallets.data.items.length?<Empty body={readyOnly?t('noReadyWallets'):undefined}/>:<DataTable caption={t('wallets')} headers={[t('wallet'),t('qualification'),t('review')]} rows={wallets.data.items.map(w=>{
   const readyToApprove=w.readyToApprove??(w.researchReview==='PROVISIONAL'&&w.qualification.reasons.length===1&&w.qualification.reasons[0]==='REVIEW_REQUIRED');
   const sample=w.qualification.sample;
   const href=`/app/smart-money/${encodeURIComponent(w.address)}`;
   return {key:w.address,cells:[
    <div key="address">
     {w.label&&<strong>{w.label} </strong>}
     <Link href={href}>{w.address}</Link>
     {readyToApprove&&<span className="sm-chips"><span className="sm-chip">{t('readyBadge')}</span></span>}
     <small>{w.source} · {w.researchReview}</small>
     <small><Link href={href}>{t('inspectWallet')} ↗</Link>{isSolanaAddress(w.address)&&<> · <a href={`https://solscan.io/account/${encodeURIComponent(w.address)}`} target="_blank" rel="noopener noreferrer">Solscan ↗</a></>}</small>
    </div>,
    <div key="qualified">
     {(w.score!=null||w.style||sample?.pnlSol!=null||sample?.medianRoi!=null)&&<span className="sm-chips">
      {w.score!=null&&<span className="sm-chip">{t('score')} {f.number(w.score,1)}</span>}
      {w.style&&<span className="sm-chip sm-chip-quiet">{w.style}</span>}
      {sample?.pnlSol!=null&&<span className="sm-chip">{t('pnl')} {f.number(sample.pnlSol,2)} SOL</span>}
      {sample?.medianRoi!=null&&<span className="sm-chip">{t('medianRoi')} {f.percent(sample.medianRoi)}</span>}
     </span>}
     <QualificationBadge value={w.qualification}/>
     {w.flowSuitable&&<span className="sm-chips"><span className="sm-chip">{t('flowSuitable')}</span></span>}
     {!w.flowSuitable&&w.flowReasons?.length?<small>{t('flowNotSuitable')}: {w.flowReasons.map(reason=>t(`flowIssues.${reason}`)).join(', ')}</small>:null}
    </div>,
    <ReviewForm key="review" api={api} address={w.address} queryKey={queryKey}/>,
   ]};
  })}/>}
  <Pager page={walletPage.page} previous={walletPage.previous} next={()=>walletPage.next(wallets.data?.nextCursor??null)} canNext={!wallets.isFetching&&!!wallets.data?.nextCursor}/>
 </>;
}
function ReviewForm({api,address,queryKey,candidate=false}:{api:AdminApi;address:string;queryKey:readonly unknown[];candidate?:boolean}){
 const t=useTranslations('workspace.smartResearch'),client=useQueryClient(),[status,setStatus]=useState<'APPROVED'|'REJECTED'|'PROVISIONAL'>('PROVISIONAL'),[reason,setReason]=useState('');
 const mutation=useMutation({mutationFn:async()=>{if(candidate)await api.reviewCandidate(address,status==='APPROVED'?'approve':'reject',reason.trim());else await api.reviewResearch(address,status,reason.trim());},onSuccess:()=>client.invalidateQueries({queryKey})});
 return <form className="admin-form" onSubmit={e=>{e.preventDefault();if(reason.trim()&&(!candidate||status!=='PROVISIONAL'))mutation.mutate();}}><label>{t('decision')}<select value={status} onChange={e=>{mutation.reset();setStatus(e.target.value as typeof status);}}><option value="PROVISIONAL">{t('PROVISIONAL')}</option><option value="APPROVED">{t('approve')}</option><option value="REJECTED">{t('reject')}</option></select></label><label>{t('reason')}<input maxLength={300} value={reason} onChange={e=>{mutation.reset();setReason(e.target.value);}}/></label><button type="submit" className="research-control admin-primary" disabled={mutation.isPending||!reason.trim()||(candidate&&status==='PROVISIONAL')}>{t('save')}</button>{mutation.isSuccess&&<p role="status">{t('saved')}</p>}{mutation.isError&&<p role="alert">{t('saveError')}</p>}</form>;
}
