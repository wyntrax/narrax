import {defineRouting} from 'next-intl/routing';
export const routing = defineRouting({locales: ['en', 'id'], defaultLocale: 'en', localePrefix: 'as-needed', localeDetection: false, localeCookie: {name: 'NARRA_LOCALE', maxAge: 31536000}});
