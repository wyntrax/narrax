import type {MetadataRoute} from 'next';
import {SEO_LOCALES,languageAlternates,publicUrl,searchIndexable} from '@/lib/seo';
import {researchGuides} from '@/content/research-guides';
export const dynamic='force-dynamic';
export default function sitemap():MetadataRoute.Sitemap {
 if(!searchIndexable())return [];
 const paths=['','/research','/methodology',...researchGuides.en.map(guide=>`/research/${guide.slug}`)];
 return paths.flatMap(path=>SEO_LOCALES.map(locale=>({url:publicUrl(locale,path),alternates:{languages:languageAlternates(path)}})));
}
