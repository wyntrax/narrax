import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {NextIntlClientProvider} from 'next-intl';
import {afterEach,it,expect,vi} from 'vitest';
import type {ReactNode} from 'react';
import messages from '../../../messages/research/en.json';
import {DataHealthCard} from './data-health-card';
import {DataHealthSchema,ResearchCoverageSchema,type DataHealth} from './contracts';
import type {AdminApi} from './api';
import {ApiError} from '@/lib/api';
vi.mock('@/i18n/navigation',()=>({useRouter:()=>({push:vi.fn()}),Link:({href,children}:{href:string;children:ReactNode})=><a href={href}>{children}</a>}));
vi.mock('@/components/auth/context',()=>({useAuth:()=>({logout:vi.fn()})}));
const at='2026-10-18T12:00:00.000Z';
const fixture:DataHealth={checkedAt:at,issues:['NO_DELIVERY_EVIDENCE','INSUFFICIENT_WALLET_HISTORY'],queues:[{name:'wallet-events',state:'UNKNOWN',counts:null,lastCompletedAt:null,lastFailedAt:null,lastRun:null}],webhook:{configured:true,lastReceipt:null,sync:{at,action:'in_sync',active:true,desired:10,hasError:false}},wallets:{tracked:10,profiles:3,withoutProfile:7,trades30d:1338,lastTradeAt:at,lastComputedAt:at,scanned:10,capped:false,missingComputations:0,staleComputations:0,historyCapped:3},market:{scanned:20,total:20,capped:false,fresh:10,stale:5,unverified:5,lastAt:at,enabled:true,unknownNames:0},analysis:{enabled:true,providerConfigured:true,fastModel:'model-fast',reasoningModel:'model-reason',usedToday:100,budget:1000,recentCandidates:3,recentBelowThreshold:5,olderUnanalyzed:100}};
afterEach(cleanup);
it('keeps failed source ingestion distinct from recent narrative resolution',async()=>{
 mount(vi.fn(async()=>({...fixture,collectors:[{stage:'narrative',state:'OK',lastRecordedAt:at,ageSeconds:10,maxAgeSeconds:1800,counters:{errors:0}},{stage:'narrative-ingestion',state:'WARNING',lastRecordedAt:at,ageSeconds:10,maxAgeSeconds:2100,counters:{providerErrors:7,mentionsStored:0,narrativesUpdated:0}}]})));
 expect(await screen.findByText('Narrative token resolution',{exact:true})).toBeVisible();
 expect(screen.getByText('Narrative source ingestion',{exact:true})).toBeVisible();
 expect(screen.getByText(/does not mean external sources refreshed successfully/)).toBeVisible();
});
it('shows stale collectors, unknown telemetry, fixed budgets and sampled artwork without fabricating usage',async()=>{
 mount(vi.fn(async()=>({...fixture,collectors:[{stage:'market',state:'STALE',lastRecordedAt:at,ageSeconds:1200,maxAgeSeconds:900,counters:{tokensConsidered:0,infoCalls:0}},{stage:'social',state:'UNKNOWN',lastRecordedAt:null,ageSeconds:null,maxAgeSeconds:1800,counters:null}],budgets:{priceTokensPerRun:150,infoCallsPerRun:18,lastPriceTokens:0,lastInfoCalls:0},market:{...fixture.market,withStoredArtwork:8,withoutStoredArtwork:12,future:1}})));
 expect(await screen.findByRole('heading',{name:'Collector health'})).toBeVisible();
 expect(screen.getByText('Stale run')).toBeVisible();expect(screen.getByText('150')).toBeVisible();expect(screen.getByText('18')).toBeVisible();
 expect(screen.getByText(/not a process heartbeat/)).toBeVisible();expect(screen.getByText(/does not test CDN availability/)).toBeVisible();
 expect(screen.getByText('Last run: price tokens selected').nextElementSibling).toHaveTextContent('0');
});
it('keeps absent diagnostics unknown and displays measured coverage with partial-day caveats',async()=>{
 const counts={fresh:1,stale:2,missing:3,future:0};
 const coverage=ResearchCoverageSchema.parse({checkedAt:at,scope:'ACTIVE_NARRATIVE_OR_RECENT_SOCIAL',scanned:6,total:10,capped:true,socialPriorityCount:2,price:{...counts,unverified:0},holders:counts,risk:counts,freshPriceAndHolders:1,stages:[{stage:'market',stale:true,latest:null,today:null},{stage:'social',stale:false,latest:{at,runs:1,counters:{'evidence.HOLDERS_MISSING':3}},today:{at,runs:2,counters:{'evidence.HOLDERS_MISSING':6}}}],calls:{published24h:1,unknownEntry24h:0,measurements:{PENDING:3}}});
 mount(vi.fn(async()=>({...fixture,coverage})));
 expect(await screen.findByRole('heading',{name:'Research coverage & discovery'})).toBeVisible();
 expect(screen.getByText('Bounded sample',{exact:false})).toBeVisible();
 expect(screen.getAllByText('Unknown — no recorded diagnostics').length).toBeGreaterThan(0);
 expect(screen.getByText(/not unique tokens or missed calls/)).toBeVisible();
 expect(ResearchCoverageSchema.safeParse({...coverage,holders:{...counts,missing:-1}}).success).toBe(false);
});
it('shows placeholder-model guidance and the configured model names',async()=>{
 mount(vi.fn(async()=>({...fixture,issues:['AI_MODEL_PLACEHOLDER'],analysis:{...fixture.analysis,fastModel:'gpt-6-luna',reasoningModel:'gpt-6-sol'}})));
 expect(await screen.findByText(/will be rejected by the provider/,{},{timeout:5000})).toHaveTextContent('Admin AI settings');
 expect(screen.getByText('gpt-6-luna / gpt-6-sol')).toBeVisible();
});
function mount(dataHealth:ReturnType<typeof vi.fn>){const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});return render(<NextIntlClientProvider locale="en" messages={{workspace:messages}}><QueryClientProvider client={client}><DataHealthCard api={{dataHealth} as unknown as AdminApi} queryKey={['test-health']}/></QueryClientProvider></NextIntlClientProvider>);}
it('shows unknown delivery and partial histories without claiming the webhook is healthy',async()=>{
 expect(DataHealthSchema.safeParse(fixture).success).toBe(true);mount(vi.fn(async()=>fixture));
 expect(await screen.findByRole('heading',{name:'Wallet webhook'},{timeout:5000})).toBeVisible();
 expect(screen.getByText(/No non-empty authenticated webhook delivery/)).toBeVisible();
 expect(screen.getByText(/3 wallets reached their historical scan limit/)).toBeVisible();
 expect(screen.getByText(/Empty probes do not count/)).toBeVisible();
 expect(screen.getByText('wallet-events').closest('tr')).not.toHaveAttribute('tabindex');
});
it('refreshes manually and keeps the last snapshot visibly marked after a failed refresh',async()=>{
 const call=vi.fn().mockResolvedValueOnce(fixture).mockRejectedValueOnce(new ApiError('NETWORK'));mount(call);
 await screen.findByRole('heading',{name:'Wallet webhook'},{timeout:5000});
 fireEvent.click(screen.getByRole('button',{name:'Refresh'}));
 await waitFor(()=>expect(call).toHaveBeenCalledTimes(2));
 expect(await screen.findByText(/Showing the last successful snapshot/,{},{timeout:5000})).toBeVisible();
 expect(screen.getByRole('heading',{name:'Wallet intelligence'})).toBeVisible();
});
