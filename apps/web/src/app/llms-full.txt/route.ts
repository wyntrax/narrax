import {productFacts} from '@/content/product-facts';
import {methodologyContent} from '@/content/methodology';
import {researchCopy, researchGuides, researchReferences} from '@/content/research-guides';
import {publicUrl, searchIndexable} from '@/lib/seo';

export const dynamic = 'force-dynamic';
/** Complete public reading corpus for generative engines: authored guides and methodology only, never private workspace rows. */
export function GET() {
  const blocks = (['en', 'id'] as const).map(locale => {
    const copy = researchCopy[locale], facts = productFacts[locale], method = methodologyContent[locale];
    const qa = facts.questions.map(q => `### ${q.question}\n\n${q.answer}`).join('\n\n');
    const methodSections = method.sections.map(s => `### ${s.title}\n\n${s.paragraphs.join('\n\n')}`).join('\n\n');
    const guides = researchGuides[locale].map(guide => [
      `## ${guide.title}`,
      `URL: ${publicUrl(locale, `/research/${guide.slug}`)}`,
      guide.intro,
      guide.sections.map(s => `### ${s.title}\n\n${s.paragraphs.join('\n\n')}`).join('\n\n'),
      `### ${copy.checklist}\n\n${guide.checklist.map(item => `- ${item}`).join('\n')}`,
    ].join('\n\n')).join('\n\n---\n\n');
    return [
      `# Narrax (${locale === 'en' ? 'English' : 'Bahasa Indonesia'})`,
      `URL: ${publicUrl(locale)}`,
      `> ${facts.summary}`,
      `## ${facts.title}\n\n${qa}`,
      `## ${copy.methodology}\n\nURL: ${publicUrl(locale, '/methodology')}\n\n${method.intro}\n\n${methodSections}`,
      guides,
      `> ${copy.notice}`,
    ].join('\n\n');
  });
  const references = researchReferences.map(ref => `- [${ref.name}](${ref.url})`).join('\n');
  return new Response(`${blocks.join('\n\n===\n\n')}\n\n## Primary Technical References\n\n${references}\n`, {
    headers: {'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600', ...(!searchIndexable() ? {'X-Robots-Tag': 'noindex, nofollow'} : {})},
  });
}
