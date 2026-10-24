import type {Metadata} from 'next';
import {Link} from '@/i18n/navigation';
import {pageMetadata, seoLocale} from '@/lib/seo';
import {researchCopy,researchReferences} from '@/content/research-guides';
import {methodologyContent} from '@/content/methodology';
import {StructuredData} from '@/components/marketing/structured-data';
import {breadcrumbSchema} from '@/lib/structured-data';
import '../research.css';

export async function generateMetadata({params}: {params: Promise<{locale: string}>}): Promise<Metadata> {
  const locale = seoLocale((await params).locale), copy = researchCopy[locale];
  return pageMetadata(locale, '/methodology', copy.methodology, copy.methodologyDescription);
}
export default async function Methodology({params}: {params: Promise<{locale: string}>}) {
  const locale = seoLocale((await params).locale), copy = researchCopy[locale], content = methodologyContent[locale];
  return <main id="main" className="container research-public">
    <StructuredData data={breadcrumbSchema(locale, [{name: copy.home, path: ''}, {name: copy.methodology, path: '/methodology'}])}/>
    <nav aria-label={locale === 'id' ? 'Jejak navigasi' : 'Breadcrumb'} className="research-breadcrumb"><Link href="/">{copy.home}</Link><span aria-hidden="true">/</span><span>{copy.methodology}</span></nav>
    <article className="research-public-article"><header><p className="eyebrow">Narrax · Solana</p><h1>{copy.methodology}</h1><p className="research-public-intro">{content.intro}</p><p className="research-public-byline">{copy.byline}</p></header>
      {content.sections.map((section, index) => <section key={section.title} aria-labelledby={`method-${index}`}><h2 id={`method-${index}`}>{section.title}</h2>{section.paragraphs.map(text => <p key={text}>{text}</p>)}</section>)}
      <section><h2>{copy.sources}</h2><p>{copy.sourceNote}</p><ul>{researchReferences.map(source => <li key={source.url}><a href={source.url} rel="external">{source.name}</a></li>)}</ul></section>
      <aside className="research-public-note"><p>{copy.notice}</p><Link href="/research">{copy.guides} ↗</Link></aside>
    </article>
  </main>;
}
