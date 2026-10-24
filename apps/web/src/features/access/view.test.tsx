import {describe,it,expect,vi} from 'vitest';
import {render,screen,fireEvent} from '@testing-library/react';
import {NextIntlClientProvider} from 'next-intl';
import type {ReactNode} from 'react';
import {AccessView,type AccessActions} from './view';
import {STATES,type AccessState} from './machine';
import {active,challenge,status,ADDRESS} from '@/test/fixtures';
import en from '../../../messages/en.json';
import id from '../../../messages/id.json';
vi.mock('@/i18n/navigation',()=>({Link:({children,href,...rest}:{children:ReactNode;href:string})=><a href={href} {...rest}>{children}</a>}));
const actions=()=>({login:vi.fn(),retry:vi.fn(),connect:vi.fn(),select:vi.fn(),sign:vi.fn(),join:vi.fn(),wait:vi.fn(),unlink:vi.fn(),leave:vi.fn(),logout:vi.fn(),createWallet:vi.fn()});
function mount(state:AccessState,a:AccessActions=actions(),locale:'en'|'id'='en'){return render(<NextIntlClientProvider locale={locale} messages={locale==='en'?en:id} timeZone="UTC"><AccessView state={state} actions={a} wallets={[{address:ADDRESS,name:'Phantom'}]} membership={false} setMembership={vi.fn()}/></NextIntlClientProvider>);}
describe('every designed access state',()=>{
 for(const locale of ['en','id'] as const)it.each(STATES)(`${locale}: %s has named status and explanatory copy; any controls are labeled`,name=>{mount({name,data:active,challenge:challenge(),status},actions(),locale);const messages=locale==='en'?en:id;expect(screen.getByRole('heading',{level:2})).toHaveTextContent(name==='checking'?messages.common.checking:messages.flow.states[name].title);expect(screen.getByText(messages.flow.states[name].body)).toBeInTheDocument();expect(screen.getByRole('list',{name:messages.access.steps})).toBeInTheDocument();expect(screen.queryAllByRole('button').every(button=>button.textContent?.trim())).toBe(true);});
 it('passes sign-in, join and proof approval actions through explicit buttons',()=>{for(const [name,label,key] of [['signedOut','Continue','login'],['linked','Join early access','join'],['challenge','Sign this message','sign']] as const){const a=actions();const view=mount({name,data:active,challenge:challenge()},a);fireEvent.click(screen.getByRole('button',{name:label}));expect(a[key]).toHaveBeenCalledOnce();view.unmount();}});
 it('requires confirmation before unlinking and leaving',()=>{const a=actions();mount({name:'active',data:active},a);fireEvent.click(screen.getByRole('button',{name:'Unlink'}));expect(a.unlink).not.toHaveBeenCalled();expect(screen.getByRole('dialog')).toHaveAccessibleName('Unlink this wallet?');fireEvent.click(screen.getByRole('button',{name:'Confirm'}));expect(a.unlink).toHaveBeenCalledWith('fixture-link');fireEvent.click(screen.getByRole('button',{name:'Leave early access'}));expect(a.leave).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Confirm'}));expect(a.leave).toHaveBeenCalledOnce();});
 it('renders API message as plain text and never interprets markup',()=>{const c=challenge();c.message='<img src=x onerror=alert(1)>';const {container}=mount({name:'challenge',challenge:c});expect(container.querySelector('img')).toBeNull();expect(screen.getByText(c.message)).toBeInTheDocument();});
 it.each([{enabled:false,seatsLeft:null,inviteRequired:false},{enabled:true,seatsLeft:0,inviteRequired:false},{enabled:true,seatsLeft:1,inviteRequired:true}])('lets existing members sign in despite closed admission',policy=>{mount({name:'signedOut',status:policy});expect(screen.getByRole('button',{name:'Continue'})).toBeEnabled();expect(screen.queryByRole('button',{name:'Join early access'})).toBeNull();});
});
