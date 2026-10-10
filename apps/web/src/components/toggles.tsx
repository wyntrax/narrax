'use client';
import {useLocale, useTranslations} from 'next-intl';
import {usePathname, useRouter} from '@/i18n/navigation';
import {useState} from 'react';
import {Moon, Sun} from 'lucide-react';
export function ThemeToggle({initial}: {initial: string}) {const [theme, setTheme] = useState(initial); const t = useTranslations('common'); return <button className="icon-button" aria-label={t('theme')} onClick={() => {const next = theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = next; document.cookie = `NARRA_THEME=${next}; Path=/; Max-Age=31536000; SameSite=Lax`; setTheme(next);}}>{theme === 'dark' ? <Sun size={18}/> : <Moon size={18}/>}</button>;}
export function LocaleToggle() {const locale = useLocale(), router = useRouter(), pathname = usePathname(); const t = useTranslations('common'); return <button className="locale-toggle" lang={locale === 'en' ? 'id' : 'en'} onClick={() => router.replace(pathname, {locale: locale === 'en' ? 'id' : 'en'})}>{t('otherLanguage')}</button>;}
