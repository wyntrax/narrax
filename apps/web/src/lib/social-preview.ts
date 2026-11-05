import {researchCopy, researchGuides} from '@/content/research-guides';
import type {SeoLocale} from './seo';

/** Only authored public pages may supply image copy; never render arbitrary URL text. */
export function socialPreview(locale: SeoLocale, key: string) {
  const copy = researchCopy[locale], id = locale === 'id';
  if (key === 'home') return {title: id ? 'Pahami narasi. Telusuri buktinya.' : 'See the narrative. Follow the evidence.', label: 'SOLANA RESEARCH', description: id ? 'Narasi, token, dan aktivitas wallet dalam satu ruang riset.' : 'Narratives, tokens and wallet activity. One research workspace.'};
  if (key === 'research') return {title: copy.title, label: id ? 'PANDUAN RISET' : 'RESEARCH GUIDES', description: copy.description};
  if (key === 'methodology') return {title: copy.methodology, label: id ? 'METODOLOGI' : 'OUR METHODOLOGY', description: copy.methodologyDescription};
  const guide = researchGuides[locale].find(item => item.slug === key);
  return guide ? {title: guide.title, label: id ? 'PANDUAN RISET' : 'RESEARCH GUIDE', description: guide.description} : null;
}
export const DEFAULT_SOCIAL_IMAGE = {path:'/og-default.png?v=1',width:1789,height:655} as const;
export function socialImageUrl(origin: string, locale: SeoLocale, path = '') {
  const key = path === '' || path === '/' ? 'home' : path.replace(/^\/research\//, '').replace(/^\//, '');
  if (key === 'home' || !socialPreview(locale, key)) return `${origin}${DEFAULT_SOCIAL_IMAGE.path}`;
  return `${origin}/share/${locale}/${key}.png?v=3`;
}
