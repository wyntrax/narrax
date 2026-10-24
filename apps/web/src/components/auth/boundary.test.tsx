import {afterEach,it,expect,vi} from 'vitest';
import {render,screen,waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
import {NextIntlClientProvider} from 'next-intl';
import {AuthBoundary} from './boundary';
import en from '../../../messages/en.json';
vi.mock('next/dynamic',()=>({default:()=>({appId,children}:{appId:string;children:ReactNode})=><div data-testid="privy" data-app-id={appId}>{children}</div>}));
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
it.each([
 [{enabled:false,seatsLeft:null,inviteRequired:false},'Early access is not open yet.'],
 [{enabled:true,seatsLeft:0,inviteRequired:false},'Early access is currently full.'],
 [{enabled:true,seatsLeft:12,inviteRequired:false},'12 places available']
])('shows public availability without Privy configuration: %j',async(status,copy)=>{
 vi.stubEnv('NEXT_PUBLIC_PRIVY_APP_ID','');vi.stubEnv('NEXT_PUBLIC_API_URL','http://localhost:4000');
  const fetch=vi.fn<typeof globalThis.fetch>(async url=>new Response(JSON.stringify(String(url).endsWith('/v1/public-config')?{privyAppId:null}:status)));vi.stubGlobal('fetch',fetch);
 render(<NextIntlClientProvider locale="en" messages={en}><AuthBoundary><p>private child</p></AuthBoundary></NextIntlClientProvider>);
  expect(await screen.findByText(copy)).toBeInTheDocument();expect(await screen.findByText(en.auth.notConfigured)).toBeInTheDocument();expect(screen.queryByText('private child')).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(2);expect(fetch.mock.calls.map(c=>String(c[0])).sort()).toEqual(['http://localhost:4000/v1/early-access/status','http://localhost:4000/v1/public-config']);
});

it.each([['runtime-app','runtime-app'],[null,'fallback-app']])('mounts Privy from runtime config with env fallback: %s',async(privyAppId,expected)=>{
 vi.stubEnv('NEXT_PUBLIC_PRIVY_APP_ID','fallback-app');vi.stubEnv('NEXT_PUBLIC_API_URL','http://localhost:4000');
 vi.stubGlobal('fetch',vi.fn(async(url:URL)=>new Response(JSON.stringify(String(url).endsWith('/v1/public-config')?{privyAppId}:{enabled:false,seatsLeft:null,inviteRequired:false}))));
 render(<NextIntlClientProvider locale="en" messages={en}><AuthBoundary><p>private child</p></AuthBoundary></NextIntlClientProvider>);
 expect(await screen.findByTestId('privy')).toHaveAttribute('data-app-id',expected!);
});

it('shows the shared loader while fetching and an error instead of silently using stale env on failure',async()=>{
 vi.stubEnv('NEXT_PUBLIC_PRIVY_APP_ID','fallback-app');vi.stubEnv('NEXT_PUBLIC_API_URL','http://localhost:4000');
 let fail!:(response:Response)=>void;
 vi.stubGlobal('fetch',vi.fn(async(url:URL)=>String(url).endsWith('/v1/public-config')?new Promise<Response>(resolve=>{fail=resolve;}):new Response(JSON.stringify({enabled:false,seatsLeft:null,inviteRequired:false}))));
 const view=render(<NextIntlClientProvider locale="en" messages={en}><AuthBoundary><p>private child</p></AuthBoundary></NextIntlClientProvider>);
 expect(view.container.querySelector('.route-loader')).not.toBeNull();expect(screen.queryByTestId('privy')).toBeNull();
 await waitFor(()=>expect(fail).toBeDefined());fail(new Response('{}',{status:503}));
  expect(await screen.findByText(en.auth.configError)).toBeInTheDocument();expect(screen.queryByTestId('privy')).toBeNull();expect(screen.getByRole('button',{name:en.auth.retry})).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveClass('auth-feedback');
  expect(screen.getByRole('alert').querySelector('.auth-feedback-icon')).not.toBeNull();
});
