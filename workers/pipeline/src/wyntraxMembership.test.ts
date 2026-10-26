import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { WyntraxMembershipEvent } from '@narra/queue';
import { deliverWyntraxMembership, signWyntraxBody } from './wyntraxMembership';

const NOW = new Date('2026-10-25T12:00:00Z');
const event: WyntraxMembershipEvent = {
  id: 'wyntrax-holding-11111111111111111111111111111111-10', type: 'membership.granted', occurredAt: NOW.toISOString(),
  data: {
    membershipId: 'onchain-holding:So11111111111111111111111111111111111111112', key: 'PRO', chain: 'solana',
    wallet: '11111111111111111111111111111111', seq: 10, validUntil: new Date(NOW.getTime() + 3_600_000).toISOString(), checkedAt: NOW.toISOString(),
  },
};

describe('outbound Wyntrax membership delivery', () => {
  it('signs the exact body and timestamp with the v1 contract', async () => {
    const fakeFetch = vi.fn(async (_url: URL, _init: RequestInit) => new Response('', { status: 200 }));
    await deliverWyntraxMembership(event, { url: 'https://membership.example/hook', secret: 's3cret', fetch: fakeFetch as unknown as typeof globalThis.fetch }, NOW);
    expect(fakeFetch).toHaveBeenCalledOnce();
    const [url, init] = fakeFetch.mock.calls[0]!;
    expect(String(url)).toBe('https://membership.example/hook');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    const body = String(init.body), timestamp = String((init.headers as Record<string, string>)['x-wyntrax-timestamp']);
    expect(JSON.parse(body)).toEqual(event);
    expect((init.headers as Record<string, string>)['x-wyntrax-event-id']).toBe(event.id);
    expect((init.headers as Record<string, string>)['x-wyntrax-signature']).toBe('v1=' + createHmac('sha256', 's3cret').update(timestamp).update('.').update(body).digest('hex'));
    expect(signWyntraxBody(body, timestamp, 's3cret')).toBe((init.headers as Record<string, string>)['x-wyntrax-signature']);
  });

  it('refuses a non-local plain-HTTP destination before sending', async () => {
    const fetch = vi.fn() as unknown as typeof globalThis.fetch;
    await expect(deliverWyntraxMembership(event, { url: 'http://membership.example/hook', secret: 's3cret', fetch }, NOW)).rejects.toThrow(/HTTPS/);
    expect(fetch).not.toHaveBeenCalled();
    await expect(deliverWyntraxMembership(event, { url: 'https://user:secret@membership.example/hook', secret: 's3cret', fetch }, NOW)).rejects.toThrow(/credentials/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('allows a localhost receiver and treats a non-2xx response as a retryable failure', async () => {
    const ok = vi.fn(async () => new Response('', { status: 200 })) as unknown as typeof globalThis.fetch;
    await expect(deliverWyntraxMembership(event, { url: 'http://localhost:5000/hook', secret: 's3cret', fetch: ok }, NOW)).resolves.toBe('delivered');
    const bad = vi.fn(async () => new Response('', { status: 503 })) as unknown as typeof globalThis.fetch;
    await expect(deliverWyntraxMembership(event, { url: 'https://membership.example/hook', secret: 's3cret', fetch: bad }, NOW)).rejects.toThrow(/HTTP 503/);
  });
});
