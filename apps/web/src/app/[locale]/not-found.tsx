import {getTranslations} from 'next-intl/server';
import {Link} from '@/i18n/navigation';
export default async function NotFound() {const t = await getTranslations('common'); return <main id="main" className="page-center"><h1>{t('notFound')}</h1><Link className="button button-primary" href="/">{t('home')}</Link></main>;}
