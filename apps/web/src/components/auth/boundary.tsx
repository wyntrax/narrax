'use client';
import dynamic from 'next/dynamic';
import {useTranslations} from 'next-intl';
import {Component, useEffect, useState, type ReactNode} from 'react';
import {QueryProvider} from '@/lib/queries';
import {Skeleton} from '@/components/ui/primitives';
function AuthLoading(){const [timedOut,setTimedOut]=useState(false);const t=useTranslations('common');useEffect(()=>{const timer=setTimeout(()=>setTimedOut(true),10000);return()=>clearTimeout(timer);},[]);return timedOut?<div className="card access-card" role="alert"><p>{t('errorBody')}</p><button className="button button-ghost" onClick={()=>window.location.reload()}>{t('retry')}</button></div>:<Skeleton/>;}
const Privy = dynamic(() => import('./privy'), {ssr:false, loading: AuthLoading});
class ProviderError extends Component<{children:ReactNode; fallback:ReactNode}, {failed:boolean}> {state={failed:false}; static getDerivedStateFromError(){return {failed:true};} render(){return this.state.failed ? this.props.fallback : this.props.children;}}
export function AuthBoundary({children}: {children: ReactNode}) {const t = useTranslations('auth'); return <QueryProvider>{!process.env.NEXT_PUBLIC_PRIVY_APP_ID ? <div className="card access-card" role="status"><h2>{t('notConfigured')}</h2><p>{t('configure')}</p></div> : <ProviderError fallback={<div className="card access-card" role="alert"><h2>{t('unavailable')}</h2><p>{t('reload')}</p></div>}><Privy>{children}</Privy></ProviderError>}</QueryProvider>;}
