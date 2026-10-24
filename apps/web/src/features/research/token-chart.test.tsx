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
it('shows honest empty and single-observation states without invented trends',()=>{
 const {rerender}=render(<NextIntlClientProvider locale="en" messages={{workspace:messages}}><PriceHistoryChart points={[]}/></NextIntlClientProvider>);
 expect(screen.getByRole('status')).toHaveTextContent('No source-linked');
 rerender(<NextIntlClientProvider locale="en" messages={{workspace:messages}}><PriceHistoryChart points={[point(0,.01)]}/></NextIntlClientProvider>);
 expect(screen.queryByRole('slider')).toBeNull();
 expect(document.querySelector('polyline')).toBeNull();
});
