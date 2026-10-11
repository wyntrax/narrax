// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {NextRequest} from 'next/server';
import middleware from './middleware';
import {routing} from './i18n/routing';
describe('explicit locale routing with detection off',()=>{
 it('keeps automatic detection off and defaults to EN despite Indonesian browser language',()=>{expect(routing.localeDetection).toBe(false);const response=middleware(new NextRequest('http://localhost:4010/',{headers:{'accept-language':'id'}}));expect(response.headers.get('x-middleware-rewrite')).toBe('http://localhost:4010/en');});
 it('remembers ID cookie for unprefixed paths and preserves the query',()=>{const response=middleware(new NextRequest('http://localhost:4010/early-access?from=hero',{headers:{cookie:'NARRA_LOCALE=id','accept-language':'en'}}));expect(response.headers.get('location')).toBe('http://localhost:4010/id/early-access?from=hero');});
 it.each(['en','invalid'])('uses EN for %s cookie',locale=>{const response=middleware(new NextRequest('http://localhost:4010/',{headers:{cookie:`NARRA_LOCALE=${locale}`}}));expect(response.headers.get('x-middleware-rewrite')).toBe('http://localhost:4010/en');});
 it('explicit /en overrides the ID cookie and remembers EN',()=>{const response=middleware(new NextRequest('http://localhost:4010/en',{headers:{cookie:'NARRA_LOCALE=id'}}));expect(response.cookies.get('NARRA_LOCALE')?.value).toBe('en');expect(response.headers.get('location')).toBe('http://localhost:4010/');});
});
