'use client';
import {useTranslations} from 'next-intl';
import {useMemo} from 'react';
import {createApi} from '@/lib/api';
import {usePublicStatus} from '@/lib/queries';
export function Availability(){const t=useTranslations('flow');const api=useMemo(()=>createApi(process.env.NEXT_PUBLIC_API_URL??'',async()=>null),[]);const query=usePublicStatus(api);const value=query.data;return <div className="seats-chip" role="status">{query.isError?t('statusUnavailable'):!value?t('seatsUnknown'):!value.enabled?t('states.disabled.title'):value.inviteRequired?t('states.inviteOnly.title'):value.seatsLeft===0?t('states.full.title'):value.seatsLeft===null?t('seatsUnknown'):t('seats',{count:value.seatsLeft})}{query.isError&&<button className="locale-toggle" onClick={()=>void query.refetch()}>{t('refresh')}</button>}</div>;}
