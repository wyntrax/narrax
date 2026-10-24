import {act,render,screen,waitFor,cleanup,fireEvent} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {NextIntlClientProvider} from 'next-intl';
import {z} from 'zod';
import type {ReactNode} from 'react';
import {AuthContext,type AuthAdapter} from '@/components/auth/context';
import {empty} from '@/test/fixtures';
import messages from '../../../messages/research/en.json';
import site from '../../../messages/en.json';
import {hasFeature,ResearchWorkspace,useResearchQuery} from './session';
vi.mock('./shell',()=>({ResearchShell:({children}:{children:ReactNode})=>children}));
vi.mock('@/i18n/navigation',()=>({Link:({children,href}:{children:ReactNode;href:string})=><a href={href}>{children}</a>,useRouter:()=>({replace:vi.fn()}),usePathname:()=>'/app'}));
const auth=(userId:string|null):AuthAdapter=>({ready:true,authenticated:!!userId,userId,getAccessToken:async()=>userId,login:vi.fn(),logout:async()=>{},connectWallet:vi.fn(),createWallet:async()=>{},wallets:[]});
function Probe(){const query=useResearchQuery('private',z.object({label:z.string()}));return <p>{query.data?.label??'waiting for research'}</p>;}
function Tree({user,adapter}:{user:string|null;adapter?:AuthAdapter}){return <NextIntlClientProvider locale="en" messages={{workspace:messages,common:site.common}}><AuthContext.Provider value={adapter??auth(user)}><ResearchWorkspace theme="dark"><Probe/></ResearchWorkspace></AuthContext.Provider></NextIntlClientProvider>;}
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('requires explicit feature permission even with legacy rollout disabled; unknown features fail closed',()=>{
 const access={...empty,rollout:{enforced:false,shadow_log:false}};
 expect(hasFeature(access,'research.chat')).toBe(false);expect(hasFeature(access,'unknown')).toBe(false);
 expect(hasFeature({...access,features:{...access.features,'research.chat':{requiredTier:'MEMBER',allowed:true,min_entitlement_age_hours:0}}},'research.chat')).toBe(true);
 // An admin holds every known research feature without a tier, but an unknown key still fails closed.
 expect(hasFeature({...access,admin:true},'research.chat')).toBe(true);expect(hasFeature({...access,admin:true},'unknown')).toBe(false);
});
it('removes private content immediately on sign-out',async()=>{
 vi.stubEnv('NEXT_PUBLIC_API_URL','http://localhost:4000');vi.stubGlobal('fetch',vi.fn(async(input:URL)=>new Response(JSON.stringify(input.pathname.endsWith('entitlements')?empty:{label:'private A'}),{status:200})));
 const view=render(<Tree user="A"/>);await screen.findByText('private A');view.rerender(<Tree user={null}/>);
 expect(screen.queryByText('private A')).not.toBeInTheDocument();expect(await screen.findByText('Sign in to your workspace')).toBeVisible();
});
it('ignores late data from the previous identity even when the network ignores abort',async()=>{
 vi.stubEnv('NEXT_PUBLIC_API_URL','http://localhost:4000');let finishA:(value:Response)=>void=()=>{};
 const fetcher=vi.fn(async(input:URL,init:RequestInit)=>{if(input.pathname.endsWith('entitlements'))return new Response(JSON.stringify(empty));if((init.headers as Record<string,string>).Authorization==='Bearer A')return new Promise<Response>(resolve=>{finishA=resolve;});return new Response(JSON.stringify({label:'private B'}));});vi.stubGlobal('fetch',fetcher);
 const view=render(<Tree user="A"/>);await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));view.rerender(<Tree user="B"/>);await screen.findByText('private B');
 await act(async()=>{finishA(new Response(JSON.stringify({label:'private A'})));});expect(screen.queryByText('private A')).not.toBeInTheDocument();expect(screen.getByText('private B')).toBeVisible();
});
it('allows slow SDK startup and recovers after the deadline without exposing private data',async()=>{
 vi.useFakeTimers();vi.stubEnv('NEXT_PUBLIC_API_URL','http://localhost:4000');
 const fetcher=vi.fn(async(input:URL)=>new Response(JSON.stringify(input.pathname.endsWith('entitlements')?empty:{label:'private A'})));vi.stubGlobal('fetch',fetcher);
 const view=render(<Tree user={null} adapter={{...auth(null),ready:false}}/>);
 act(()=>vi.advanceTimersByTime(10001));expect(screen.queryByRole('alert')).toBeNull();expect(fetcher).not.toHaveBeenCalled();
 act(()=>vi.advanceTimersByTime(20000));expect(screen.getByText(messages.authRecovery.timeout)).toBeVisible();expect(screen.getByRole('button',{name:messages.authRecovery.reload})).toBeVisible();expect(fetcher).not.toHaveBeenCalled();
 vi.useRealTimers();view.rerender(<Tree user="A"/>);await screen.findByText('private A');expect(screen.queryByText(messages.authRecovery.timeout)).toBeNull();
});
it('starts a new initialization allowance after a user spends time on the login screen',()=>{
 vi.useFakeTimers();const view=render(<Tree user={null}/>);act(()=>vi.advanceTimersByTime(60000));
 view.rerender(<Tree user={null} adapter={{...auth(null),authenticated:true}}/>);
 act(()=>vi.advanceTimersByTime(10001));expect(screen.queryByRole('alert')).toBeNull();
 act(()=>vi.advanceTimersByTime(20000));expect(screen.getByText(messages.authRecovery.timeout)).toBeVisible();expect(screen.getByRole('button',{name:messages.authRecovery.reset})).toBeVisible();
});
it('offers explicit recovery for a stuck signed-in identity and reports logout failure',async()=>{
 vi.useFakeTimers();const logout=vi.fn().mockRejectedValue(new Error('provider offline'));
 render(<Tree user={null} adapter={{...auth(null),authenticated:true,logout}}/>);act(()=>vi.advanceTimersByTime(30001));
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:messages.authRecovery.reset}));});
 expect(logout).toHaveBeenCalledTimes(1);expect(screen.getByText(messages.authRecovery.failed)).toBeVisible();
});
