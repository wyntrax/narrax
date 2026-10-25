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
