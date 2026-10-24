import {render,screen,cleanup} from '@testing-library/react';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {NextIntlClientProvider} from 'next-intl';
import type {ReactNode} from 'react';
import messages from '../../../messages/research/en.json';
import {MarketWatch} from './market-watch';

const mocked=vi.hoisted(()=>({query:vi.fn()}));
vi.mock('@/i18n/navigation',()=>({useRouter:()=>({push:vi.fn()}),Link:({href,children}:{href:string;children:ReactNode})=><a href={href}>{children}</a>}));
vi.mock('./session',()=>({
 hasFeature:()=>true,
 useResearch:()=>({access:{features:{'research.tokens':{allowed:true,requiredTier:'PRO'},'research.screener':{allowed:true,requiredTier:'PRO'}}}}),
 useResearchQuery:mocked.query,
}));
const at='2026-10-21T00:00:00.000Z';
const observation={source:'dexscreener',at,stale:false,marketCapIsFdv:false,priceChange1hPct:1.5,pairAddress:'pair',dexId:'raydium',pairCreatedAt:at};
const token={mint:'mint',symbol:'DEMO',name:'Demo',imageUrl:'https://dd.dexscreener.com/ds-data/tokens/solana/mint.png',priceUsd:2,marketCapUsd:100000,liquidityUsd:10000,volume24hUsd:5000,observation};
function view(){return render(<NextIntlClientProvider locale="en" timeZone="UTC" messages={{workspace:messages}}><MarketWatch/></NextIntlClientProvider>);}
beforeEach(()=>{mocked.query.mockReturnValue({data:{items:[token],nextCursor:null},isPending:false,isError:false,isFetching:false,refetch:vi.fn()});});
afterEach(()=>{cleanup();vi.clearAllMocks();});

it('keeps a matched older observation readable but labels it as historical rather than current',()=>{
 view();
 expect(screen.getByText('$2')).toBeVisible();
 expect(screen.getByText(messages.trench.lastObserved)).toBeVisible();
 expect(screen.getByText(/Stale snapshot/)).toBeVisible();
});
it('shows the provider token image in the list without making it the identity',()=>{
 const {container}=view();
 const image=container.querySelector('img');
 expect(image?.getAttribute('src')).toBe(token.imageUrl);
 expect(image?.getAttribute('alt')).toBe('');
 expect(screen.getByText('DEMO')).toBeVisible();
 expect(screen.getByText('Demo')).toBeVisible();
});
it('does not present a future-dated observation or a missing one as market history',()=>{
 mocked.query.mockReturnValueOnce({data:{items:[{...token,observation:{...observation,at:'2030-01-01T00:00:00.000Z',stale:true}},{...token,mint:'other',symbol:'NONE',observation:null}],nextCursor:null},isPending:false,isError:false,isFetching:false,refetch:vi.fn()});
 view();
 expect(screen.queryByText('$2')).toBeNull();
 expect(screen.getAllByText(messages.trench.unverified).length).toBeGreaterThan(0);
});
