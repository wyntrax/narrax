'use client';
import {useTranslations} from 'next-intl';
import {useMemo,useEffect,useRef,useState} from 'react';
import {useAuth,type AuthAdapter} from './context';
import {useEntitlements} from '@/lib/queries';
import {createApi} from '@/lib/api';
import {Link} from '@/i18n/navigation';
import {Skeleton} from '@/components/ui/primitives';
export const APP_TIMEOUT_MS=10000;
export function AppPlaceholder(){
 const auth=useAuth();
 return <Placeholder key={JSON.stringify([auth.ready,auth.authenticated,auth.userId])} auth={auth}/>;
}
function Placeholder({auth}:{auth:AuthAdapter}){
 const t=useTranslations('common'),[timedOut,setTimedOut]=useState(false);
 const tokenRef=useRef(auth.getAccessToken);tokenRef.current=auth.getAccessToken;
 useEffect(()=>{const timer=setTimeout(()=>setTimedOut(true),APP_TIMEOUT_MS);return()=>clearTimeout(timer);},[]);
 const api=useMemo(()=>createApi(process.env.NEXT_PUBLIC_API_URL??'',()=>tokenRef.current()),[]);
 const userId=auth.ready&&auth.authenticated?auth.userId:null;
 const query=useEntitlements(api,userId);
 if((!auth.ready||auth.authenticated&&(!userId||query.isPending))&&!timedOut)return <Skeleton/>;
 return <><h1>NARRAX</h1>{userId&&query.data&&query.data.effectiveTier!=='NONE'?<p>{t('coming')}</p>:<Link className="button button-primary" href="/early-access">{t('getAccess')}</Link>}</>;
}
