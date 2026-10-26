import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import { InvestigationResponse } from '@narra/shared';
import { StrategyEvidence, PublicationContext } from './strategy';
import { investigationFixture, investigationStrategyFixture } from './fixture';
import { strategyCopy } from './strategy-copy';
import en from '../../../messages/research/en.json';
import id from '../../../messages/research/id.json';
afterEach(cleanup);
function view(data = investigationStrategyFixture(), locale: 'en' | 'id' = 'en') {
  render(<NextIntlClientProvider locale={locale} timeZone="UTC" messages={{ workspace: locale === 'en' ? en : id }}><StrategyEvidence data={data} /><PublicationContext data={data} /></NextIntlClientProvider>);
}
it.each(['en', 'id'] as const)('shows descriptive rules, denominators, opposing examples and unknown history (%s)', locale => {
  const c = strategyCopy[locale]; view(undefined, locale);
  expect(screen.getByText(c.note)).toBeVisible(); expect(screen.getByText(c.capped)).toBeVisible();
  expect(screen.getByText('3 / 4')).toBeVisible(); expect(screen.getByText('3 / 3 / 5')).toBeVisible();
  fireEvent.click(screen.getByText(c.details));
  expect(screen.getByText(`${c.counterexamples} (1)`)).toBeVisible();
  expect(screen.getByRole('link', { name: '777777…7777 ↗' })).toHaveAttribute('href', `https://solscan.io/tx/${'7'.repeat(88)}`);
  expect(screen.getAllByText(/999999999999999999999999.00000001/)).toHaveLength(3);
});
it('retains historical qualification and measured SELL direction while missing outcomes stay unknown', () => {
  const c = strategyCopy.en; view(); fireEvent.click(screen.getByText(c.frozen));
  expect(screen.getByText('historic-cluster')).toBeVisible(); expect(screen.getByText(/Qualified · Rule version: 1/)).toBeVisible();
  expect(screen.getByText(c.outcomesNote)).toBeVisible(); expect(screen.getByText('1h · Measured')).toBeVisible(); expect(screen.getByText('50')).toBeVisible();
  expect(screen.queryByText('-50')).toBeNull(); expect(screen.getByText('4h · Unknown')).toBeVisible(); expect(screen.getByText('24h · Pending')).toBeVisible();
  expect(screen.getByText(c.previewCapped)).toBeVisible(); expect(screen.getByText(c.publicationsCapped)).toBeVisible();
});
it('distinguishes older API responses from insufficient evidence and an empty publication window', () => {
  const c = strategyCopy.en; view(investigationFixture()); expect(screen.getByText(c.unavailable)).toBeVisible(); expect(screen.getByText(c.publicationsUnavailable)).toBeVisible(); cleanup();
  const data = investigationStrategyFixture(); data.strategies!.items = []; data.strategies!.candidateCount = 0; data.publications!.items = [];
  view(data); expect(screen.getByText(c.empty)).toBeVisible(); expect(screen.getByText(c.noPublications)).toBeVisible();
});
it('validates optional strategy payloads rather than silently accepting broken new data', () => {
  const data = investigationStrategyFixture(); data.strategies!.items[0]!.examples[0]!.amountSol = 'NaN';
  expect(InvestigationResponse.safeParse(data).success).toBe(false);
});
