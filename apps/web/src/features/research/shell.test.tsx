import {render,screen,cleanup} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {NextIntlClientProvider} from 'next-intl';
import type {ReactNode} from 'react';
import messages from '../../../messages/research/en.json';
import site from '../../../messages/en.json';
import {empty} from '@/test/fixtures';
import {ResearchShell} from './shell';
import {routeFeature} from './route-access';
const state=vi.hoisted(()=>({path:'/app',allowed:false,preview:false,stale:false}));
vi.mock('./session',()=>({useResearch:()=>({access:{...empty,rollout:{enforced:false,shadow_log:false},features:Object.fromEntries(Object.entries(empty.features).map(([k,v])=>[k,{...v,allowed:state.allowed}]))}}),useResearchQuery:(path:string)=>({data:path==='market-preview'&&state.preview?{at:'2026-10-19T12:00:00Z',solUsd:{priceUsd:150,at:'2026-10-19T12:00:00Z',stale:state.stale},narrativeHeat:82,trackedWallets:14,opportunities24h:2}:undefined,isError:false,isPending:false}),hasFeature:(access:typeof empty,key:string)=>access.features[key]?.allowed===true}));
vi.mock('@/i18n/navigation',()=>({usePathname:()=>state.path,Link:({href,children,...props}:{href:string;children:ReactNode})=><a href={href} {...props}>{children}</a>}));
vi.mock('@/components/auth/context',()=>({useAuth:()=>({logout:vi.fn()})}));
vi.mock('@/components/toggles',()=>({ThemeToggle:()=>null,LocaleToggle:()=>null}));
afterEach(()=>{cleanup();state.allowed=false;state.preview=false;state.stale=false;});
function view(){const child=vi.fn(()=> <p>Restricted child mounted</p>);const Child=child;render(<NextIntlClientProvider locale="en" messages={{workspace:messages,...site}}><ResearchShell theme="dark"><Child/></ResearchShell></NextIntlClientProvider>);return child;}
it.each(['/app','/app/radar','/app/narratives/example','/app/tokens','/app/tokens/mint','/app/opportunities','/app/smart-money','/app/smart-money/address','/app/analytics','/app/backtests','/app/agent','/app/personal-radar','/app/theses','/app/briefing'])('direct URL %s never mounts a denied page even with legacy rollout off',path=>{
 state.path=path;const child=view();expect(child).not.toHaveBeenCalled();expect(screen.getByText(messages.locked)).toBeVisible();
  expect(document.querySelectorAll('.research-sidebar a[data-locked="true"]')).toHaveLength(11);
 expect(document.querySelector('.research-sidebar a[href="/app/portfolio"]')).not.toHaveAttribute('data-locked');
});
it.each(['/app/portfolio','/app/alerts','/app/settings','/app/admin'])('own-account/separately authorized page %s is not tier-blocked',path=>{state.path=path;expect(view()).toHaveBeenCalled();});
it('unlocked research mounts normally without lock indicators',()=>{state.path='/app/tokens';state.allowed=true;expect(view()).toHaveBeenCalled();expect(document.querySelectorAll('[data-locked]')).toHaveLength(0);});
it('matches path segments rather than lookalike prefixes',()=>{expect(routeFeature('/app/agent-extra')).toBeUndefined();expect(routeFeature('/app/smart-money/address/')).toBe('research.wallet_detail');});
it.each([false,true])('NONE users see the limited snapshot, retaining a stale label when appropriate (%s)',stale=>{
 state.path='/app';state.preview=true;state.stale=stale;expect(view()).not.toHaveBeenCalled();
 const bar=document.querySelector('.intelligence-bar')!;expect(bar).toHaveTextContent('$150');expect(bar).toHaveTextContent('82');expect(bar).toHaveTextContent('14');expect(bar).toHaveTextContent('2');expect(bar).not.toHaveTextContent(messages.snapshotStates.locked);
 if(stale)expect(bar).toHaveTextContent(messages.snapshotStates.stalePrice);
});
