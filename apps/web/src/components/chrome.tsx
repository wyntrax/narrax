import {getTranslations} from 'next-intl/server';
import {Link} from '@/i18n/navigation';
import {cookies} from 'next/headers';
import {ThemeToggle, LocaleToggle} from './toggles';
import {MarketingNavigation} from './marketing/navigation';
export async function Header() {const t = await getTranslations('common'),d=await getTranslations('design'); const theme = (await cookies()).get('NARRA_THEME')?.value === 'light' ? 'light' : 'dark'; return <header className="site-header"><Link href="/" prefetch={false} className="brand" aria-label={t('home')}><span className="brand-mark" aria-hidden>n</span><span>NARRA</span></Link><nav aria-label={t('navigation')}><MarketingNavigation/><LocaleToggle/><ThemeToggle initial={theme}/><Link className="button button-primary header-cta" prefetch={false} href="/early-access">{d('earlyAccess')} ↗</Link></nav></header>;}
export async function Footer() {const t = await getTranslations('common'); return <footer className="site-footer"><div className="footer-wordmark">NARRA<span aria-hidden>↗</span></div><p>{t('disclaimer')}</p><p>{t('privacy')}</p><div className="footer-bottom"><span>{t('research')}</span><Link href="/early-access">{t('getAccess')} ↗</Link></div></footer>;}
