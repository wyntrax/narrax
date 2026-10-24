import {render,screen,cleanup,act,within} from '@testing-library/react';
import {NextIntlClientProvider} from 'next-intl';
import {afterEach,it,expect,vi} from 'vitest';
import {LatestObservedEvidence} from './latest-evidence';
import {latestEvidenceFixture} from '@/test/latest-evidence-fixture';
import messages from '../../../messages/research/en.json';
vi.mock('@/i18n/navigation',()=>({useRouter:()=>({push:vi.fn()})}));
afterEach(()=>{cleanup();vi.useRealTimers();});
it('shows latest facts with freshness, unknowns and quote size without implying a verdict',()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-23T14:00:00Z'));
 render(<NextIntlClientProvider locale="en" messages={{workspace:messages}}><LatestObservedEvidence value={latestEvidenceFixture()}/></NextIntlClientProvider>);
 expect(screen.getByRole('region',{name:'Latest observed evidence'})).toBeVisible();
 expect(screen.getByText('Stale')).toBeVisible();
 expect(screen.getByText(/Developer holding: Unknown/)).toBeVisible();
 expect(screen.getByText(/50 USDC → token/)).toBeVisible();
 expect(screen.getByText(/not safe or approved for trading/)).toBeVisible();
 expect(screen.queryByText('PASS')).toBeNull();
});

it('expires cached quote and market labels on screen without promoting other states',()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-23T14:09:59Z'));
 const value=latestEvidenceFixture();
 render(<NextIntlClientProvider locale="en" messages={{workspace:messages}}><LatestObservedEvidence value={value} compact/></NextIntlClientProvider>);
 expect(screen.getByText(/2\/5 recent observations · Buy quote: Recent/)).toBeVisible();
 act(()=>vi.advanceTimersByTime(15000));
 expect(screen.getByText(/1\/5 recent observations · Buy quote: Stale/)).toBeVisible();
 act(()=>vi.advanceTimersByTime(5*60000));
 expect(screen.getByText(/0\/5 recent observations · Buy quote: Stale/)).toBeVisible();
 expect(value.tradeability.state).toBe('FRESH'); // Display only; never rewrite the response.
});

it('shows RugCheck risk flags and distinguishes invalid facts from missing facts',()=>{
 const value=latestEvidenceFixture();
 value.rugcheck={state:'STALE',at:value.checkedAt,source:'rugcheck',data:{mint:'mint',source:'rugcheck',sourceAt:value.checkedAt,devHoldingPct:0,top10ExLpPct:5,lpBurnedPct:100,lpLocked:null,riskFlags:['RUGGED']}};
 value.tradeability={state:'INVALID',at:null,source:null,data:null};
 render(<NextIntlClientProvider locale="en" messages={{workspace:messages}}><LatestObservedEvidence value={value}/></NextIntlClientProvider>);
 expect(screen.getByText(/Risk flags: RUGGED/)).toBeVisible();
 const row=screen.getByText('Buy quote').closest('tr')!;
 expect(within(row).queryByText('Not recorded')).toBeNull();
 expect(within(row).getAllByText('Invalid evidence')).toHaveLength(2);
});
