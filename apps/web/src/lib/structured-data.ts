import {publicUrl, type SeoLocale} from './seo';
import {siteOrigin} from '@/config/site';

export function organizationSchema() {
  const origin = siteOrigin();
  return {'@type': 'Organization', '@id': `${origin}/#organization`, name: 'Narrax', url: origin, logo: `${origin}/narrax-symbol.svg`};
}
export function websiteSchema(locale: SeoLocale) {
  return {'@context': 'https://schema.org', '@graph': [organizationSchema(), {
    '@type': 'WebSite', '@id': `${siteOrigin()}/#website`, name: 'Narrax', url: siteOrigin(), inLanguage: ['en', 'id'],
    publisher: {'@id': `${siteOrigin()}/#organization`},
  }, {'@type': 'WebPage', '@id': `${publicUrl(locale)}#webpage`, url: publicUrl(locale), name: locale === 'id' ? 'Riset Narasi & Smart Money Solana' : 'Solana Narrative & Smart Money Research', inLanguage: locale, isPartOf: {'@id': `${siteOrigin()}/#website`}}]};
}
export function breadcrumbSchema(locale: SeoLocale, items: {name: string; path: string}[]) {
  return {'@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map((item, index) => ({'@type': 'ListItem', position: index + 1, name: item.name, item: publicUrl(locale, item.path)}))};
}
export function articleSchema(locale: SeoLocale, path: string, title: string, description: string) {
  const url = publicUrl(locale, path);
  return {'@context': 'https://schema.org', '@type': 'Article', '@id': `${url}#article`, headline: title, description, inLanguage: locale,
    mainEntityOfPage: {'@type': 'WebPage', '@id': url}, url, image: publicUrl(locale, '/opengraph-image'),
    author: {'@type': 'Organization', name: 'Narrax research team', url: publicUrl(locale, '/methodology')}, publisher: organizationSchema(),
  };
}
