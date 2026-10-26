'use client';
import {useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {useTranslations} from 'next-intl';
import type {AdminApi} from './api';
import {QualificationBadge} from '@/features/research/wallet-research';
import {Loading,ResourceError,DataTable,Facts,Pager,useFormat} from '@/features/research/ui';
import {usePagination} from '@/features/research/pagination';

export function WalletResearchCard({api,queryKey}:{api:AdminApi;queryKey:readonly unknown[]}){
 const t=useTranslations('workspace.smartResearch'),[open,setOpen]=useState(false);
 return <section className="admin-card admin-wide"><h2>{t('adminTitle')}</h2><p>{t('adminHelp')}</p><button className="research-control" aria-expanded={open} onClick={()=>setOpen(!open)}>{t('reviewPanel')}</button>{open&&<ReviewPanel api={api} queryKey={queryKey}/>}</section>;
}
function ReviewPanel({api,queryKey}:{api:AdminApi;queryKey:readonly unknown[]}){
 const t=useTranslations('workspace.smartResearch'),f=useFormat(),walletPage=usePagination(),candidatePage=usePagination();
 const health=useQuery({queryKey:[...queryKey,'health'],queryFn:()=>api.researchHealth(),retry:false});
 const wallets=useQuery({queryKey:[...queryKey,'wallets',walletPage.cursor],queryFn:()=>api.researchWallets(walletPage.cursor??undefined),retry:false});
 const candidates=useQuery({queryKey:[...queryKey,'candidates',candidatePage.cursor],queryFn:()=>api.walletCandidates(candidatePage.cursor??undefined),retry:false});
 const refresh=()=>{void health.refetch();void wallets.refetch();void candidates.refetch();};
 const d=health.data?.discovery,w=health.data?.wallets,s=health.data?.tokenScans;
 return <><button className="research-control" onClick={refresh}>{t('refresh')}</button>{health.isError&&<ResourceError error={health.error} retry={()=>void health.refetch()}/>}
 {health.data&&<p>{t(health.data.enabled?'enabled':'disabled')}</p>}{w&&<Facts items={[{label:t('activeWallets'),value:f.number(w.active,0)},{label:t('discoveredWallets'),value:f.number(w.discovered,0)},{label:t('approvedWallets'),value:f.number(w.approved,0)}]}/>}{d&&<><p>{t('discovery')} · {f.date(d.checkedAt)}</p><Facts items={(['completeScans','noPrice','stalePrice','insufficientObservations','tokensJudged','winners','candidates','emerging'] as const).map(k=>({label:t(k),value:f.number(d[k],0)}))}/></>}
 {s&&s.length>0&&<><h3>{t('tokenScans')}</h3><Facts items={[{label:t('scanNewWallets'),value:f.number(s.reduce((sum,x)=>sum+x.newWallets,0),0)},{label:t('scanStoredSwaps'),value:f.number(s.reduce((sum,x)=>sum+x.createdTrades,0),0)}]}/><p>{s[0]!.status}{s[0]!.error?` · ${s[0]!.error}`:''} · {f.date(s[0]!.checkedAt)}</p></>}
 <h3>{t('wallets')}</h3>{wallets.isError?<ResourceError error={wallets.error} retry={()=>void wallets.refetch()}/>:wallets.isPending?<Loading/>:<DataTable caption={t('wallets')} headers={[t('wallet'),t('qualification'),t('review')]} rows={wallets.data.items.map(w=>({key:w.address,cells:[<span key="address">{w.label}<small>{w.address}</small><small>{w.source} · {w.researchReview}</small></span>,<QualificationBadge key="qualified" value={w.qualification}/>,<ReviewForm key="review" api={api} address={w.address} queryKey={queryKey}/>]}))}/>}
 <Pager page={walletPage.page} previous={walletPage.previous} next={()=>walletPage.next(wallets.data?.nextCursor??null)} canNext={!wallets.isFetching&&!!wallets.data?.nextCursor}/>
 <h3>{t('candidates')}</h3><p>{t('candidateNote')}</p>{candidates.isError?<ResourceError error={candidates.error} retry={()=>void candidates.refetch()}/>:candidates.isPending?<Loading/>:<DataTable caption={t('candidates')} headers={[t('wallet'),t('evidence'),t('review')]} rows={candidates.data.items.map(c=>({key:c.address,cells:[c.address,<div key="evidence">{t('winnerCount',{count:c.winnerTokens})} · {f.number(c.score,1)}<small>{f.date(c.evidence?.checkedAt)}</small><ul>{c.evidence?.winnerMints?.map(m=><li key={m}><a href={`https://solscan.io/token/${encodeURIComponent(m)}`} target="_blank" rel="noopener noreferrer">{m}</a></li>)}</ul></div>,<ReviewForm key="review" api={api} address={c.address} queryKey={queryKey} candidate/>]}))}/>}
 <Pager page={candidatePage.page} previous={candidatePage.previous} next={()=>candidatePage.next(candidates.data?.nextCursor??null)} canNext={!candidates.isFetching&&!!candidates.data?.nextCursor}/></>;
}
function ReviewForm({api,address,queryKey,candidate=false}:{api:AdminApi;address:string;queryKey:readonly unknown[];candidate?:boolean}){
 const t=useTranslations('workspace.smartResearch'),client=useQueryClient(),[status,setStatus]=useState<'APPROVED'|'REJECTED'|'PROVISIONAL'>('PROVISIONAL'),[reason,setReason]=useState('');
 const mutation=useMutation({mutationFn:async()=>{if(candidate)await api.reviewCandidate(address,status==='APPROVED'?'approve':'reject',reason.trim());else await api.reviewResearch(address,status,reason.trim());},onSuccess:()=>client.invalidateQueries({queryKey})});
 return <form className="admin-form" onSubmit={e=>{e.preventDefault();if(reason.trim()&&(!candidate||status!=='PROVISIONAL'))mutation.mutate();}}><label>{t('decision')}<select value={status} onChange={e=>{mutation.reset();setStatus(e.target.value as typeof status);}}><option value="PROVISIONAL">{t('PROVISIONAL')}</option><option value="APPROVED">{t('approve')}</option><option value="REJECTED">{t('reject')}</option></select></label><label>{t('reason')}<input maxLength={300} value={reason} onChange={e=>{mutation.reset();setReason(e.target.value);}}/></label><button type="submit" className="research-control admin-primary" disabled={mutation.isPending||!reason.trim()||(candidate&&status==='PROVISIONAL')}>{t('save')}</button>{mutation.isSuccess&&<p role="status">{t('saved')}</p>}{mutation.isError&&<p role="alert">{t('saveError')}</p>}</form>;
}
