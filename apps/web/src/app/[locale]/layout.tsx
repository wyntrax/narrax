import type {ReactNode} from 'react';
import type {Metadata} from 'next';
import {Rajdhani, Barlow} from 'next/font/google';
import {NextIntlClientProvider, hasLocale} from 'next-intl';
import {getMessages, getTranslations} from 'next-intl/server';
import {cookies} from 'next/headers';
import {notFound} from 'next/navigation';
import {routing} from '@/i18n/routing';
import {siteOrigin} from '@/config/site';
import {searchIndexable} from '@/lib/seo';
import '../globals.css';
const display = Rajdhani({subsets: ['latin'], weight: ['600', '700'], variable: '--font-display', display: 'swap'});
const body = Barlow({subsets: ['latin'], weight: ['400', '600'], variable: '--font-body', display: 'swap'});
export async function generateMetadata({params}:{params:Promise<{locale:string}>}):Promise<Metadata>{
  const {locale}=await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const google = process.env.NARRA_GOOGLE_SITE_VERIFICATION;
  const bing = process.env.NARRA_BING_SITE_VERIFICATION;
  return {metadataBase:new URL(siteOrigin()),title:{default:'Narrax — Solana Research',template:'%s | Narrax'},applicationName:'Narrax',
    icons:{icon:[{url:'/favicon.ico',sizes:'32x32'},{url:'/favicon.svg',type:'image/svg+xml'}]},
    robots:{index:searchIndexable(),follow:true},
    verification:{...(google?{google}:{}),...(bing?{other:{'msvalidate.01':bing}}:{})},
  };
}
export default async function Layout({children, params}: {children: ReactNode; params: Promise<{locale: string}>}) {
  const {locale} = await params; if (!hasLocale(routing.locales, locale)) notFound();
  const theme = (await cookies()).get('NARRA_THEME')?.value === 'light' ? 'light' : 'dark';
  const messages = await getMessages(), t = await getTranslations('common');
  return <html lang={locale} data-theme={theme} className={`${display.variable} ${body.variable}`}><body><a className="skip-link" href="#main">{t('skip')}</a><NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider></body></html>;
}
