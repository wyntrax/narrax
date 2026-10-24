import {useTranslations} from 'next-intl';
import {BrandMark} from '@/components/brand-mark';
import './page-loader.css';

// One loading state for every wait before the page is usable: route load, auth provider load and session check.
// landmark=true is a full-screen <main>; landmark=false is a compact block for use inside an existing <main>.
export function PageLoader({landmark=true}:{landmark?:boolean}) {
  const t = useTranslations('common');
  const body = <>
    {landmark && <div className="route-loader-grid" aria-hidden="true"/>}
    <BrandMark className="route-loader-mark"/>
    <span className="route-loader-bar" aria-hidden="true"/>
    <p role="status">{t('loading')}</p>
  </>;
  return landmark
    ? <main id="main" className="route-loader" tabIndex={-1}>{body}</main>
    : <div className="route-loader route-loader-inline">{body}</div>;
}
