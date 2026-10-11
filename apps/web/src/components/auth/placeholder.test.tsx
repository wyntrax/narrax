import {act,render,screen} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {NextIntlClientProvider} from 'next-intl';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {ReactNode} from 'react';
import {AuthContext,type AuthAdapter} from './context';
import {AppPlaceholder,APP_TIMEOUT_MS} from './placeholder';
import {active,empty} from '@/test/fixtures';
import en from '../../../messages/en.json';

const api=vi.hoisted(()=>({entitlements:vi.fn()}));
vi.mock('@/lib/api',()=>({createApi:()=>api}));
vi.mock('@/i18n/navigation',()=>({Link:({children,href,...rest}:{children:ReactNode;href:string})=><a href={href} {...rest}>{children}</a>}));
function auth(overrides:Partial<AuthAdapter>={}):AuthAdapter{return {ready:true,authenticated:true,userId:'alice',wallets:[],login:vi.fn(),logout:vi.fn().mockResolvedValue(undefined),getAccessToken:vi.fn().mockResolvedValue('token'),connectWallet:vi.fn(),createWallet:vi.fn().mockResolvedValue(undefined),...overrides};}
function mount(initial=auth()){
 const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
 const tree=(value:AuthAdapter)=><QueryClientProvider client={client}><NextIntlClientProvider locale="en" messages={en}><AuthContext.Provider value={value}><AppPlaceholder/></AuthContext.Provider></NextIntlClientProvider></QueryClientProvider>;
 const result=render(tree(initial));return {...result,identity:(value:AuthAdapter)=>result.rerender(tree(value))};
}
async function advance(ms=0){await act(async()=>{await vi.advanceTimersByTimeAsync(ms);});}
beforeEach(()=>{vi.useFakeTimers();vi.resetAllMocks();api.entitlements.mockReturnValue(new Promise(()=>{}));});
afterEach(()=>vi.useRealTimers());
it.each([
 {ready:false,authenticated:false,userId:null},
 {ready:true,authenticated:true,userId:'alice'},
 {ready:true,authenticated:true,userId:null}
])('bounds /app loading for auth state %j',async value=>{
 mount(auth(value));expect(screen.queryByRole('link')).toBeNull();await advance(APP_TIMEOUT_MS-1);expect(screen.queryByRole('link')).toBeNull();
 await advance(1);expect(screen.getByRole('link',{name:'Get early access'})).toHaveAttribute('href','/early-access');
 expect(screen.queryByText(en.common.coming)).toBeNull();expect(api.entitlements).toHaveBeenCalledTimes(value.ready&&value.userId?1:0);
});
it('starts a fresh bounded wait when the identity changes after timeout',async()=>{
 const app=mount();await advance(APP_TIMEOUT_MS);expect(screen.getByRole('link')).toBeInTheDocument();
 app.identity(auth({userId:'bob'}));expect(screen.queryByRole('link')).toBeNull();
 await advance(APP_TIMEOUT_MS-1);expect(screen.queryByRole('link')).toBeNull();await advance(1);expect(screen.getByRole('link')).toBeInTheDocument();
});
it('ignores late access from the previous identity',async()=>{
 let resolve!:(value:typeof active)=>void;api.entitlements.mockReturnValueOnce(new Promise(r=>resolve=r));
 const app=mount();await advance();app.identity(auth({userId:'bob'}));await advance();
 resolve(active);await advance();expect(screen.queryByText(en.common.coming)).toBeNull();
 await advance(APP_TIMEOUT_MS);expect(screen.getByRole('link',{name:'Get early access'})).toBeInTheDocument();
});
it('removes an existing access result on sign-out or an unready identity',async()=>{
 api.entitlements.mockResolvedValue(active);const app=mount();await advance();await advance();expect(screen.getByText(en.common.coming)).toBeInTheDocument();
 app.identity(auth({ready:false}));expect(screen.queryByText(en.common.coming)).toBeNull();await advance(APP_TIMEOUT_MS);
 expect(screen.getByRole('link')).toBeInTheDocument();expect(screen.queryByText(en.common.coming)).toBeNull();
 app.identity(auth({authenticated:false,userId:null}));expect(screen.getByRole('link')).toBeInTheDocument();
});
it.each([empty,new Error('network')])('offers access promptly when the entitlement request settles without access',async result=>{
 if(result instanceof Error)api.entitlements.mockRejectedValue(result);else api.entitlements.mockResolvedValue(result);
 mount();await advance();await advance();expect(screen.getByRole('link',{name:'Get early access'})).toBeInTheDocument();expect(screen.queryByText(en.common.coming)).toBeNull();
});
