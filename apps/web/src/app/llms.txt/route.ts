import {productFacts} from '@/content/product-facts';
import {researchCopy, researchGuides} from '@/content/research-guides';
import {publicUrl, searchIndexable} from '@/lib/seo';

export const dynamic = 'force-dynamic';
/** A public reading directory, not a private-data feed or a claim of AI-engine support. */
export function GET() {
  const sections = (['en', 'id'] as const).map(locale => {
    const copy = researchCopy[locale];
    return `## ${locale === 'en' ? 'English' : 'Bahasa Indonesia'}\n\n` + [
      `- [Narrax](${publicUrl(locale)}): ${productFacts[locale].summary}`,
      `- [${copy.methodology}](${publicUrl(locale, '/methodology')}): ${copy.methodologyDescription}`,
      `- [${copy.title}](${publicUrl(locale, '/research')}): ${copy.description}`,
      ...researchGuides[locale].map(guide => `- [${guide.title}](${publicUrl(locale, `/research/${guide.slug}`)}): ${guide.description}`),
    ].join('\n');
  });
  return new Response(`# Narrax\n\n> ${productFacts.en.summary}\n\n${sections.join('\n\n')}\n\n## Interpretation\n\n${productFacts.en.questions.map(item => `### ${item.question}\n\n${item.answer}`).join('\n\n')}\n\nPublic guides are educational research, not financial advice. Workspace data requires authentication. Availability and missing observations must not be inferred from these guides.\n`, {
    headers: {'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600', ...(!searchIndexable() ? {'X-Robots-Tag': 'noindex, nofollow'} : {})},
  });
}
