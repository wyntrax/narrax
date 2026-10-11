import {afterEach,it,expect,vi} from 'vitest';
import {render,screen} from '@testing-library/react';
import {NextIntlClientProvider} from 'next-intl';
import {AuthBoundary} from './boundary';
import en from '../../../messages/en.json';
vi.mock('next/dynamic',()=>({default:()=>()=>{throw Error('Privy must not mount without its app ID');}}));
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
it.each([
 [{enabled:false,seatsLeft:null,inviteRequired:false},'Early access is not open yet.'],
 [{enabled:true,seatsLeft:0,inviteRequired:false},'Early access is currently full.'],
 [{enabled:true,seatsLeft:12,inviteRequired:false},'12 places available']
])('shows public availability without Privy configuration: %j',async(status,copy)=>{
 vi.stubEnv('NEXT_PUBLIC_PRIVY_APP_ID','');vi.stubEnv('NEXT_PUBLIC_API_URL','http://localhost:4000');
 const fetch=vi.fn<typeof globalThis.fetch>(async()=>new Response(JSON.stringify(status)));vi.stubGlobal('fetch',fetch);
 render(<NextIntlClientProvider locale="en" messages={en}><AuthBoundary><p>private child</p></AuthBoundary></NextIntlClientProvider>);
 expect(await screen.findByText(copy)).toBeInTheDocument();expect(screen.getByText(en.auth.notConfigured)).toBeInTheDocument();expect(screen.queryByText('private child')).toBeNull();
 expect(fetch).toHaveBeenCalledOnce();expect(String(fetch.mock.calls[0]?.[0])).toBe('http://localhost:4000/v1/early-access/status');
});
