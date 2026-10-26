import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {NextIntlClientProvider} from 'next-intl';
import messages from '../../../messages/research/en.json';
import {PriceHistoryChart} from './token-chart';
vi.mock('./session',()=>({useResearchQuery:vi.fn()}));
vi.mock('@/i18n/navigation',()=>({Link:()=>null,useRouter:()=>({push:vi.fn()})}));
afterEach(cleanup);
const point=(minute:number,priceUsd:number)=>({at:new Date(Date.UTC(2026,9,18,0,minute)).toISOString(),priceUsd,source:'dexscreener' as const,pairAddress:'pool'});
it('exposes timestamp and price through a keyboard-accessible observation slider',()=>{
 render(<NextIntlClientProvider locale="en" messages={{workspace:messages}}><PriceHistoryChart points={[point(0,1),point(5,2)]}/></NextIntlClientProvider>);
 const slider=screen.getByRole('slider',{name:'Inspect a price observation'});
 expect(slider).toHaveAttribute('aria-valuetext',expect.stringContaining('$2'));
 fireEvent.change(slider,{target:{value:'0'}});
 expect(slider).toHaveAttribute('aria-valuetext',expect.stringContaining('$1'));
 expect(screen.getByRole('img')).toHaveAttribute('aria-label',expect.stringContaining('2 source-linked observations'));
});
it('explains crash scaling and gaps and lets the reader choose linear prices',()=>{
 render(<NextIntlClientProvider locale="en" messages={{workspace:messages}}><PriceHistoryChart points={[point(0,.0002),point(5,.0001),point(40,.0000022)]}/></NextIntlClientProvider>);
 expect(screen.getByText(/Logarithmic scale/)).toBeVisible();expect(screen.getByText(/Shaded intervals/)).toBeVisible();
 fireEvent.change(screen.getByLabelText('Price scale'),{target:{value:'linear'}});
 expect(screen.getByText(/Linear scale/)).toBeVisible();
});
it('shows honest empty and single-observation states without invented trends',()=>{
 const {rerender}=render(<NextIntlClientProvider locale="en" messages={{workspace:messages}}><PriceHistoryChart points={[]}/></NextIntlClientProvider>);
 expect(screen.getByRole('status')).toHaveTextContent('No source-linked');
 rerender(<NextIntlClientProvider locale="en" messages={{workspace:messages}}><PriceHistoryChart points={[point(0,.01)]}/></NextIntlClientProvider>);
 expect(screen.queryByRole('slider')).toBeNull();
 expect(document.querySelector('polyline')).toBeNull();
});
