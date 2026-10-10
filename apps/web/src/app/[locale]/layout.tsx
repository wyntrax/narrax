import type {ReactNode} from 'react';
import {Rajdhani, Barlow} from 'next/font/google';
import {NextIntlClientProvider, hasLocale} from 'next-intl';
import {getMessages, getTranslations} from 'next-intl/server';
import {cookies} from 'next/headers';
import {notFound} from 'next/navigation';
import {routing} from '@/i18n/routing';
import '../globals.css';
const display = Rajdhani({subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-display', display: 'swap'});
const body = Barlow({subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-body', display: 'swap'});
export default async function Layout({children, params}: {children: ReactNode; params: Promise<{locale: string}>}) {
  const {locale} = await params; if (!hasLocale(routing.locales, locale)) notFound();
  const theme = (await cookies()).get('NARRA_THEME')?.value === 'light' ? 'light' : 'dark';
  const messages = await getMessages(), t = await getTranslations('common');
  return <html lang={locale} data-theme={theme} className={`${display.variable} ${body.variable}`}><body><a className="skip-link" href="#main">{t('skip')}</a><NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider></body></html>;
}
