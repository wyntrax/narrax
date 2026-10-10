import createMiddleware from 'next-intl/middleware';
import {NextRequest} from 'next/server';
import {routing} from './i18n/routing';
import {contentSecurityPolicy} from './config/security';
const intl = createMiddleware(routing);
export default function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = contentSecurityPolicy(nonce, process.env.NEXT_PUBLIC_API_URL, process.env.NODE_ENV === 'development');
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce); headers.set('Content-Security-Policy', csp);
  // Next reads the request policy to nonce its own hydration scripts.
  const response = intl(new NextRequest(request, {headers}));
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
export const config = {matcher: ['/((?!api|_next|_vercel|.*\\..*).*)']};
