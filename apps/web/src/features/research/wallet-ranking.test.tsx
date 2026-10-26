import {render,screen,cleanup} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,it,expect,vi} from 'vitest';
import {NextIntlClientProvider} from 'next-intl';
import type {ReactNode} from 'react';
import messages from '../../../messages/research/en.json';
import {rankingFixture} from '../../test/wallet-ranking-fixture';
import {WalletLeaderboard} from './wallet-ranking';
const state=vi.hoisted(()=>({paths:[] as string[],empty:false,disabled:false}));
vi.mock('@/i18n/navigation',()=>({useRouter:()=>({push:vi.fn()}),Link:({href,children}:{href:string;children:ReactNode})=><a href={href}>{children}</a>}));
vi.mock('./session',()=>({useResearchQuery:(path:string)=>{state.paths.push(path);return {data:{...rankingFixture,items:state.empty?[]:rankingFixture.items,pipeline:{...rankingFixture.pipeline,historyEnabled:!state.disabled}},isPending:false,isError:false};}}));
afterEach(()=>{cleanup();state.paths=[];state.empty=false;state.disabled=false;});
const view=(locale='en')=>render(<NextIntlClientProvider locale={locale} messages={{workspace:messages}}><WalletLeaderboard/></NextIntlClientProvider>);
it('shows observed win/loss samples, exact SOL results and first/last-sale timing without claiming approval',async()=>{
 view();expect(screen.getByText('12.345678901')).toBeVisible();expect(screen.getByText('Observing')).toBeVisible();
 expect(screen.getByText('16 wins / 4 losses / 0 breakeven')).toBeVisible();
 expect(screen.getByText(/First sell: 15/)).toBeVisible();expect(screen.getByText(/Observed close: 1/)).toBeVisible();
 await userEvent.click(screen.getByText('Evidence'));expect(screen.getByText('History incomplete or stale')).toBeVisible();
 expect(screen.queryByText('Ready for review')).toBeNull();
});
it('requests an explicit entry band and keeps missing historical caps explainable',async()=>{
 state.empty=true;view();await userEvent.selectOptions(screen.getByLabelText('Market cap at entry'),'UNKNOWN');
 expect(state.paths.at(-1)).toContain('band=UNKNOWN');expect(screen.getByText(/historical market caps cannot be inferred/)).toBeVisible();
});
it('reports worker configuration instead of implying waiting alone will fetch wallets',()=>{
 state.disabled=true;view();expect(screen.getByText('Automatic history collection is disabled on the worker.')).toBeVisible();
});
it('renders Indonesian ranking and evidence labels',async()=>{
 view('id');expect(screen.getByRole('heading',{name:'Peringkat wallet small-cap'})).toBeVisible();
 await userEvent.click(screen.getByText('Bukti'));expect(screen.getByText('Riwayat tidak lengkap atau kedaluwarsa')).toBeVisible();
});
