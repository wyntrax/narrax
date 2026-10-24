import {headers} from 'next/headers';
import {serializeJsonLd} from '@/lib/seo';

export async function StructuredData({data}: {data: unknown}) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  // Browsers hide a script's nonce content attribute once it is inserted (the value stays available as
  // script.nonce), so hydration sees nonce="" where the server sent the real value. That difference is
  // expected and must not be patched; suppressing it keeps the real nonce in the server HTML without a
  // hydration warning.
  return <script type="application/ld+json" nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{__html: serializeJsonLd(data)}}/>;
}
