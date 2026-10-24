import {render,screen,waitFor,cleanup} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,it,expect,vi} from 'vitest';
import {NextIntlClientProvider} from 'next-intl';
import type {ReactNode} from 'react';
import {AuthContext,type AuthAdapter} from '@/components/auth/context';
import {empty as baseAccess} from '@/test/fixtures';
import messages from '../../../messages/research/en.json';
import site from '../../../messages/en.json';
import {ResearchWorkspace} from './session';
import {ChatPage} from './chat';
vi.mock('./shell',()=>({ResearchShell:({children}:{children:ReactNode})=>children}));
vi.mock('@/i18n/navigation',()=>({Link:({children,href}:{children:ReactNode;href:string})=><a href={href}>{children}</a>,useRouter:()=>({replace:vi.fn()}),usePathname:()=>'/app/agent'}));
const auth:AuthAdapter={ready:true,authenticated:true,userId:'A',getAccessToken:async()=>'A',login:vi.fn(),logout:async()=>{},connectWallet:vi.fn(),createWallet:async()=>{},wallets:[]};
function Tree(){return <NextIntlClientProvider locale="en" messages={{workspace:messages,common:site.common}}><AuthContext.Provider value={auth}><ResearchWorkspace theme="dark"><ChatPage/></ResearchWorkspace></AuthContext.Provider></NextIntlClientProvider>;}
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.unstubAllEnvs();});
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status});
// Successful chat fixtures explicitly grant Agent access; denied access is exercised separately below.
const empty={...baseAccess,features:{...baseAccess.features,'research.chat':{requiredTier:'PRO',allowed:true,min_entitlement_age_hours:0}}};
it('shows a tier lock without a composer or chat request when Agent access is denied',async()=>{
 vi.stubEnv('NEXT_PUBLIC_API_URL','http://localhost:4000');
 const fetch=vi.fn(async()=>json({...empty,rollout:{enforced:true,shadow_log:false},features:{...empty.features,'research.chat':{requiredTier:'MEMBER',allowed:false,min_entitlement_age_hours:0}}}));
 vi.stubGlobal('fetch',fetch);render(<Tree/>);
 expect(await screen.findByText(messages.locked)).toBeVisible();
 expect(screen.queryByLabelText('Your question')).toBeNull();
 expect(fetch.mock.calls).toHaveLength(1);
});
it('shows the assistant reply as plain text, never as markup, and says suggestions were not applied',async()=>{
 vi.stubEnv('NEXT_PUBLIC_API_URL','http://localhost:4000');
 const bodies:unknown[]=[];
 vi.stubGlobal('fetch',vi.fn(async(input:URL,init:RequestInit)=>{
  if(input.pathname.endsWith('entitlements'))return json(empty);
  bodies.push(JSON.parse(String(init.body)));
  return json({conversationId:'c1',reply:{text:'<img src=x onerror="alert(1)"> **bold**',format:'text'},toolsUsed:['getNarratives'],stopReason:'end',proposals:[{id:'p1',summary:'Tighten max position size'}]});
 }));
 render(<Tree/>);const user=userEvent.setup();
 await user.type(await screen.findByLabelText('Your question'),'What is accelerating?');await user.click(screen.getByRole('button',{name:'Send'}));
 expect(await screen.findByText('<img src=x onerror="alert(1)"> **bold**')).toBeVisible();
 expect(document.querySelector('img')).toBeNull();
 expect(screen.getByText('Tighten max position size')).toBeVisible();expect(screen.getByText('Shown for information. Nothing was changed.')).toBeVisible();
 expect(bodies[0]).toEqual({message:'What is accelerating?'});
 await user.type(screen.getByLabelText('Your question'),'And tokens?');await user.click(screen.getByRole('button',{name:'Send'}));
 await waitFor(()=>expect(bodies).toHaveLength(2));expect(bodies[1]).toEqual({conversationId:'c1',message:'And tokens?'});
});
it('says plainly when the assistant is unavailable',async()=>{
 vi.stubEnv('NEXT_PUBLIC_API_URL','http://localhost:4000');
 vi.stubGlobal('fetch',vi.fn(async(input:URL)=>input.pathname.endsWith('entitlements')?json(empty):json({error:'CHAT_UNAVAILABLE'},503)));
 render(<Tree/>);const user=userEvent.setup();
 await user.type(await screen.findByLabelText('Your question'),'Hello');await user.click(screen.getByRole('button',{name:'Send'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('The assistant is not available right now');
 expect(screen.getByLabelText('Your question')).toHaveValue('Hello');
 expect(screen.getByText(/Your question is back in the editor/)).toBeVisible();
});
it('prefills suggested questions without sending, and sends with the keyboard shortcut',async()=>{
 vi.stubEnv('NEXT_PUBLIC_API_URL','http://localhost:4000');
 const bodies:unknown[]=[];
 vi.stubGlobal('fetch',vi.fn(async(input:URL,init:RequestInit)=>{
  if(input.pathname.endsWith('entitlements'))return json(empty);
  bodies.push(JSON.parse(String(init.body)));
  return json({conversationId:'starter',reply:{text:'Recorded evidence is limited.',format:'text'},toolsUsed:[],stopReason:'end',proposals:[]});
 }));
 render(<Tree/>);const user=userEvent.setup();
 await user.click(await screen.findByRole('button',{name:/Explore narratives/}));
 expect(bodies).toHaveLength(0);
 const input=screen.getByLabelText('Your question');expect(input).toHaveValue(messages.agentUi.prompts.narratives.question);expect(input).toHaveFocus();
 await user.keyboard('{Control>}{Enter}{/Control}');
 expect(await screen.findByText('Recorded evidence is limited.')).toBeVisible();
 expect(bodies).toEqual([{message:messages.agentUi.prompts.narratives.question}]);
 expect(screen.queryByRole('heading',{name:messages.agentUi.welcome})).toBeNull();
 await user.click(screen.getByRole('button',{name:messages.chNew}));
 expect(screen.getByRole('heading',{name:messages.agentUi.welcome})).toBeVisible();expect(input).toHaveValue('');
});
it('restores failed questions and resends without duplicating the visible question',async()=>{
 vi.stubEnv('NEXT_PUBLIC_API_URL','http://localhost:4000');let calls=0;
 vi.stubGlobal('fetch',vi.fn(async(input:URL)=>{
  if(input.pathname.endsWith('entitlements'))return json(empty);
  if(++calls===1)return json({error:'CHAT_UNAVAILABLE'},503);
  return json({conversationId:'retry',reply:{text:'Please check the source coverage.',format:'text'},toolsUsed:[],stopReason:'end',proposals:[]});
 }));
 render(<Tree/>);const user=userEvent.setup();
 await user.type(await screen.findByLabelText('Your question'),'Check evidence');await user.click(screen.getByRole('button',{name:'Send'}));
 await screen.findByRole('alert');await user.click(screen.getByRole('button',{name:'Send'}));
 expect(await screen.findByText('Please check the source coverage.')).toBeVisible();expect(screen.getAllByText('Check evidence')).toHaveLength(1);expect(calls).toBe(2);
});
it('copies plain-text replies without applying proposals',async()=>{
 vi.stubEnv('NEXT_PUBLIC_API_URL','http://localhost:4000');
 vi.stubGlobal('fetch',vi.fn(async(input:URL)=>input.pathname.endsWith('entitlements')?json(empty):json({conversationId:'copy',reply:{text:'**Untrusted** <b>text</b>',format:'text'},toolsUsed:[],stopReason:'end',proposals:[]})));
 const user=userEvent.setup(),copy=vi.spyOn(navigator.clipboard,'writeText').mockResolvedValue();
 render(<Tree/>);await user.type(await screen.findByLabelText('Your question'),'Explain');await user.click(screen.getByRole('button',{name:'Send'}));
 await user.click(await screen.findByRole('button',{name:'Copy reply'}));expect(copy).toHaveBeenCalledWith('**Untrusted** <b>text</b>');
 expect(await screen.findByRole('button',{name:'Copy reply'})).toHaveTextContent('Copied');copy.mockRestore();
});
