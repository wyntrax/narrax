import {getTranslations} from 'next-intl/server';
import {AuthBoundary} from '@/components/auth/boundary';
import {AccessFlow} from '@/features/access/controller';
export default async function EarlyAccess(){const t=await getTranslations('access');return <main id="main" className="access-page container"><div className="access-heading"><h1>{t('headline')}</h1><p>{t('subcopy')}</p></div><AuthBoundary><AccessFlow/></AuthBoundary></main>;}
