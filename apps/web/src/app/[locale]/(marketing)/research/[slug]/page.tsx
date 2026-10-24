import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {Link} from '@/i18n/navigation';
import {pageMetadata, seoLocale} from '@/lib/seo';
import {researchCopy, researchGuides, findResearchGuide, researchReferences} from '@/content/research-guides';
import {StructuredData} from '@/components/marketing/structured-data';
import {articleSchema, breadcrumbSchema} from '@/lib/structured-data';
import '../../research.css';

type Props = {params: Promise<{locale: string; slug: string}>};
// Only authored guides are routable. Unknown slugs must be HTTP 404s, not streamed soft-404 pages.
export const dynamicParams = false;
export function generateStaticParams() {
  return (['en','id'] as const).flatMap(locale => researchGuides[locale].map(guide => ({locale, slug: guide.slug})));
}
export async function generateMetadata({params}: Props): Promise<Metadata> {
  const {locale: raw, slug} = await params, locale = seoLocale(raw), guide = findResearchGuide(locale, slug);
  if (!guide) notFound();
  return pageMetadata(locale, `/research/${slug}`, guide.title, guide.description, 'article');
}
export default async function Guide({params}: Props) {
  const {locale: raw, slug} = await params, locale = seoLocale(raw), guide = findResearchGuide(locale, slug), copy = researchCopy[locale];
  if (!guide) notFound();
  return <main id="main" className="container research-public">
    <StructuredData data={[articleSchema(locale, `/research/${slug}`, guide.title, guide.description), breadcrumbSchema(locale, [{name: copy.home, path: ''}, {name: copy.guides, path: '/research'}, {name: guide.title, path: `/research/${slug}`}])]}/>
    <nav aria-label={locale === 'id' ? 'Jejak navigasi' : 'Breadcrumb'} className="research-breadcrumb"><Link href="/">{copy.home}</Link><span aria-hidden="true">/</span><Link href="/research">{copy.guides}</Link></nav>
    <article className="research-public-article"><header><p className="eyebrow">Narrax · Solana</p><h1>{guide.title}</h1><p className="research-public-intro">{guide.intro}</p><p className="research-public-byline">{copy.byline} · <Link href="/methodology">{copy.methodology}</Link></p></header>
      {guide.sections.map((section, index) => <section key={section.title} aria-labelledby={`section-${index}`}><h2 id={`section-${index}`}>{section.title}</h2>{section.paragraphs.map(text => <p key={text}>{text}</p>)}</section>)}
      <section><h2>{copy.checklist}</h2><ul>{guide.checklist.map(item => <li key={item}>{item}</li>)}</ul></section>
      <section><h2>{copy.sources}</h2><p>{copy.sourceNote}</p><ul>{researchReferences.map(source => <li key={source.url}><a href={source.url} rel="external">{source.name}</a></li>)}</ul></section>
      <aside className="research-public-note"><p>{copy.notice}</p><Link href="/early-access" className="button button-primary">{copy.access} ↗</Link></aside>
    </article>
    <section className="research-public-related"><h2>{copy.related}</h2><ul>{researchGuides[locale].filter(item => item.slug !== slug).map(item => <li key={item.slug}><Link href={`/research/${item.slug}`}>{item.title}</Link></li>)}<li><Link href="/methodology">{copy.methodology}</Link></li></ul></section>
  </main>;
}
