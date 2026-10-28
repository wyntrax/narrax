import type {Metadata} from 'next';
import {siteOrigin} from '@/config/site';
import {socialImageUrl} from './social-preview';

export const SEO_LOCALES = ['en', 'id'] as const;
export type SeoLocale = typeof SEO_LOCALES[number];
export function seoLocale(value: string): SeoLocale { return value === 'id' ? 'id' : 'en'; }
export function localizedPath(locale: SeoLocale, path = '') {
  return `${locale === 'id' ? '/id' : ''}${path === '/' ? '' : path}` || '/';
}
export function publicUrl(locale: SeoLocale, path = '') {
  const localized = localizedPath(locale, path);
  return localized === '/' ? siteOrigin() : new URL(localized, `${siteOrigin()}/`).href;
}
/** Explicit opt-in: preview hosts must never publish production indexing signals. */
export function searchIndexable() {
  const url = new URL(siteOrigin());
  return process.env.NARRA_SEO_INDEXABLE === 'true' && url.protocol === 'https:' &&
    !/^(localhost|127\.|0\.|\[?::1\]?)/i.test(url.hostname) && !url.hostname.endsWith('.localhost');
}
export function languageAlternates(path = '') {
  return {en: publicUrl('en', path), id: publicUrl('id', path), 'x-default': publicUrl('en', path)};
}
export function pageMetadata(locale: SeoLocale, path: string, title: string, description: string, kind: 'website' | 'article' = 'website'): Metadata {
  const url = publicUrl(locale, path);
  const image = {url: socialImageUrl(siteOrigin(), locale, path), width: 1200, height: 630, type: 'image/png', alt: `${title} | Narrax`};
  return {
    title, description,
    alternates: {canonical: url, languages: languageAlternates(path)},
    robots: {index: searchIndexable(), follow: true, googleBot: {index: searchIndexable(), follow: true, 'max-image-preview': 'large', 'max-snippet': -1, 'max-video-preview': -1}},
    openGraph: {type: kind, siteName: 'Narrax', title: `${title} | Narrax`, description, url, locale: locale === 'id' ? 'id_ID' : 'en_US', alternateLocale: [locale === 'id' ? 'en_US' : 'id_ID'], images: [image]},
    twitter: {card: 'summary_large_image', title: `${title} | Narrax`, description, images: [image]},
  };
}
export function serializeJsonLd(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}
