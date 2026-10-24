import createMiddleware from 'next-intl/middleware';
import {NextRequest, NextResponse} from 'next/server';
import {routing} from './i18n/routing';
import {contentSecurityPolicy} from './config/security';
import {searchIndexable} from './lib/seo';
const intl = createMiddleware(routing);
export default function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = contentSecurityPolicy(nonce, process.env.NEXT_PUBLIC_API_URL, process.env.NODE_ENV === 'development');
  const headers = new Headers(request.headers);
  // Authentication remains the access boundary. This header also covers redirects and non-HTML clients.
  const privateRoute = /^\/(?:en\/|id\/)?(?:app|early-access)(?:\/|$)/.test(request.nextUrl.pathname);
  const applyIndexing = (response: NextResponse) => {
    if (privateRoute || !searchIndexable()) response.headers.set('X-Robots-Tag', 'noindex, nofollow');
    return response;
  };
  headers.set('x-nonce', nonce); headers.set('Content-Security-Policy', csp);
  // Explicit URL locale wins. Otherwise remember only our cookie, never Accept-Language.
  const explicitLocale = /^\/(en|id)(?:\/|$)/.exec(request.nextUrl.pathname)?.[1];
  if (!explicitLocale && request.cookies.get('NARRA_LOCALE')?.value === 'id') {
    const url = request.nextUrl.clone();
    url.pathname = `/id${url.pathname === '/' ? '' : url.pathname}`;
    const response = NextResponse.redirect(url);
    response.headers.set('Content-Security-Policy', csp);
    response.headers.set('Cache-Control', 'private, no-store');
    return applyIndexing(response);
  }
  // Next reads the request policy to nonce its own hydration scripts.
  const response = intl(new NextRequest(request, {headers}));
  if (explicitLocale) response.cookies.set('NARRA_LOCALE', explicitLocale, {path: '/', maxAge: 31536000, sameSite: 'lax'});
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('Cache-Control', 'private, no-store');
   return applyIndexing(response);
}
export const config = {matcher: ['/((?!api|_next|_vercel|.*\\..*).*)']};
