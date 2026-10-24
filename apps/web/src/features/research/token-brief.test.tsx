import {render,screen,fireEvent,cleanup,act,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {NextIntlClientProvider} from 'next-intl';
import type {ReactNode} from 'react';
import messages from '../../../messages/research/en.json';
import {ApiError} from '@/lib/api';
import {MintLookup,CopyMint} from './mint-lookup';
import {TokenBrief,tokenMarketState,observedTokenMetrics,TOKEN_MARKET_MAX_AGE_MS} from './token-brief';
import {TokenPage} from './tokens';
import type {Token} from './contracts';

const mocked=vi.hoisted(()=>({push:vi.fn(),query:vi.fn(),allowed:true}));
vi.mock('@/i18n/navigation',()=>({useRouter:()=>({push:mocked.push}),Link:({href,children,...props}:{href:string;children:ReactNode})=><a href={href} {...props}>{children}</a>}));
vi.mock('./session',()=>({hasFeature:()=>mocked.allowed,useResearch:()=>({access:{features:{'research.tokens':{requiredTier:'PRO'}}}}),useResearchQuery:mocked.query}));
vi.mock('next/dynamic',()=>({default:()=>()=>null}));
vi.mock('@/components/auth/context',()=>({useAuth:()=>({logout:vi.fn()})}));
const mint='So11111111111111111111111111111111111111112';
const at='2026-10-21T00:00:00.000Z',now=Date.parse(at);
const token:Token={mint,symbol:'DEMO',name:'Demo',blacklisted:false,createdOnChainAt:null,
 observation:{source:'dexscreener',at,stale:false,marketCapIsFdv:true,priceChange1hPct:0,pairAddress:mint,dexId:'raydium',pairCreatedAt:null},
 metrics:{priceUsd:123,marketCapUsd:100000,liquidityUsd:10000,volume24hUsd:0,at},holders:null,risk:null,consensus:null,narratives:[]};
function view(children:ReactNode){return render(<NextIntlClientProvider locale="en" timeZone="UTC" messages={{workspace:messages}}>{children}</NextIntlClientProvider>);}
beforeEach(()=>{mocked.allowed=true;mocked.query.mockReturnValue({data:token,isPending:false,isError:false,isFetching:false,refetch:vi.fn()});});
afterEach(()=>{cleanup();vi.useRealTimers();vi.clearAllMocks();vi.unstubAllGlobals();});

it('opens the exact mint independently of list filters, preserving case and trimming whitespace',()=>{
 view(<MintLookup/>);fireEvent.change(screen.getByRole('textbox'),{target:{value:`  ${mint}  `}});fireEvent.click(screen.getByRole('button',{name:messages.brief.open}));
 expect(mocked.push).toHaveBeenCalledWith(`/app/tokens/${mint}`);
});
it.each(['','ROBOT','https://solscan.io/token/'+mint,'A'.repeat(32),'0'.repeat(44)])('rejects invalid mint input %s without navigating',value=>{
 view(<MintLookup/>);fireEvent.change(screen.getByRole('textbox'),{target:{value}});fireEvent.click(screen.getByRole('button',{name:messages.brief.open}));
 expect(mocked.push).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toHaveTextContent(messages.brief.invalid);expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid','true');
});
it('requires fresh matched evidence for current indicators',()=>{
 expect(tokenMarketState(token,now)).toBe('fresh');
 expect(tokenMarketState(token,now+TOKEN_MARKET_MAX_AGE_MS)).toBe('fresh');
 expect(tokenMarketState(token,now+TOKEN_MARKET_MAX_AGE_MS+1)).toBe('stale');
 expect(tokenMarketState(token,now-1)).toBe('stale');
 expect(tokenMarketState({...token,observation:null},now)).toBe('missing');
 expect(tokenMarketState({...token,metrics:null},now)).toBe('missing');
 expect(tokenMarketState({...token,observation:{...token.observation!,stale:true}},now)).toBe('stale');
 expect(tokenMarketState({...token,metrics:{...token.metrics!,at:'2026-10-20T00:00:00.000Z'}},now)).toBe('stale');
});
it('preserves measured zero, but never divides by zero or substitutes missing evidence',()=>{
 const {rerender}=view(<TokenBrief token={token} state="fresh"/>);
 expect(screen.getByText('0%')).toBeVisible();expect(screen.getByText('0×')).toBeVisible();expect(screen.getByText(messages.brief.holdersMissing)).toBeVisible();
 rerender(<NextIntlClientProvider locale="en" timeZone="UTC" messages={{workspace:messages}}><TokenBrief token={{...token,metrics:{...token.metrics!,liquidityUsd:0}}} state="fresh"/></NextIntlClientProvider>);
 expect(screen.queryByText('0×')).toBeNull();expect(screen.queryByText(/Infinity/)).toBeNull();
});
it('labels an expired snapshot as last observed while withholding current indicators',()=>{
 vi.useFakeTimers();vi.setSystemTime(now);view(<TokenPage mint={mint}/>);
 expect(screen.getByText('$123')).toBeVisible();expect(screen.getByText(messages.brief.states.fresh)).toBeVisible();
 act(()=>vi.advanceTimersByTime(TOKEN_MARKET_MAX_AGE_MS+15000));
  expect(screen.getByText('$123')).toBeVisible();expect(screen.getByText(messages.brief.lastObserved)).toBeVisible();expect(screen.queryByText('0%')).toBeNull();expect(screen.getAllByText(messages.brief.needsFresh)).toHaveLength(2);expect(screen.getByText(messages.brief.states.stale)).toBeVisible();
});
it('shows genuine past observations but never displays future, unmatched or missing prices as history',()=>{
 expect(observedTokenMetrics(token,now+86400000)).toEqual(token.metrics);
 expect(observedTokenMetrics({...token,observation:null},now)).toBeNull();
 expect(observedTokenMetrics({...token,metrics:null},now)).toBeNull();
 expect(observedTokenMetrics(token,now-1)).toBeNull();
 expect(observedTokenMetrics({...token,metrics:{...token.metrics!,at:'2026-10-20T00:00:00.000Z'}},now)).toBeNull();
 vi.useFakeTimers();vi.setSystemTime(now-1);view(<TokenPage mint={mint}/>);
 expect(screen.queryByText('$123')).toBeNull();expect(screen.getByText(messages.brief.marketMissing)).toBeVisible();
});
it('keeps old model snapshots distinct from verified market evidence',()=>{
 view(<TokenBrief token={{...token,holders:{holders:100,top10Pct:50,devHoldingPct:null,smartWalletHolders:0,at},risk:{riskScore:0,flags:[],at}}} state="missing"/>);
 expect(screen.getAllByText(/Stored snapshot:/)).toHaveLength(2);expect(screen.getByText(messages.brief.coverageNote)).toBeVisible();
 expect(screen.queryByText('0%')).toBeNull();expect(screen.queryByText(messages.noFlags)).toBeNull();
});
it('does not query invalid direct-route addresses and retains feature locks',()=>{
 const {rerender}=view(<TokenPage mint="invalid"/>);
 expect(mocked.query.mock.calls.at(-1)?.[2]).toBe(false);expect(screen.getByText(messages.brief.invalid)).toBeVisible();
 mocked.allowed=false;
 rerender(<NextIntlClientProvider locale="en" messages={{workspace:messages}}><TokenPage mint={mint}/></NextIntlClientProvider>);
 expect(mocked.query.mock.calls.at(-1)?.[2]).toBe(false);expect(screen.queryByText(messages.brief.title)).toBeNull();expect(screen.getByText(messages.locked)).toBeVisible();
});
it('distinguishes an unindexed mint from a provider or transport failure',()=>{
 mocked.query.mockReturnValue({isError:true,error:new ApiError('NOT_FOUND',404),refetch:vi.fn()});view(<TokenPage mint={mint}/>);
 expect(screen.getByRole('heading',{name:messages.brief.notIndexed})).toBeVisible();expect(screen.getByRole('link',{name:'Solscan ↗'})).toHaveAttribute('href',`https://solscan.io/token/${mint}`);
 cleanup();mocked.query.mockReturnValue({isError:true,error:new ApiError('NETWORK'),refetch:vi.fn()});view(<TokenPage mint={mint}/>);
 expect(screen.queryByText(messages.brief.notIndexed)).toBeNull();expect(screen.getByRole('alert')).toHaveTextContent(messages.requestErrors.network);
});
it('reports clipboard failure without claiming the mint was copied',async()=>{
 vi.stubGlobal('navigator',{clipboard:{writeText:vi.fn().mockRejectedValue(new Error('denied'))}});view(<CopyMint mint={mint}/>);
 fireEvent.click(screen.getByRole('button',{name:messages.brief.copy}));await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent(messages.brief.failed));
});
