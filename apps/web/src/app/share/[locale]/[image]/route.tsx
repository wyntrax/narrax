import {renderSocialImage} from '@/lib/social-image';
export const runtime = 'nodejs';
export async function GET(_request: Request, {params}: {params: Promise<{locale: string; image: string}>}) {
  const {locale, image} = await params;
  if (!['en', 'id'].includes(locale) || !image.endsWith('.png')) return new Response('Not found', {status: 404});
  return renderSocialImage(locale as 'en' | 'id', image.slice(0, -4));
}
