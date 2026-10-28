import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { InvestigationDiscoveryRequest, featureAllowed } from '@narra/shared';
import { InvestigationPage } from './page';
import { investigationFixture } from './fixture';
import { investigationCopy } from './copy';
import { empty } from '@/test/fixtures';
import { ApiError } from '@/lib/api';
import en from '../../../messages/research/en.json';
import id from '../../../messages/research/id.json';

const state = vi.hoisted(() => ({ read: vi.fn(), send: vi.fn(), push: vi.fn(), access: {} as typeof empty }));
vi.mock('../research/session', () => ({ useResearch: () => ({ read: state.read, send: state.send, userId: 'owner', access: state.access }), hasFeature: (access: typeof empty, key: string) => !!access.features[key] && (access.admin === true || access.features[key].allowed) }));
vi.mock('@/components/auth/context', () => ({ useAuth: () => ({ logout: vi.fn() }) }));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push: state.push }), Link: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a> }));
beforeEach(() => { state.access = { ...empty, effectiveTier: 'PRO', features: Object.fromEntries(Object.entries(empty.features).map(([k, v]) => [k, { ...v, allowed: true }])) }; state.read.mockResolvedValue(investigationFixture()); state.send.mockResolvedValue({ status: 'QUEUED' }); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function view(mint: string | undefined = investigationFixture().token.mint, locale: 'en' | 'id' = 'en') {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><NextIntlClientProvider locale={locale} timeZone="UTC" messages={{ workspace: locale === 'id' ? id : en }}><InvestigationPage mint={mint} /></NextIntlClientProvider></QueryClientProvider>);
}
it('denies direct page reads at a configured higher tier', () => {
  state.access = { ...empty, features: { ...empty.features, 'research.smart_money_investigation': { allowed: false, requiredTier: 'MEMBER', min_entitlement_age_hours: 0 } } };
  view(); expect(screen.getByText(en.locked)).toBeVisible(); expect(state.read).not.toHaveBeenCalled();
});
it.each(['NONE', 'EARLY_ACCESS', 'MEMBER'] as const)('locks direct investigation reads and discovery for %s by default', tier => {
  state.access = { ...empty, effectiveTier: tier, features: { ...empty.features, 'research.smart_money_investigation': { requiredTier: 'PRO', allowed: featureAllowed(tier, 'research.smart_money_investigation'), min_entitlement_age_hours: 0 } } };
  view(); expect(screen.getByText(en.locked)).toBeVisible();
  expect(screen.getByText('Pro', { exact: true })).toBeVisible();
  expect(state.read).not.toHaveBeenCalled(); expect(state.send).not.toHaveBeenCalled();
});
it.each(['admin', 'early'] as const)('honors %s access independently of the default tier', async who => {
  state.access = { ...empty, admin: who === 'admin', features: { ...empty.features, 'research.smart_money_investigation': { allowed: who === 'early', requiredTier: 'EARLY_ACCESS', min_entitlement_age_hours: 0 } } };
  view(); expect(await screen.findByText(investigationCopy.en.capped)).toBeVisible();
  if (who === 'early') expect(screen.queryByRole('link', { name: investigationCopy.en.token })).toBeNull();
  else expect(screen.getByRole('link', { name: investigationCopy.en.token })).toBeVisible();
});
it.each(['en', 'id'] as const)('renders exact amounts, unknowns and bounded group comparisons (%s)', async locale => {
  const c = investigationCopy[locale]; view(undefined, locale);
  expect(await screen.findByText(c.capped)).toBeVisible();
  expect(screen.getAllByText('999999999999999999999999.00000001').length).toBeGreaterThan(0);
  expect(screen.getAllByText(c.unknown).length).toBeGreaterThan(0);
  const boxes = screen.getAllByRole('checkbox');
  boxes.slice(0, 3).forEach(box => fireEvent.click(box));
  expect(boxes[3]).toBeDisabled(); expect(screen.getByText(c.comparisonReady)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: c.clear })); expect(boxes[3]).toBeEnabled(); expect(screen.getByText(c.compareEmpty)).toBeVisible();
});
it.each(['en', 'id'] as const)('shows token discovery coverage and queues a bounded scan (%s)', async locale => {
  const c = investigationCopy[locale], mint = investigationFixture().token.mint;
  view(undefined, locale);
  expect(await screen.findByRole('heading', { name: c.discoveryTitle })).toBeVisible();
  expect(screen.getByText(c.scanNew)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: c.discover }));
  await waitFor(() => expect(state.send).toHaveBeenCalledWith(`smart-money/investigations/${mint}/discover`, InvestigationDiscoveryRequest, 'POST'));
  expect(await screen.findByText(c.discoveryQueued)).toBeVisible();
  expect(screen.getByRole('button', { name: c.discoveringShort })).toBeDisabled();
});
it('validates mint input without fetching or navigating invalid addresses', () => {
  view(''); fireEvent.change(screen.getByLabelText(investigationCopy.en.mint), { target: { value: 'bad' } }); fireEvent.click(screen.getByRole('button', { name: investigationCopy.en.open }));
  expect(screen.getByRole('alert')).toHaveTextContent(investigationCopy.en.invalid); expect(state.read).not.toHaveBeenCalled(); expect(state.push).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(investigationCopy.en.mint), { target: { value: investigationFixture().token.mint } }); fireEvent.click(screen.getByRole('button', { name: investigationCopy.en.open }));
  expect(state.push).toHaveBeenCalledWith(`/app/investigation/${investigationFixture().token.mint}`);
});
it('opens transaction provenance as inert text and returns focus on close', async () => {
  view(); const trigger = await screen.findByRole('button', { name: /^Transaction evidence / }); fireEvent.click(trigger);
  const dialog = screen.getByRole('dialog'); expect(within(dialog).getByText('<script>untrusted evidence</script>', { exact: false })).toBeVisible(); expect(dialog.querySelector('script')).toBeNull();
  expect(within(dialog).getByRole('link', { name: /Solscan/ })).toHaveAttribute('href', `https://solscan.io/tx/${'2'.repeat(88)}`);
  fireEvent.click(within(dialog).getByRole('button', { name: investigationCopy.en.close })); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(trigger).toHaveFocus());
});
it('opens group history, qualification reasons and relationship provenance', async () => {
  view(); fireEvent.click(await screen.findByRole('button', { name: 'Group evidence Group 1' })); const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText(/Unknown history/)).toBeVisible(); expect(within(dialog).getByText(investigationCopy.en.relationshipCap)).toBeVisible(); expect(within(dialog).getByText(/"type": "shared"/)).toBeVisible();
});
it('pins pagination to the returned bound and resets cursor/window on refresh or window change', async () => {
  const first = investigationFixture(); state.read.mockImplementation(async (path: string) => path.includes('cursor=') ? { ...first, nextCursor: null, trades: [{ ...first.trades[0]!, id: 'trade-2', signature: '3'.repeat(88) }] } : first);
  view(); await screen.findByText(investigationCopy.en.capped); fireEvent.click(screen.getByRole('button', { name: en.next }));
  await waitFor(() => expect(state.read.mock.calls.some(([path]) => { const u = new URL(`http://test/${path}`); return u.searchParams.get('cursor') === first.nextCursor && u.searchParams.get('asOf') === first.asOf; })).toBe(true));
  await waitFor(() => expect(screen.getByRole('button', { name: en.next })).toBeDisabled());
  fireEvent.change(screen.getByLabelText(investigationCopy.en.window), { target: { value: '7d' } }); await waitFor(() => expect(state.read.mock.calls.at(-1)?.[0]).toMatch(/window=7d&limit=50$/));
  const calls = state.read.mock.calls.length; fireEvent.click(screen.getByRole('button', { name: investigationCopy.en.refresh })); await waitFor(() => expect(state.read.mock.calls.length).toBeGreaterThan(calls));
  expect(state.read.mock.calls.at(-1)?.[0]).not.toMatch(/cursor|asOf/);
});
it('explains invalidated cursors and restarts at the first page', async () => {
  const first = investigationFixture(); state.read.mockImplementation(async (path: string) => { if (path.includes('cursor=')) throw new ApiError('INVALID_CURSOR', 400); return first; });
  view(); await screen.findByText(investigationCopy.en.capped); fireEvent.click(screen.getByRole('button', { name: en.next }));
  expect(await screen.findByRole('alert')).toHaveTextContent(investigationCopy.en.restart); fireEvent.click(within(screen.getByRole('alert')).getByRole('button'));
  expect(await screen.findByText(investigationCopy.en.capped)).toBeVisible();
});
it('shows empty observation scope and server-side access revocation without retained results', async () => {
  const data = investigationFixture(); state.read.mockResolvedValue({ ...data, coverage: { ...data.coverage, activity: 'NO_OBSERVED_TRADES' }, trades: [], participants: [], groups: [], nextCursor: null });
  view(); expect(await screen.findByText(investigationCopy.en.empty)).toBeVisible();
  state.read.mockRejectedValue(new ApiError('FEATURE_LOCKED', 403)); fireEvent.click(screen.getByRole('button', { name: investigationCopy.en.refresh })); expect(await screen.findByText(en.locked)).toBeVisible(); expect(screen.queryByText(investigationCopy.en.empty)).toBeNull();
});
it.each(['en', 'id'] as const)('explains empty token coverage and opens the available seven-day window (%s)', async locale => {
  const c = investigationCopy[locale], data = investigationFixture();
  const noTrades = { ...data, coverage: { ...data.coverage, activity: 'NO_OBSERVED_TRADES' }, availability: { activeTrackedWallets: 10, lastRecordedTradeAt: '2026-10-22T06:09:03.000Z', hasTradesIn7d: true }, trades: [], participants: [], groups: [], nextCursor: null };
  state.read.mockImplementation(async (path: string) => path.includes('window=7d') ? data : noTrades);
  view(undefined, locale);
  expect(await screen.findByText(c.emptyScope)).toBeVisible(); expect(screen.getByText(c.lookupScope)).toBeVisible();
  expect(screen.getAllByText(c.noAmount)).toHaveLength(4); expect(screen.queryByText(c.complete)).toBeNull();
  expect(screen.getByText(c.trackedScope)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: c.widen }));
  expect(await screen.findByText(c.capped)).toBeVisible(); expect(screen.getByLabelText(c.window)).toHaveValue('7d');
  expect(screen.queryByText(c.noAmount)).toBeNull();
});
