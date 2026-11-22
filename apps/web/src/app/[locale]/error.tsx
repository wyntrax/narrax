'use client';
import {useTranslations} from 'next-intl';
import {Button} from '@/components/ui/button';
import {BrandMark} from '@/components/brand-mark';
import {Link} from '@/i18n/navigation';

export default function ErrorPage({reset}: {reset: () => void}) {
  const t = useTranslations('common');
  return (
    <main id="main" className="page-center">
      <div className="error-page-card">
        <BrandMark />
        <h1>{t('error')}</h1>
        <p>{t('errorBody')}</p>
        <div className="actions">
          <Button onClick={reset}>{t('retry')}</Button>
          <Link className="button button-ghost" href="/" prefetch={false}>
            {t('home')}
          </Link>
        </div>
      </div>
    </main>
  );
}
