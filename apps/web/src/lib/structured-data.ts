import {publicUrl, type SeoLocale} from './seo';
import {siteOrigin} from '@/config/site';
import {socialImageUrl} from './social-preview';
import {productFacts} from '@/content/product-facts';
import {researchCopy, researchGuides, researchReferences} from '@/content/research-guides';
import {POWERED_BY} from '@narra/shared';
import {COMMUNITY_LINKS} from '@/features/access/community';

export function organizationSchema() {
  const origin = siteOrigin();
  return {'@type': 'Organization', '@id': `${origin}/#organization`, name: 'Narrax', url: origin,
    logo: {'@type': 'ImageObject', url: `${origin}/narrax-symbol.svg`, width: 241, height: 241},
    sameAs: [POWERED_BY.url, COMMUNITY_LINKS.x, COMMUNITY_LINKS.telegram]};
}
export function websiteSchema(locale: SeoLocale) {
  return {'@context': 'https://schema.org', '@graph': [organizationSchema(), {
    '@type': 'WebSite', '@id': `${siteOrigin()}/#website`, name: 'Narrax', url: siteOrigin(), inLanguage: ['en', 'id'],
    publisher: {'@id': `${siteOrigin()}/#organization`},
  }, {'@type': 'WebPage', '@id': `${publicUrl(locale)}#webpage`, url: publicUrl(locale), name: locale === 'id' ? 'Riset Narasi & Smart Money Solana' : 'Solana Narrative & Smart Money Research', description: productFacts[locale].summary, inLanguage: locale, about: {'@id': `${siteOrigin()}/#organization`}, isPartOf: {'@id': `${siteOrigin()}/#website`}}]};
}
export function productFaqSchema(locale: SeoLocale) {
  return {'@context': 'https://schema.org', '@type': 'FAQPage', '@id': `${publicUrl(locale)}#product-questions`, inLanguage: locale,
    mainEntity: productFacts[locale].questions.map(item => ({'@type': 'Question', name: item.question, acceptedAnswer: {'@type': 'Answer', text: item.answer}}))};
}
export function breadcrumbSchema(locale: SeoLocale, items: {name: string; path: string}[]) {
  return {'@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map((item, index) => ({'@type': 'ListItem', position: index + 1, name: item.name, item: publicUrl(locale, item.path)}))};
}
export function collectionPageSchema(locale: SeoLocale) {
  const url = publicUrl(locale, '/research'), copy = researchCopy[locale];
  return {'@context': 'https://schema.org', '@type': 'CollectionPage', '@id': `${url}#collection`, url, name: copy.title, description: copy.description, inLanguage: locale,
    isPartOf: {'@id': `${siteOrigin()}/#website`}, publisher: organizationSchema(),
    mainEntity: {'@type': 'ItemList', itemListElement: researchGuides[locale].map((guide, index) => ({'@type': 'ListItem', position: index + 1, name: guide.title, description: guide.description, url: publicUrl(locale, `/research/${guide.slug}`)}))}};
}
export function articleSchema(locale: SeoLocale, path: string, title: string, description: string, sections: {title: string}[] = []) {
  const url = publicUrl(locale, path);
  return {'@context': 'https://schema.org', '@type': 'Article', '@id': `${url}#article`, headline: title, description, inLanguage: locale,
    mainEntityOfPage: {'@type': 'WebPage', '@id': url}, url, image: socialImageUrl(siteOrigin(), locale, path),
    ...(sections.length ? {articleSection: sections.map(section => section.title)} : {}),
    ...(path.startsWith('/research/') || path === '/methodology' ? {citation: researchReferences.map(source => source.url)} : {}),
    author: {'@type': 'Organization', name: 'Narrax research team', url: publicUrl(locale, '/methodology')}, publisher: organizationSchema(),
  };
}
