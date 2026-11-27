import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {NextIntlClientProvider} from 'next-intl';
import type {ReactNode} from 'react';
import messages from '../../../messages/research/en.json';
import {OverviewPage} from './overview';

const fixture={
 at:'2026-11-27T00:00:00Z',
 bar:{solUsd:195,narrativeHeat:74,smartMoneyNetFlowSol24h:18.5,smartMoneyTokens24h:4,counts:{activeNarratives:6,acceleratingNarratives:2,trackedWallets:48,opportunities24h:5}},
 locked:{overview:false,narratives:false,rotation:false,opportunities:false},
 strip:{
  topNarratives:[{id:'n1',name:'AI Agents',slug:'ai-agents',stage:'ACCELERATING',score:84,velocity:140}],
  hottestOpportunity:{id:'o1',score:76,createdAt:'2026-11-27T00:00:00Z',narrative:{name:'AI Agents',slug:'ai-agents'},token:{mint:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',symbol:'AGENT',name:'Agent Token',priceUsd:0.12,marketCapUsd:1200000}},
 },
 rotation:{detected:true,rising:[{id:'n1',name:'AI Agents',slug:'ai-agents',from:60,to:84}],falling:[{id:'n2',name:'Old Meme',slug:'old-meme',from:70,to:42}],unknown:1},
 brief:{generated:'rules',points:['AI Agents leads attention velocity.','Two narratives are accelerating.']},
 me:{openPositions:2,pendingConfirmations:1,unreadAlerts:3},
};

vi.mock('@/i18n/navigation',()=>({Link:({href,children,className}:{href:string;children:ReactNode;className?:string})=><a href={href} className={className}>{children}</a>}));
vi.mock('./session',()=>({useResearchQuery:()=>({data:fixture,isPending:false,isError:false,isFetching:false,refetch:vi.fn()})}));
afterEach(()=>cleanup());

it('renders overview KPIs, structured market brief, ranked narratives, rotation, and opportunity details',()=>{
 render(<NextIntlClientProvider locale="en" messages={{workspace:messages}}><OverviewPage/></NextIntlClientProvider>);
 expect(screen.getByText('AI Agents leads attention velocity.')).toBeVisible();
 expect(screen.getAllByText('AI Agents').length).toBeGreaterThanOrEqual(2);
 expect(screen.getByText('60 → 84')).toBeVisible();
 expect(screen.getByText('70 → 42')).toBeVisible();
 expect(screen.getByText('AGENT')).toBeInTheDocument();
});
