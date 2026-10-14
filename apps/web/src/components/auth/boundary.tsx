'use client';
import dynamic from 'next/dynamic';
import {useTranslations} from 'next-intl';
import {Component, createContext, useContext, useEffect, useState, type ReactNode} from 'react';
import {QueryProvider} from '@/lib/queries';
import {PageLoader} from '@/components/page-loader';
import {GateShell} from '@/features/research/gate';
import {Availability} from '@/features/access/availability';
import {fetchPrivyAppId} from './public-config';
const FallbackLandmark=createContext(false);
function Fallback({children}:{children:ReactNode}){return useContext(FallbackLandmark)?<GateShell>{children}</GateShell>:children;}
function Panel({role,children}:{role:'status'|'alert';children:ReactNode}){return useContext(FallbackLandmark)?<div role={role} className="gate-message">{children}</div>:<div className="card access-card" role={role}>{children}</div>;}
function AuthLoading(){const [timedOut,setTimedOut]=useState(false);const t=useTranslations('common'),landmark=useContext(FallbackLandmark);useEffect(()=>{const timer=setTimeout(()=>setTimedOut(true),10000);return()=>clearTimeout(timer);},[]);if(!timedOut)return <PageLoader landmark={landmark}/>;return <Fallback><Panel role="alert"><p>{t('errorBody')}</p><button className="button button-ghost" onClick={()=>window.location.reload()}>{t('retry')}</button></Panel></Fallback>;}
const Privy = dynamic(() => import('@/components/auth/privy'), {ssr:false, loading: AuthLoading});
class ProviderError extends Component<{children:ReactNode; fallback:ReactNode}, {failed:boolean}> {state={failed:false}; static getDerivedStateFromError(){return {failed:true};} render(){return this.state.failed ? this.props.fallback : this.props.children;}}
export function AuthBoundary({children,landmark=false}: {children: ReactNode;landmark?:boolean}) {
  const t = useTranslations('auth'), [config,setConfig] = useState<{appId:string} | {error:true} | null>(null);
  useEffect(() => {const controller=new AbortController(); void fetchPrivyAppId(controller.signal).then(appId=>{if(!controller.signal.aborted)setConfig({appId});},()=>{if(!controller.signal.aborted)setConfig({error:true});}); return()=>controller.abort();},[]);
  const error = <Fallback><Panel role="alert"><h2>{t('unavailable')}</h2><p>{t('configError')}</p><button type="button" className="button button-ghost" onClick={()=>window.location.reload()}>{t('retry')}</button></Panel></Fallback>;
  return <QueryProvider><FallbackLandmark.Provider value={landmark}><Availability/>{!config ? <PageLoader landmark={landmark}/> : 'error' in config ? error : !config.appId ? <Fallback><Panel role="status"><h2>{t('notConfigured')}</h2><p>{t('configure')}</p></Panel></Fallback> : <ProviderError key={config.appId} fallback={error}><Privy appId={config.appId}>{children}</Privy></ProviderError>}</FallbackLandmark.Provider></QueryProvider>;
}
