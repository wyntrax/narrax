import {afterEach,describe,it,expect,vi} from 'vitest';
import {render,screen,fireEvent} from '@testing-library/react';
import {NextIntlClientProvider} from 'next-intl';
import type {ReactNode} from 'react';
import {AccessView,type AccessActions} from './view';
import {STATES,type AccessState} from './machine';
import {active,challenge,status,ADDRESS} from '@/test/fixtures';
import en from '../../../messages/en.json';
import id from '../../../messages/id.json';
import {EntitlementsSchema} from '@/lib/schemas';
afterEach(()=>vi.unstubAllEnvs());
vi.mock('@/i18n/navigation',()=>({Link:({children,href,...rest}:{children:ReactNode;href:string})=><a href={href} {...rest}>{children}</a>}));
const actions=()=>({login:vi.fn(),retry:vi.fn(),connect:vi.fn(),select:vi.fn(),sign:vi.fn(),join:vi.fn(),unlink:vi.fn(),leave:vi.fn(),logout:vi.fn(),createWallet:vi.fn()});
function mount(state:AccessState,a:AccessActions=actions(),locale:'en'|'id'='en'){return render(<NextIntlClientProvider locale={locale} messages={locale==='en'?en:id} timeZone="UTC"><AccessView state={state} actions={a} wallets={[{address:ADDRESS,name:'Phantom'}]}/></NextIntlClientProvider>);}
describe('every designed access state',()=>{
  it.each(['en','id'] as const)('offers configured Wyntrax membership when local signup is disabled (%s)',locale=>{
   vi.stubEnv('NEXT_PUBLIC_WYNTRAX_URL','https://wyntrax.example/memberships/narrax');
   mount({name:'disabled',data:{...active,effectiveTier:'NONE',grants:[]},status:{...status,enabled:false}},actions(),locale);
   expect(screen.getByRole('link',{name:/Wyntrax/})).toHaveAttribute('href','https://wyntrax.example/memberships/narrax');
   expect(screen.queryByRole('button',{name:/Join early access|Gabung akses awal/})).toBeNull();
  });
  it('accepts external early-access snapshots and does not offer local leave for them',()=>{
   const data=EntitlementsSchema.parse({...active,grants:[],sources:[{source:'WYNTRAX',id:'external',tier:'EARLY_ACCESS',validUntil:'2040-01-01T00:00:00Z'}],memberships:[{membershipId:'external',chain:'solana',address:ADDRESS,key:'EARLY_ACCESS',seq:'3',status:'ACTIVE',validUntil:'2040-01-01T00:00:00Z',eligible:true,reasonCode:'ACTIVE'}]});
   mount({name:'active',data});expect(screen.getByRole('link',{name:/Open Narrax/})).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Leave early access'})).toBeNull();
  });
  it.each(['','javascript:alert(1)','https://user:pass@example.com'])('hides unusable Wyntrax destination %s',url=>{
   vi.stubEnv('NEXT_PUBLIC_WYNTRAX_URL',url);mount({name:'disabled'});expect(screen.queryByRole('link',{name:/Wyntrax/})).toBeNull();
  });
 for(const locale of ['en','id'] as const)it.each(STATES)(`${locale}: %s has named status and explanatory copy; any controls are labeled`,name=>{mount({name,data:active,challenge:challenge(),status},actions(),locale);const messages=locale==='en'?en:id;expect(screen.getByRole('heading',{level:2})).toHaveTextContent(name==='checking'?messages.common.checking:messages.flow.states[name].title);expect(screen.getByText(messages.flow.states[name].body)).toBeInTheDocument();expect(screen.getByRole('list',{name:messages.access.steps})).toBeInTheDocument();expect(screen.queryAllByRole('button').every(button=>button.textContent?.trim())).toBe(true);});
 it('passes sign-in, join and proof approval actions through explicit buttons',()=>{for(const [name,label,key] of [['signedOut','Continue','login'],['linked','Join early access','join'],['challenge','Sign this message','sign']] as const){const a=actions();const view=mount({name,data:active,challenge:challenge()},a);if(name==='linked')for(const link of screen.getAllByRole('link'))fireEvent.click(link);fireEvent.click(screen.getByRole('button',{name:label}));expect(a[key]).toHaveBeenCalledOnce();view.unmount();}});
 it('counts three opened community steps and enables join automatically at 3 of 3',()=>{const a=actions();mount({name:'linked',data:active},a);expect(screen.getByRole('region',{name:'Join the community first.'})).toBeInTheDocument();expect(screen.queryByRole('checkbox')).toBeNull();const join=screen.getByRole('button',{name:'Join early access'});expect(join).toBeDisabled();expect(screen.getByRole('status')).toHaveTextContent('0 of 3');expect(screen.getByText('Open each step to unlock Join.')).toBeInTheDocument();const links=screen.getAllByRole('link');fireEvent.click(links[0]!);expect(screen.getByRole('status')).toHaveTextContent('1 of 3');expect(join).toBeDisabled();fireEvent.click(links[1]!);expect(screen.getByRole('status')).toHaveTextContent('2 of 3');expect(join).toBeDisabled();fireEvent.click(links[2]!);expect(screen.getByRole('status')).toHaveTextContent('3 of 3');expect(screen.getByText('All three complete. Join is unlocked.')).toBeInTheDocument();expect(join).toBeEnabled();fireEvent.click(join);expect(a.join).toHaveBeenCalledOnce();});
 it('no longer asks for a Wyntrax membership claim or account verification in early access',()=>{mount({name:'challenge',challenge:challenge()});expect(screen.queryByRole('checkbox')).toBeNull();expect(screen.queryByRole('button',{name:/membership/i})).toBeNull();expect(screen.queryByText(/claim/i)).toBeNull();});
 it('requires confirmation before unlinking and leaving',()=>{const a=actions();mount({name:'active',data:active},a);fireEvent.click(screen.getByRole('button',{name:'Unlink'}));expect(a.unlink).not.toHaveBeenCalled();expect(screen.getByRole('dialog')).toHaveAccessibleName('Unlink this wallet?');fireEvent.click(screen.getByRole('button',{name:'Confirm'}));expect(a.unlink).toHaveBeenCalledWith('fixture-link');fireEvent.click(screen.getByRole('button',{name:'Leave early access'}));expect(a.leave).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Confirm'}));expect(a.leave).toHaveBeenCalledOnce();});
 it('renders API message as plain text and never interprets markup',()=>{const c=challenge();c.message='<img src=x onerror=alert(1)>';const {container}=mount({name:'challenge',challenge:c});expect(container.querySelector('img')).toBeNull();expect(screen.getByText(c.message)).toBeInTheDocument();});
 it.each([{enabled:false,seatsLeft:null,inviteRequired:false},{enabled:true,seatsLeft:0,inviteRequired:false},{enabled:true,seatsLeft:1,inviteRequired:true}])('lets existing members sign in despite closed admission',policy=>{mount({name:'signedOut',status:policy});expect(screen.getByRole('button',{name:'Continue'})).toBeEnabled();expect(screen.queryByRole('button',{name:'Join early access'})).toBeNull();});
});
