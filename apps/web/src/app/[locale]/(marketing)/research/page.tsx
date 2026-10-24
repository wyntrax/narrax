import type {Metadata} from 'next';
import {Link} from '@/i18n/navigation';
import {pageMetadata, seoLocale} from '@/lib/seo';
import {researchCopy, researchGuides} from '@/content/research-guides';
import {StructuredData} from '@/components/marketing/structured-data';
import {breadcrumbSchema} from '@/lib/structured-data';
import '../research.css';

export async function generateMetadata({params}: {params: Promise<{locale: string}>}): Promise<Metadata> {
  const locale = seoLocale((await params).locale), copy = researchCopy[locale];
  return pageMetadata(locale, '/research', copy.title, copy.description);
}
export default async function ResearchIndex({params}: {params: Promise<{locale: string}>}) {
  const locale = seoLocale((await params).locale), copy = researchCopy[locale];
  return <main id="main" className="container research-public">
    <StructuredData data={breadcrumbSchema(locale, [{name: copy.home, path: ''}, {name: copy.guides, path: '/research'}])}/>
    <nav aria-label={locale === 'id' ? 'Jejak navigasi' : 'Breadcrumb'} className="research-breadcrumb"><Link href="/">{copy.home}</Link><span aria-hidden="true">/</span><span>{copy.guides}</span></nav>
    <header><p className="eyebrow">Narrax · Solana</p><h1>{copy.title}</h1><p className="research-public-intro">{copy.intro}</p></header>
    <div className="research-public-grid">{researchGuides[locale].map(guide => <article key={guide.slug}><h2><Link href={`/research/${guide.slug}`}>{guide.title}</Link></h2><p>{guide.description}</p><Link href={`/research/${guide.slug}`}>{copy.read} <span aria-hidden="true">↗</span></Link></article>)}</div>
    <aside className="research-public-note"><h2><Link href="/methodology">{copy.methodology}</Link></h2><p>{copy.methodologyDescription}</p><p>{copy.notice}</p></aside>
  </main>;
}
