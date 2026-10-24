'use client';
import {createContext,useContext,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {useQuery} from '@tanstack/react-query';
import type {z} from 'zod';
import {useTranslations} from 'next-intl';
import {useAuth,type AuthAdapter} from '@/components/auth/context';
import {QueryProvider} from '@/lib/queries';
import {EntitlementsSchema,type Entitlements} from '@/lib/schemas';
import {Link} from '@/i18n/navigation';
import {BrandMark} from '@/components/brand-mark';
import {scheduleRefresh} from '@/features/access/refresh';
import {createResearchApi,createResearchDownload,createResearchWriter,RESEARCH_STALE_MS} from './api';
import {ResearchShell} from './shell';
import {GateShell,SignInGate} from './gate';
import {PageLoader} from '@/components/page-loader';
import {ResourceError} from './ui';

type Session={read:ReturnType<typeof createResearchApi>;send:ReturnType<typeof createResearchWriter>;download:(path:string)=>Promise<string>;access:Entitlements;userId:string;refreshAccess:()=>void};
const ResearchContext=createContext<Session|null>(null);
export function useResearch(){const value=useContext(ResearchContext);if(!value)throw Error('Research session missing');return value;}
export function useResearchQuery<T>(path:string,schema:z.ZodType<T>,enabled=true,refetchInterval:number|false=false){
 const {read,userId}=useResearch();
  return useQuery({queryKey:['research',userId,path],queryFn:({signal})=>read(path,schema,signal),enabled,retry:false,gcTime:0,staleTime:RESEARCH_STALE_MS,refetchOnWindowFocus:true,refetchInterval});
}
export function hasFeature(access:Entitlements,key:string){const feature=access.features[key];return feature!==undefined&&(access.admin===true||feature.allowed===true);}
export function ResearchWorkspace({children,theme}:{children:ReactNode;theme:string}){
 const auth=useAuth();
 // Remount the entire data scope on sign-out/account changes. No previous-user data is retained.
 return <QueryProvider key={JSON.stringify([auth.ready,auth.authenticated,auth.userId])}><SessionGate auth={auth} theme={theme}>{children}</SessionGate></QueryProvider>;
}
const SESSION_WAIT_MS=30000;
function SessionRecovery({auth,theme}:{auth:AuthAdapter;theme:string}){
 const t=useTranslations('workspace'),[resetting,setResetting]=useState(false),[failed,setFailed]=useState(false);
 async function reset(){setResetting(true);setFailed(false);try{await auth.logout();window.location.reload();}catch{setFailed(true);setResetting(false);}}
 return <GateShell theme={theme}><BrandMark className="gate-mark"/><h1>NARRAX</h1><p role="alert">{t('authRecovery.timeout')}</p><button type="button" className="button button-primary" onClick={()=>window.location.reload()}>{t('authRecovery.reload')}</button>{auth.ready&&auth.authenticated&&<button type="button" className="button button-ghost" disabled={resetting} onClick={()=>void reset()}>{t('authRecovery.reset')}</button>}{failed&&<p role="alert">{t('authRecovery.failed')}</p>}<Link className="gate-link" href="/early-access">{t('access')}</Link></GateShell>;
}
function SessionGate({auth,children,theme}:{auth:AuthAdapter;children:ReactNode;theme:string}){
 const [timedOut,setTimedOut]=useState(false),[rechecking,setRechecking]=useState(false);
 const token=useRef(auth.getAccessToken);token.current=auth.getAccessToken;
 const identity=useRef(auth.getIdentityToken);identity.current=auth.getIdentityToken;
 const read=useMemo(()=>createResearchApi(()=>token.current(),undefined,undefined,()=>identity.current?.()??Promise.resolve(null)),[]);
 const send=useMemo(()=>createResearchWriter(()=>token.current(),undefined,undefined,()=>identity.current?.()??Promise.resolve(null)),[]);
 const download=useMemo(()=>createResearchDownload(()=>token.current(),undefined,undefined,()=>identity.current?.()??Promise.resolve(null)),[]);
 const userId=auth.ready&&auth.authenticated?auth.userId:null;
 const query=useQuery({queryKey:['workspace-access',userId],queryFn:({signal})=>read('me/entitlements',EntitlementsSchema,signal),enabled:!!userId,retry:false,gcTime:0,staleTime:0,refetchInterval:60000,refetchOnWindowFocus:true});
 const refresh=()=>{setRechecking(true);void query.refetch().finally(()=>setRechecking(false));};
 const waiting=!auth.ready||auth.authenticated&&!userId;
 // Time only provider/session initialization, not time spent choosing a login method.
 // Keep observing the SDK after the deadline so late recovery opens the workspace.
 useEffect(()=>{setTimedOut(false);if(!waiting)return;const timer=setTimeout(()=>setTimedOut(true),SESSION_WAIT_MS);return()=>clearTimeout(timer);},[waiting]);
 useEffect(()=>{if(!query.data?.nextExpiry)return;return scheduleRefresh(query.data.nextExpiry,()=>{setRechecking(true);void query.refetch().finally(()=>setRechecking(false));});
 // Re-arm only after an authoritative access snapshot, not each render.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[query.data?.nextExpiry,query.dataUpdatedAt]);
 if(waiting)return timedOut?<SessionRecovery auth={auth} theme={theme}/>:<PageLoader/>;
 if(!auth.authenticated)return <GateShell theme={theme}><SignInGate onLogin={auth.login}/></GateShell>;
 if(query.isError)return <GateShell theme={theme}><ResourceError error={query.error} retry={refresh}/></GateShell>;
 if(query.isPending||!query.data||rechecking)return <PageLoader/>;
 const access=query.data;
 const version=JSON.stringify([userId,access.effectiveTier,access.admin,access.features,access.rollout,access.nextExpiry]);
 return <QueryProvider key={version}><ResearchContext.Provider value={{read,send,download,access,userId:userId!,refreshAccess:refresh}}><ResearchShell theme={theme}>{children}</ResearchShell></ResearchContext.Provider></QueryProvider>;
}
