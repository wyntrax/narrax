import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { afterEach, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../messages/research/en.json';
import { AlertsPage } from './alerts';
const send = vi.hoisted(() => vi.fn(async () => ({ id: 'n1', read: true })));
vi.mock('./session', () => ({ useResearch: () => ({ send, userId: 'user' }), useResearchQuery: () => ({ isPending: false, isFetching: false, isError: false, refetch: vi.fn(), data: { unreadCount: 1, nextCursor: null, items: [{ id: 'n1', readAt: null, createdAt: '2026-10-18T00:00:00Z', kind: 'AI_BUY', priority: 'CRITICAL', title: 'Review token risk', body: '<script>not executable</script>' }] } }) }));
afterEach(cleanup);
it('shows readable priority, timestamp and an actionable unread notification', async () => {
  render(<QueryClientProvider client={new QueryClient()}><NextIntlClientProvider locale="en" messages={{ workspace: messages }}><AlertsPage /></NextIntlClientProvider></QueryClientProvider>);
  expect(screen.getByRole('heading', { name: 'Review token risk' }).closest('li')).toHaveAttribute('data-priority', 'CRITICAL');
  expect(screen.getByText('<script>not executable</script>')).toBeVisible();
  expect(document.querySelector('time')).toHaveAttribute('datetime', '2026-10-18T00:00:00Z');
  expect(screen.getByRole('img', { name: messages.alUnreadOnly })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Mark read' }));
  await waitFor(() => expect(send).toHaveBeenCalledWith('alerts/n1/read', expect.anything(), 'POST'));
});
