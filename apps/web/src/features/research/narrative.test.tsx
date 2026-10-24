import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {NextIntlClientProvider} from 'next-intl';
import type {ReactNode} from 'react';
import messages from '../../../messages/research/en.json';
import {NarrativePage} from './narrative';
const push=vi.hoisted(()=>vi.fn());
const state=vi.hoisted(()=>({data:{}} as {data:Record<string,unknown>}));
vi.mock('@/i18n/navigation',()=>({useRouter:()=>({push}),Link:({href,children}:{href:string;children:ReactNode})=><a href={href}>{children}</a>}));
vi.mock('./session',()=>({hasFeature:()=>true,useResearch:()=>({access:{features:{}}}),useResearchQuery:()=>({isPending:false,isError:false,data:state.data})}));
const token={mint:'mint',symbol:'TOKEN',name:'Token name',relation:'LIKELY_OG',ogScore:30,confidence:.5,marketCapUsd:10000,liquidityUsd:5000};
const base={name:'Narrative',stage:'EMERGING',updatedAt:'2026-10-18T00:00:00Z',firstDetectedAt:'2026-10-17T00:00:00Z',creators:[],tokens:[token]};
function view(){return render(<NextIntlClientProvider locale="en" messages={{workspace:messages}}><NarrativePage slug="narrative"/></NextIntlClientProvider>);}
afterEach(()=>{cleanup();push.mockClear();state.data={};});
it('opens a related token from the relation cell, not only the token-name link',()=>{
 state.data={...base};
 view();
 fireEvent.click(screen.getByText('LIKELY_OG'));
 expect(push).toHaveBeenCalledWith('/app/tokens/mint');
 expect(screen.getByText('LIKELY_OG').closest('tr')).toHaveClass('research-clickable-row');
});
it('puts related tokens directly under the lifecycle card',()=>{
 state.data={...base,creators:[{platform:'X',handle:'creator',role:'ORIGINATOR'}]};
 view();
 const lifecycle=screen.getByRole('heading',{name:messages.lifecycle}).closest('section')!;
 const tokens=screen.getByRole('heading',{name:messages.relatedTokens}).closest('section')!;
 const social=screen.getByRole('heading',{name:messages.social}).closest('section')!;
 expect(lifecycle.compareDocumentPosition(tokens)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 expect(tokens.compareDocumentPosition(social)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
it('says the creator list is capped once it reaches 50 rows',()=>{
 state.data={...base,creators:Array.from({length:50},(_,i)=>({platform:'X',handle:`creator${i}`,role:'FOLLOWER'}))};
 view();
 expect(screen.getByText(messages.creatorsCap)).toBeVisible();
});
it('does not claim a cap while every related creator is listed',()=>{
 state.data={...base,creators:Array.from({length:49},(_,i)=>({platform:'X',handle:`creator${i}`,role:'FOLLOWER'}))};
 view();
 expect(screen.queryByText(messages.creatorsCap)).toBeNull();
});
