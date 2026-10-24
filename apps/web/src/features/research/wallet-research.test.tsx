import {render,screen,cleanup} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,it,expect,vi} from 'vitest';
import {NextIntlClientProvider} from 'next-intl';
import type {ReactNode} from 'react';
import messages from '../../../messages/research/en.json';
import {WalletResearchViews,QualificationBadge} from './wallet-research';
const state=vi.hoisted(()=>({paths:[] as string[]}));
vi.mock('@/i18n/navigation',()=>({useRouter:()=>({push:vi.fn()}),Link:({href,children}:{href:string;children:ReactNode})=><a href={href}>{children}</a>}));
vi.mock('./session',()=>({useResearchQuery:(path:string)=>{
 state.paths.push(path);return {isPending:false,isError:false,isFetching:false,refetch:vi.fn(),data:path.includes('emerging')?{snapshot:null}:{nextCursor:null,asOf:new Date().toISOString(),items:[{id:'flow',side:'SELL',createdAt:'2026-01-01T00:00:00Z',stale:true,independentEntities:2,netFlowSol:-2,token:{mint:'mint',symbol:'TOKEN'},evidence:{trades:[]},measurements:[{horizonHours:1,status:'MEASURED',returnPct:-25},{horizonHours:4,status:'UNKNOWN',returnPct:null},{horizonHours:24,status:'PENDING',returnPct:null}]}]}};
}}));
afterEach(()=>{cleanup();state.paths=[];});
const view=(node:ReactNode)=>render(<NextIntlClientProvider locale="en" messages={{workspace:messages}}>{node}</NextIntlClientProvider>);
it('loads flow evidence on demand and preserves SELL token returns and missing horizons',async()=>{
 const user=userEvent.setup();view(<WalletResearchViews/>);expect(state.paths).toEqual([]);
 await user.click(screen.getByRole('button',{name:'Token flows'}));
 expect(screen.getByText('Net selling')).toBeVisible();expect(screen.getByText('1h: -25%')).toBeVisible();
 expect(screen.getByText('4h: Unknown')).toBeVisible();expect(screen.getByText('24h: Pending')).toBeVisible();
 expect(screen.getByText('Historical / stale')).toBeVisible();expect(screen.getByText(messages.smartResearch.outcomeNote)).toBeVisible();
});
it('keeps emerging data explicitly provisional when no snapshot exists',async()=>{
 const user=userEvent.setup();view(<WalletResearchViews/>);
 await user.click(screen.getByRole('button',{name:'Emerging wallets'}));
 expect(screen.getByText(messages.smartResearch.emergingNote)).toBeVisible();expect(screen.getByText(messages.smartResearch.noEmerging)).toBeVisible();
});
it('surfaces sample breadth and evidence gaps instead of promoting a high score',async()=>{
 view(<QualificationBadge value={{status:'PROVISIONAL',eligible:false,reasons:['TOO_FEW_CLOSES'],rulesVersion:1,sample:{closedTrades:6,closedTokens:1,observedDays:2,pnlSol:1,medianRoi:0.1,lastTradeAt:null,checkedAt:new Date().toISOString()}}}/>);
 expect(screen.getByText('Provisional')).toBeVisible();expect(screen.getByText('6 closed legs · 1 tokens · 2 observed days')).toBeVisible();
 await userEvent.click(screen.getByText('Evidence gaps'));expect(screen.getByText('Fewer than 20 observed closed legs.')).toBeVisible();
});
