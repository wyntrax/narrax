import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { PersonalResearchPage, PersonalBriefingPage } from './pages';
import { proCopy } from './copy';
import en from '../../../messages/research/en.json';
import id from '../../../messages/research/id.json';
const state = vi.hoisted(() => ({ allowed: true, items: [] as unknown[], send: vi.fn(async () => ({ id: 'saved' })), query: vi.fn() }));
vi.mock('../research/session', () => ({ useResearch: () => ({ userId: 'owner', send: state.send, access: { features: {} } }), hasFeature: () => state.allowed,
  useResearchQuery: (path: string) => { state.query(path); return { data: { items: state.items }, isPending: false, isError: false, refetch: vi.fn() }; } }));
vi.mock('@/i18n/navigation', () => ({ Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
afterEach(() => { cleanup(); state.allowed = true; state.items = []; state.send.mockClear(); state.query.mockClear(); });
function view(kind: 'RADAR' | 'THESIS' | 'BRIEF', locale: 'en' | 'id' = 'en') {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><NextIntlClientProvider locale={locale} messages={{ workspace: locale === 'en' ? en : id }}>{kind === 'BRIEF' ? <PersonalBriefingPage /> : <PersonalResearchPage kind={kind} />}</NextIntlClientProvider></QueryClientProvider>);
}
it.each(['RADAR', 'THESIS', 'BRIEF'] as const)('does not request private %s data when access is denied', kind => {
  state.allowed = false; view(kind);
  expect(screen.getByRole('heading', { name: en.locked })).toBeVisible();
  expect(state.query).not.toHaveBeenCalled(); expect(state.send).not.toHaveBeenCalled();
});
it.each(['en', 'id'] as const)('creates a radar with explicit conditions and rejects an empty rule set (%s)', async locale => {
  const c = proCopy[locale]; view('RADAR', locale);
  fireEvent.click(screen.getByRole('button', { name: c.newRadar }));
  fireEvent.change(screen.getByLabelText(c.name), { target: { value: 'My liquidity radar' } });
  fireEvent.click(screen.getByRole('button', { name: c.save }));
  expect(screen.getByRole('alert')).toHaveTextContent(c.errors.INVALID_INPUT!); expect(state.send).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(c.liquidity), { target: { value: '200000' } });
  fireEvent.click(screen.getByRole('button', { name: c.save }));
  await waitFor(() => expect(state.send).toHaveBeenCalledWith('personal-research/radars', expect.anything(), 'POST', {
    name: 'My liquidity radar', thesis: '', mint: null, narrativeSlug: null, active: true,
    rules: { minLiquidityUsd: 200000, minIndependentBuyers: null, windowMinutes: 30, minNarrativeVelocity: null, maxRiskScore: null },
  }));
});
it('preserves user-entered text on failed saves', async () => {
  state.send.mockRejectedValueOnce(new Error('offline')); view('THESIS');
  fireEvent.click(screen.getByRole('button', { name: proCopy.en.newThesis }));
  fireEvent.change(screen.getByLabelText(proCopy.en.name), { target: { value: 'My thesis' } });
  fireEvent.change(screen.getByLabelText(proCopy.en.rationale), { target: { value: '<script>plain text</script>' } });
  fireEvent.change(screen.getByLabelText(proCopy.en.mint), { target: { value: 'So11111111111111111111111111111111111111112' } });
  fireEvent.change(screen.getByLabelText(proCopy.en.liquidity), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: proCopy.en.save }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(proCopy.en.errors.default!));
  expect(screen.getByLabelText(proCopy.en.rationale)).toHaveValue('<script>plain text</script>');
});
it('renders unknown evidence and dated briefings without inventing zeros', () => {
  state.items = [{ day: '2026-10-25', generatedAt: '2026-10-25T12:00:00Z', since: '2026-10-24T12:00:00Z', radarMatches: 0, thesisChanges: 1, unknown: 1, capped: true,
    items: [{ monitorId: 'm', name: 'My thesis', kind: 'THESIS', mint: 'So11111111111111111111111111111111111111112', at: '2026-10-25T12:00:00Z', previousStatus: 'MATCH', evaluation: { status: 'UNKNOWN', checks: [{ key: 'liquidity', status: 'UNKNOWN', value: null, threshold: 200000, at: null, source: null, refs: [], reason: 'MISSING_OR_STALE' }] } }] }];
  view('BRIEF'); expect(screen.getByText(proCopy.en.uncertain)).toBeVisible(); expect(screen.getByText(/Partial coverage/)).toBeVisible();
  expect(screen.getByRole('link', { name: /Token research/ })).toHaveAttribute('href', '/app/tokens/So11111111111111111111111111111111111111112');
  expect(document.querySelector('.pro-evidence')).toHaveTextContent('Unknown');
  expect(document.querySelector('.pro-evidence')).not.toHaveTextContent('$0');
});
it('applies 1-click PRO strategy blueprints and submits multi-factor advanced rules', async () => {
  const c = proCopy.en; view('RADAR', 'en');
  fireEvent.click(screen.getByRole('button', { name: c.newRadar }));
  fireEvent.click(screen.getByRole('button', { name: c.radarBlueprints.smAccum.label }));
  expect(screen.getByLabelText(c.name)).toHaveValue(c.radarBlueprints.smAccum.name);
  expect(screen.getByLabelText(c.netFlowSol)).toHaveValue(3);
  expect(screen.getByLabelText(c.marketCapMax)).toHaveValue(1000000);
  fireEvent.click(screen.getByRole('button', { name: c.save }));
  await waitFor(() => expect(state.send).toHaveBeenCalledWith('personal-research/radars', expect.anything(), 'POST', expect.objectContaining({
    name: c.radarBlueprints.smAccum.name,
    rules: expect.objectContaining({
      minLiquidityUsd: 35000,
      minIndependentBuyers: 2,
      minNetFlowSol: 3,
      minMarketCapUsd: 50000,
      maxMarketCapUsd: 1000000,
      maxTop10Pct: 60,
      maxRiskScore: 45,
    }),
  })));
});
it('renders thesis regime drift strip, baseline price delta, and briefing triage filters', () => {
  const mint = 'So11111111111111111111111111111111111111112';
  state.items = [{
    id: 'th-1', kind: 'THESIS', name: 'Conviction hold', thesis: 'Hold while liquidity and buyers hold.', mint, narrativeSlug: null, active: true, updatedAt: '2026-10-25T12:00:00Z',
    rules: { minLiquidityUsd: 100000, minIndependentBuyers: null, windowMinutes: 30, minNarrativeVelocity: null, maxRiskScore: null },
    lastRun: { at: '2026-10-25T12:00:00Z', considered: 1, matched: 1, unknown: 0, capped: false },
    observations: [
      { id: 'o2', mint, at: '2026-10-25T12:00:00Z', evaluation: { status: 'MATCH', previousStatus: 'NO_MATCH', snapshot: { symbol: 'ALPHA', priceUsd: 0.0175 }, checks: [{ key: 'liquidity', status: 'PASS', value: 150000, threshold: 100000, at: '2026-10-25T12:00:00Z', source: 'dexscreener', refs: [], reason: 'CONDITION_MET' }] } },
      { id: 'o1', mint, at: '2026-10-25T11:00:00Z', evaluation: { status: 'NO_MATCH', snapshot: { symbol: 'ALPHA', priceUsd: 0.01 }, checks: [{ key: 'liquidity', status: 'FAIL', value: 80000, threshold: 100000, at: '2026-10-25T11:00:00Z', source: 'dexscreener', refs: [], reason: 'CONDITION_NOT_MET' }] } },
    ],
  }];
  view('THESIS');
  expect(screen.getByText(/\(1\/2\)/)).toBeVisible();
  expect(screen.getByText('+75%')).toBeVisible();
  fireEvent.click(screen.getByText(proCopy.en.history));
  expect(screen.getByText(/\+50% margin/)).toBeVisible();
  expect(screen.getByText(/-20% shortfall/)).toBeVisible();
});
