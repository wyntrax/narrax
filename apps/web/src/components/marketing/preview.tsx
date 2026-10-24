'use client';
import {useTranslations} from 'next-intl';
import {Link} from '@/i18n/navigation';
export default function Preview() {
  const t=useTranslations('liveResearch');
  return <div className="preview live-research-entry"><div className="preview-bar"><span>NARRAX / {t('title')}</span></div><div className="live-research-body"><h3>{t('headline')}</h3><p>{t('body')}</p><Link className="button button-primary" href="/app/radar">{t('openRadar')} ↗</Link><Link className="button button-ghost" href="/app">{t('openOverview')} ↗</Link><p className="preview-caption">{t('note')}</p></div></div>;
}
