import {render,screen,cleanup} from '@testing-library/react';
import {afterEach,it,expect} from 'vitest';
import {NextIntlClientProvider} from 'next-intl';
import type {ReactNode} from 'react';
import messages from '../../../messages/research/en.json';
import {TradeAmount,TradeValuation} from './wallet-trade-values';
afterEach(cleanup);
const view=(node:ReactNode)=>render(<NextIntlClientProvider locale="en" messages={{workspace:messages}}>{node}</NextIntlClientProvider>);
it('shows tiny nonzero SOL and USD amounts rather than zero',()=>{
 view(<><TradeAmount value={.00002}/><TradeValuation value={.003} kind="usd"/></>);
 expect(screen.getByText('0.00002')).toBeVisible();expect(screen.getByText('0.003')).toBeVisible();
});
it('distinguishes absent historical prices from FDV-only observations',()=>{
 view(<><TradeValuation value={null} kind="usd"/><TradeValuation value={null} kind="cap" fdv/></>);
 expect(screen.getByText('No SOL/USD observation at trade time')).toBeVisible();expect(screen.getByText('Only FDV available at trade time')).toBeVisible();
});
