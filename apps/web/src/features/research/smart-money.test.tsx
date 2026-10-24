import {render,screen,cleanup,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,it,expect,vi} from 'vitest';
import {NextIntlClientProvider} from 'next-intl';
import type {ReactNode} from 'react';
import messages from '../../../messages/research/en.json';
import {SmartMoneyPage,SmartWalletPage} from './smart-money';
const fixture=vi.hoisted(()=>({profile:null as unknown,hasTrade:false,paths:[] as string[],dirItem:null as unknown}));
const at='2026-10-18T05:29:31.064Z';
const intelligence={checkedAt:at,windowDays:30,observedTrades:299,observedBuys:296,observedSells:3,unmatchedSells:1,closedTrades:2,requiredClosedTrades:5,status:'INSUFFICIENT_HISTORY'};
vi.mock('@/i18n/navigation',()=>({useRouter:()=>({push:vi.fn()}),Link:({href,children}:{href:string;children:ReactNode})=><a href={href}>{children}</a>}));
vi.mock('./session',()=>({useResearchQuery:(path:string)=>{
 fixture.paths.push(path);
 const result={isPending:false,isError:false,isFetching:false,refetch:vi.fn()};
 if(path.startsWith('smart-money/')){
  const wallet={address:'wallet',source:'MANUAL',observedTrades:299,intelligence};
  return {...result,data:{items:[fixture.dirItem??wallet],nextCursor:null}};
 }
 if(path.includes('/trades'))return {...result,data:{items:fixture.hasTrade?[{id:'t',at,side:'BUY',amountSol:1,signature:'sig',token:{mint:'mint',symbol:'REAL',name:'Resolved Token'}}]:[],nextCursor:null}};
 return {...result,data:{address:'wallet',source:'MANUAL',trackedSince:at,profile:fixture.profile,intelligence,history:{checkedAt:at,scanned:300,accepted:299,skipped:0,capped:true,windowDays:30},performance:{},narrativeHistory:{scannedTrades:0,lookbackDays:90,items:[]},cluster:null,funding:null}};
}}));
afterEach(()=>{cleanup();fixture.profile=null;fixture.hasTrade=false;fixture.paths=[];fixture.dirItem=null;});
function view(node:ReactNode){return render(<NextIntlClientProvider locale="en" messages={{workspace:messages}}>{node}</NextIntlClientProvider>);}
it('shows computed insufficient sample progress in the directory instead of awaiting computation',()=>{
 view(<SmartMoneyPage/>);
 expect(screen.getByText('Insufficient matched trades')).toBeVisible();
 expect(screen.getByText(/2 \/ 5 matched closes from 299 trades in the last 30 days/)).toBeVisible();
});
it('shows the provider-resolved token name beneath the symbol in trade rows',()=>{
 fixture.hasTrade=true;view(<SmartWalletPage address="wallet"/>);
 expect(screen.getByRole('link',{name:'REAL Resolved Token'})).toHaveAttribute('href','/app/tokens/mint');
 expect(screen.getByText('Resolved Token')).toBeVisible();
});
it('distinguishes unmatched sells and capped historical coverage on wallet detail',()=>{
 view(<SmartWalletPage address="wallet"/>);
 expect(screen.getByText(/296 buys · 3 sells · 1 sells without/)).toBeVisible();
 expect(screen.getByText(/Scan limit reached/)).toBeVisible();
 expect(screen.getAllByText(/You do not need to wait 30 days/).length).toBeGreaterThan(0);
});
it('sorts by recorded score through the API and explains the ordering',async()=>{
 const user=userEvent.setup();view(<SmartMoneyPage/>);
 expect(fixture.paths).toContainEqual(expect.stringContaining('sort=recent'));
 expect(screen.queryByText(messages.smSortNote)).toBeNull();
 await user.selectOptions(screen.getByLabelText(messages.smSort),'score');
 expect(fixture.paths).toContainEqual(expect.stringContaining('sort=score'));
 expect(await screen.findByText(messages.smSortNote)).toBeVisible();
});
it('shows a recorded profile chip only when a profile exists, never inventing a score',()=>{
 fixture.dirItem={address:'wallet',source:'MANUAL',observedTrades:299,intelligence,profileAt:at,score:81.5,style:'SNIPER'};
 const first=view(<SmartMoneyPage/>);
 expect(screen.getByText('Score 81.5')).toBeVisible();expect(screen.getByText('SNIPER')).toBeVisible();
 first.unmount();
 fixture.dirItem=null;
 view(<SmartMoneyPage/>);
 expect(screen.queryByText(/^Score /)).toBeNull();
 expect(screen.getByText('Insufficient matched trades')).toBeVisible();
});
it('renders real recorded-profile values on the detail page and keeps a missing pattern unknown',()=>{
 fixture.profile={score:81.5,leaderScore:70,style:'SNIPER',medianHoldSeconds:3600,bestPattern:null,weakPattern:'Slow exits',updatedAt:at};
 view(<SmartWalletPage address="wallet"/>);
 const section=screen.getByRole('heading',{name:messages.smRecordedProfile}).closest('section')!;
 expect(within(section).getByText('81.5')).toBeVisible();
 expect(within(section).getByText('1 h')).toBeVisible();
 expect(within(section).getByText('Slow exits')).toBeVisible();
 expect(within(section).getByText('Unknown')).toBeVisible();
 expect(screen.queryByText(/closed trades from/)).toBeNull();
});
