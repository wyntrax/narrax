import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {ReactNode} from 'react';
import {fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {NextIntlClientProvider} from 'next-intl';
import en from '../../../messages/research/en.json';

const api=vi.hoisted(()=>({
  settings:vi.fn(),stats:vi.fn(),grants:vi.fn(),runtime:vi.fn(),integrations:vi.fn(),helius:vi.fn(),save:vi.fn(),saveIntegrations:vi.fn(),saveHelius:vi.fn(),testTelegram:vi.fn(),testHelius:vi.fn(),lookup:vi.fn(),grant:vi.fn(),revoke:vi.fn(),checkPrivy:vi.fn(),
}));
/** Who /v1/me reports. Swapped per test so the not-an-admin path can be rendered without any admin request. */
const session=vi.hoisted(()=>({
  me:{data:{isAdmin:true,admin:{configured:true,privyUserId:'did:privy:admin-1',email:'admin@example.com'}},isPending:false,isError:false,error:null,refetch:vi.fn()} as {data:{isAdmin?:boolean;admin?:{configured:boolean;privyUserId:string;email:string|null}};isPending:boolean;isError:boolean;error:unknown;refetch:()=>void},
}));
vi.mock('./api',()=>({createAdminApi:()=>api}));
vi.mock('./data-health-card',()=>({DataHealthCard:()=>null}));
vi.mock('@/i18n/navigation',()=>({Link:({children,href,...rest}:{children:ReactNode;href:string})=><a href={href} {...rest}>{children}</a>}));
vi.mock('@/features/research/session',()=>({useResearch:()=>({userId:'admin-1'}),useResearchQuery:()=>session.me}));
vi.mock('@/components/auth/context',()=>({useAuth:()=>({getAccessToken:async()=>'token'})}));

import {AdminPage} from './page';

const runtime={privyAppId:{value:'app-one',source:'environment' as const},privyVerificationKey:{value:'-----BEGIN PUBLIC KEY-----\nX\n-----END PUBLIC KEY-----',source:'environment' as const},corsOrigins:{value:['https://env.example'],source:'environment' as const,extra:[],environment:['https://env.example']}};
const integrations={telegram:{enabled:{value:false,source:'default' as const},chatId:{value:null,source:'default' as const},botToken:{configured:false,source:'default' as const},maxAgeMin:{value:15,source:'default' as const},maxPerRun:{value:10,source:'default' as const},sendDelayMs:{value:1200,source:'default' as const}},treg:{enabled:{value:false,source:'default' as const},token:{configured:false,source:'default' as const},org:{value:null,source:'default' as const}},invalid:[]};
const helius={rpcUrls:{configured:0,source:'default' as const},rpcFallbackUrls:{configured:0,source:'default' as const},apiKey:{configured:false,source:'default' as const},holderRpcUrls:{configured:0,source:'default' as const},holderRpcFallbackUrls:{configured:0,source:'default' as const},webhookUrl:{value:null,source:'default' as const},webhookSecret:{configured:false,source:'default' as const},ready:{rpc:false,holder:false,webhook:false},invalid:[]};

function mount(open:boolean){
  api.settings.mockResolvedValue({items:[{key:'early_access.enabled',value:open},{key:'early_access.seat_cap',value:25}]});
  api.stats.mockResolvedValue({occupied:3,available:22,cap:25,active:3,expired:1,revoked:0});
  api.grants.mockResolvedValue({items:[]});api.runtime.mockResolvedValue(runtime);api.integrations.mockResolvedValue(integrations);api.helius.mockResolvedValue(helius);api.save.mockResolvedValue({ok:true});api.saveIntegrations.mockResolvedValue(integrations);api.saveHelius.mockResolvedValue(helius);api.testTelegram.mockResolvedValue({ok:true});api.testHelius.mockResolvedValue({});api.lookup.mockResolvedValue({items:[]});
  const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0},mutations:{retry:false}}});
  render(<NextIntlClientProvider locale="en" messages={{workspace:en}}><QueryClientProvider client={client}><AdminPage/></QueryClientProvider></NextIntlClientProvider>);
  return client;
}

describe('admin dashboard',()=>{
  beforeEach(()=>{session.me.data={isAdmin:true,admin:{configured:true,privyUserId:'did:privy:admin-1',email:'admin@example.com'}};api.settings.mockReset();api.stats.mockReset();});
  it('leads with the early-access state and seat metrics before any form',async()=>{
    mount(true);
    const overview=await screen.findByRole('region',{name:en.adminOverview});
    expect(within(overview).getByText(en.adminStateOpen)).toBeInTheDocument();
    const metric=(label:string)=>within(overview).getByText(label).nextElementSibling;
    await waitFor(()=>expect(metric(en.adminMetricUsed)).toHaveTextContent('3'));
    expect(metric(en.adminMetricAvailable)).toHaveTextContent('22');
    expect(metric(en.adminMetricCap)).toHaveTextContent('25');
    expect(metric(en.adminMetricActive)).toHaveTextContent('3');
  });
  it('shows a closed state and explains why saving is blocked',async()=>{
    mount(false);
    expect(await screen.findByText(en.adminStateClosed)).toBeInTheDocument();
    const settings=document.querySelector('section[aria-labelledby="admin-settings"]') as HTMLElement;
    const save=within(settings).getByRole('button',{name:en.adminSave});
    expect(save).toBeDisabled();
    expect(within(settings).getByText(en.adminHintReason)).toBeInTheDocument();
    fireEvent.change(document.querySelector('#admin-reason')!,{target:{value:'Open early access'}});
    expect(save).toBeEnabled();
    expect(within(settings).queryByText(en.adminHintReason)).toBeNull();
  });
  it('separates admin areas into tabs and mounts only the selected panel', async () => {
    mount(true);
    const access = await screen.findByRole('tab', {name: en.adminTabAccess});
    expect(access).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(screen.getByRole('tab', {name: en.adminTabResearch}));
    expect(await screen.findByText(en.smartResearch.adminTitle)).toBeInTheDocument();
    expect(screen.queryByText(en.adminSettings)).toBeNull();
    await userEvent.click(screen.getByRole('tab', {name: en.adminTabRuntime}));
    expect(await screen.findByText(en.runtime.title)).toBeInTheDocument();
  });
  it('shows a signed-in non-admin only the notice and their own ids, and makes no admin request',async()=>{
    session.me.data={isAdmin:false,admin:{configured:true,privyUserId:'did:privy:stranger',email:null}};
    api.settings.mockResolvedValue({items:[]});
    const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
    render(<NextIntlClientProvider locale="en" messages={{workspace:en}}><QueryClientProvider client={client}><AdminPage/></QueryClientProvider></NextIntlClientProvider>);
    expect(await screen.findByText(en.adminForbidden)).toBeInTheDocument();
    expect(screen.getByText('did:privy:stranger')).toBeInTheDocument();
    expect(screen.queryByText(en.adminSettings)).toBeNull();
    expect(api.settings).not.toHaveBeenCalled();
  });
});
