// @vitest-environment node
import {afterEach,describe,it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
import middleware from './middleware';
import {routing} from './i18n/routing';
afterEach(()=>vi.unstubAllEnvs());
describe('explicit locale routing with detection off',()=>{
 it('keeps automatic detection off and defaults to EN despite Indonesian browser language',()=>{expect(routing.localeDetection).toBe(false);const response=middleware(new NextRequest('http://localhost:4010/',{headers:{'accept-language':'id'}}));expect(response.headers.get('x-middleware-rewrite')).toBe('http://localhost:4010/en');});
 it('remembers ID cookie for unprefixed paths and preserves the query',()=>{const response=middleware(new NextRequest('http://localhost:4010/early-access?from=hero',{headers:{cookie:'NARRA_LOCALE=id','accept-language':'en'}}));expect(response.headers.get('location')).toBe('http://localhost:4010/id/early-access?from=hero');});
 it.each(['en','invalid'])('uses EN for %s cookie',locale=>{const response=middleware(new NextRequest('http://localhost:4010/',{headers:{cookie:`NARRA_LOCALE=${locale}`}}));expect(response.headers.get('x-middleware-rewrite')).toBe('http://localhost:4010/en');});
 it('explicit /en overrides the ID cookie and remembers EN',()=>{const response=middleware(new NextRequest('http://localhost:4010/en',{headers:{cookie:'NARRA_LOCALE=id'}}));expect(response.cookies.get('NARRA_LOCALE')?.value).toBe('en');expect(response.headers.get('location')).toBe('http://localhost:4010/');});
});
describe('HTTP indexing boundaries',()=>{
 it.each(['/app','/id/app/tokens','/en/app/admin','/early-access','/id/early-access'])('noindexes private route %s even on the production host',path=>{
  vi.stubEnv('NEXT_PUBLIC_SITE_URL','https://narrax.example');vi.stubEnv('NARRA_SEO_INDEXABLE','true');
  const response=middleware(new NextRequest(`https://narrax.example${path}`));expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
 });
 it('noindexes preview responses and locale redirects',()=>{
  vi.stubEnv('NEXT_PUBLIC_SITE_URL','https://preview.example');vi.stubEnv('NARRA_SEO_INDEXABLE','false');
  const response=middleware(new NextRequest('https://preview.example/research',{headers:{cookie:'NARRA_LOCALE=id'}}));
  expect(response.status).toBe(307);expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
 });
 it('does not noindex public production guides',()=>{
  vi.stubEnv('NEXT_PUBLIC_SITE_URL','https://narrax.example');vi.stubEnv('NARRA_SEO_INDEXABLE','true');
  expect(middleware(new NextRequest('https://narrax.example/research')).headers.get('x-robots-tag')).toBeNull();
 });
});
