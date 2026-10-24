import {getTranslations,getLocale} from 'next-intl/server';
import {researchCopy} from '@/content/research-guides';
import {seoLocale} from '@/lib/seo';
import {Link} from '@/i18n/navigation';
import {cookies} from 'next/headers';
import {ThemeToggle, LocaleToggle} from './toggles';
import {MarketingNavigation} from './marketing/navigation';
import {BrandMark} from './brand-mark';
import {PoweredBy} from './powered-by';
export async function Header() {const t = await getTranslations('common'),d=await getTranslations('design'); return <header className="site-header"><Link href="/" prefetch={false} className="brand" aria-label={t('home')}><BrandMark/><span>NARRAX</span></Link><nav aria-label={t('navigation')}><MarketingNavigation/><Link className="button button-primary header-cta" prefetch={false} href="/early-access">{d('earlyAccess')} ↗</Link></nav></header>;}
export async function Footer() {const t = await getTranslations('common'),copy=researchCopy[seoLocale(await getLocale())]; const theme = (await cookies()).get('NARRA_THEME')?.value === 'light' ? 'light' : 'dark'; return <footer className="site-footer"><div className="footer-wordmark"><BrandMark/>NARRAX<span aria-hidden>↗</span></div><p>{t('disclaimer')}</p><p>{t('privacy')}</p><nav className="footer-research-links" aria-label={copy.guides}><Link href="/research">{copy.guides}</Link><Link href="/methodology">{copy.methodology}</Link></nav><div className="footer-bottom"><span>{t('research')}</span><PoweredBy/><div className="footer-end"><Link href="/early-access">{t('getAccess')} ↗</Link><div className="footer-controls"><LocaleToggle/><ThemeToggle initial={theme}/></div></div></div></footer>;}
