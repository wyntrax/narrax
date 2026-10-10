'use client';
import {useTranslations} from 'next-intl';
import {useMemo} from 'react';
import {useAuth} from './context';
import {useEntitlements} from '@/lib/queries';
import {createApi} from '@/lib/api';
import {Link} from '@/i18n/navigation';
import {Skeleton} from '@/components/ui/primitives';
export function AppPlaceholder(){const auth=useAuth(),t=useTranslations('common');const api=useMemo(()=>createApi(process.env.NEXT_PUBLIC_API_URL??'',auth.getAccessToken),[auth.getAccessToken]);const query=useEntitlements(api,auth.userId);if(!auth.ready||auth.authenticated&&query.isPending)return <Skeleton/>;return <><h1>NARRA</h1>{auth.authenticated&&query.data?.effectiveTier!=='NONE'&&query.data?<p>{t('coming')}</p>:<Link className="button button-primary" href="/early-access">{t('getAccess')}</Link>}</>;}
