'use client';
import {useTranslations} from 'next-intl';
import {Button} from '@/components/ui/button';
export default function ErrorPage({reset}: {reset: () => void}) {const t = useTranslations('common'); return <main id="main" className="page-center"><h1>{t('error')}</h1><p>{t('errorBody')}</p><Button onClick={reset}>{t('retry')}</Button></main>;}
