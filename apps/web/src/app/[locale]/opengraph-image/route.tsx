import {renderSocialImage} from '@/lib/social-image';
import {seoLocale} from '@/lib/seo';
/** Keep existing shared image URLs working after moving to page-specific cards. */
export async function GET(_request: Request, {params}: {params: Promise<{locale: string}>}) {
  return renderSocialImage(seoLocale((await params).locale), 'home');
}
