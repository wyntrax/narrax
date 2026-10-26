import {render,screen,cleanup,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,it,expect,vi} from 'vitest';
import {NextIntlClientProvider} from 'next-intl';
import type {ReactNode} from 'react';
import type {ZodTypeAny} from 'zod';
import en from '../../../messages/research/en.json';
import id from '../../../messages/research/id.json';
import {analyticsFixture} from '../../test/analytics-fixture';
import {AnalyticsPage} from './analytics';
const state=vi.hoisted(()=>({paths:[] as string[],empty:false}));
vi.mock('@/i18n/navigation',()=>({useRouter:()=>({push:vi.fn()}),Link:({href,children}:{href:string;children:ReactNode})=><a href={href}>{children}</a>}));
vi.mock('./session',()=>({useResearchQuery:(path:string,schema:ZodTypeAny)=>{
 state.paths.push(path);const url=new URL(path,'https://fixture/');
 const value=state.empty&&path.includes('/outcomes')?{items:[],nextCursor:null}:analyticsFixture(url.pathname,url);
 return {data:schema.parse(value),isPending:false,isError:false,isFetching:false};
}}));
afterEach(()=>{cleanup();state.paths=[];state.empty=false;});
const view=(locale='en')=>render(<NextIntlClientProvider locale={locale} messages={{workspace:locale==='id'?id:en}}><AnalyticsPage/></NextIntlClientProvider>);
it('applies action and date to every panel and resets outcome pagination when either changes',async()=>{
 view();await userEvent.click(screen.getByRole('button',{name:'Next page'}));
 expect(state.paths.at(-1)).toContain('cursor=fixture-cursor');
 await userEvent.selectOptions(screen.getByLabelText('Decision action'),'WATCH');
 for(const endpoint of ['decisions/summary','signals','decisions/outcomes']){
  const url=new URL(state.paths.filter(p=>p.includes(endpoint)).at(-1)!,'https://fixture/');
  expect(url.searchParams.get('action')).toBe('WATCH');expect(url.searchParams.get('days')).toBe('30');expect(url.searchParams.has('cursor')).toBe(false);
 }
 expect(screen.getByText(/No hypothetical buy, sell, short position/)).toBeVisible();
 await userEvent.click(screen.getByRole('button',{name:'Next page'}));
 await userEvent.selectOptions(screen.getByLabelText('Window'),'7');
 for(const endpoint of ['decisions/summary','signals','decisions/outcomes']){
  const url=new URL(state.paths.filter(p=>p.includes(endpoint)).at(-1)!,'https://fixture/');
  expect(url.searchParams.get('days')).toBe('7');expect(url.searchParams.has('cursor')).toBe(false);
 }
});
it('distinguishes pending from ended-unavailable and preserves partial and genuine zero measurements',()=>{
 view();
 const rows=within(screen.getByRole('table',{name:'Recent outcomes'}));
 expect(rows.getByText(/within 15 minutes before the decision/)).toBeVisible();
 expect(rows.getByText(/within 30 minutes after the 24h target/)).toBeVisible();
 expect(rows.getByText(/Waiting for the 24h price/)).toBeVisible();
 expect(rows.getByText(/no more specific reason is available/)).toBeVisible();
 expect(rows.getAllByText('Measurement ended — unavailable')).toHaveLength(3);
 const partial=within(rows.getByText('HORIZON').closest('tr')!);
 expect(partial.getByText('2%')).toBeVisible();expect(partial.queryByText('0%')).toBeNull();
 const known=within(rows.getByText('KNOWN').closest('tr')!);
 expect(known.getByText('Measurement complete')).toBeVisible();expect(known.getByText('FLAT')).toBeVisible();expect(known.getAllByText('0%')).toHaveLength(3);
 expect(screen.queryByText('Final',{exact:true})).toBeNull();
});
it('shows coverage, distinct-token samples and unavailable rate beside price-only results',()=>{
 view();expect(screen.getByText('75%')).toBeVisible();
 expect(screen.getByText(/1 of 4 completed measurements/)).toBeVisible();
 expect(screen.getByText('Awaiting first measurement')).toBeVisible();
 expect(screen.getByText(/not wallet P&L or executed trades/)).toBeVisible();
 expect(screen.getAllByRole('columnheader',{name:'Distinct tokens'})).toHaveLength(2);
 expect(screen.getByText(/round-trip cost of 3%/)).toBeVisible();
});
it('explains an empty filtered outcome list',()=>{
 state.empty=true;view();expect(screen.getByText(/No recorded outcomes match this action and window/)).toBeVisible();
 expect(screen.getByRole('button',{name:'Next page'})).toBeDisabled();
});
it('renders the filters, coverage and missing-price reasons in Indonesian',()=>{
 view('id');expect(screen.getByLabelText('Aksi keputusan')).toBeVisible();
 expect(screen.getByText(/dalam 15 menit sebelumnya/)).toBeVisible();
 expect(screen.getByText(/1 dari 4 pengukuran selesai/)).toBeVisible();
});
