'use client';
import {useState} from 'react';
import {useMutation,useQueryClient} from '@tanstack/react-query';
import {useTranslations} from 'next-intl';
import {z} from 'zod';
import {Bell,CheckCheck,ShieldAlert,Eye,Info} from 'lucide-react';
import {useResearch,useResearchQuery} from './session';
import {AlertsSchema,MarkedSchema,alertPriorities,type AlertItem} from './contracts';
import {pagePath} from './api';
import {usePagination} from './pagination';
import {PageHeading,Loading,ResourceError,Empty,Pager,useFormat} from './ui';
import {Link} from '@/i18n/navigation';
import {TokenIdentity} from './token-identity';

const ReadSchema=z.object({id:z.string(),read:z.boolean()});
/** The signed-in user's own notifications. Titles and bodies were sanitized when stored and are still rendered as text. */
export function AlertsPage(){
 const t=useTranslations('workspace'),[unread,setUnread]=useState(false),[min,setMin]=useState('');
 return <><PageHeading title={t('alerts')} body={t('alertsBody')}/>
  <div className="research-filters"><label><input type="checkbox" checked={unread} onChange={e=>setUnread(e.target.checked)}/> {t('alUnreadOnly')}</label>
   <label>{t('alMinPriority')}<select value={min} onChange={e=>setMin(e.target.value)}><option value="">{t('alAll')}</option>{alertPriorities.map(p=><option key={p} value={p}>{t(`alPriority.${p}`)}</option>)}</select></label></div>
  {/* A new filter is a new list: the key resets paging so an old cursor is never reused with different filters. */}
  <AlertList key={`${unread}:${min}`} unread={unread} min={min}/></>;
}
function AlertList({unread,min}:{unread:boolean;min:string}){
 const t=useTranslations('workspace'),f=useFormat(),paging=usePagination(),{send,userId}=useResearch(),client=useQueryClient();
 const filters:Record<string,string>={...(unread?{unread:'true'}:{}),...(min?{minPriority:min}:{})};
  const query=useResearchQuery(pagePath('alerts',filters,paging.cursor),AlertsSchema,true,30000);
 const refresh=()=>client.invalidateQueries({queryKey:['research',userId]});
 const markOne=useMutation({mutationFn:(id:string)=>send(`alerts/${encodeURIComponent(id)}/read`,ReadSchema,'POST'),onSuccess:refresh});
 const markAll=useMutation({mutationFn:()=>send('alerts/read-all',MarkedSchema,'POST',min?{minPriority:min}:{}),onSuccess:refresh});
  return <div className="alerts-inbox" aria-busy={query.isFetching}>
   <div className="alerts-toolbar">{query.data&&<p className="alerts-unread-count" role="status"><Bell size={18} aria-hidden="true"/>{t('alUnread',{count:query.data.unreadCount})}</p>}
    <div className="actions"><button className="research-control" disabled={query.isFetching} onClick={()=>void query.refetch()}>{t('refresh')}</button><button className="research-control" disabled={markAll.isPending||!query.data?.unreadCount} onClick={()=>markAll.mutate()}><CheckCheck size={16} aria-hidden="true"/> {t('alMarkAll')}</button></div></div>
  {(markOne.isError||markAll.isError)&&<p role="alert" className="admin-bad">{t('alFailed')}</p>}
  {query.isError?<ResourceError error={query.error} retry={()=>void query.refetch()}/>:query.isPending?<Loading/>:!query.data.items.length?<Empty body={t('alEmpty')}/>:
    <ul className="alert-list">{query.data.items.map((a:AlertItem)=>{const Icon=a.priority==='CRITICAL'||a.priority==='IMPORTANT'?ShieldAlert:a.priority==='WATCH'?Eye:Info;return <li key={a.id} data-priority={a.priority} className={a.readAt?'alert-row':'alert-row alert-unread'}>
     <div className="alert-card-heading"><span className="alert-icon"><Icon size={20} aria-hidden="true"/></span><span className="alert-priority">{t(`alPriority.${a.priority}`)}</span><small className="alert-kind">{a.kind.replaceAll('_',' ')}</small>{!a.readAt&&<span className="alert-unread-dot" aria-label={t('alUnreadOnly')}/>}</div>
     {a.token&&<Link className="alert-token" href={`/app/tokens/${encodeURIComponent(a.token.mint)}`}><TokenIdentity {...a.token} compact/></Link>}
     <h2>{a.title}</h2><p>{a.body}</p>
     <div className="alert-foot"><time dateTime={a.createdAt}>{f.date(a.createdAt)}</time>{!a.readAt&&<button className="research-control" disabled={markOne.isPending} onClick={()=>markOne.mutate(a.id)}>{t('alMarkRead')}</button>}</div></li>;})}</ul>}
   <Pager page={paging.page} previous={paging.previous} next={()=>paging.next(query.data?.nextCursor??null)} canNext={!query.isFetching&&!query.isError&&!!query.data?.nextCursor}/></div>;
}
