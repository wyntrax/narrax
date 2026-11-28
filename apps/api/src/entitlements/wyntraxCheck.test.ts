import { describe, it, expect, beforeEach } from 'vitest';
import { resolveEntitlements } from '@narra/shared';
import {
  checkWyntraxMembership,
  syncWalletFromCheckApi,
  _resetWyntraxCheckCache,
  type WyntraxCheckConfig,
  type WyntraxCheckResponse,
} from './wyntraxCheck';

const now = new Date('2026-11-28T12:00:00.000Z');
const wallet = '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr';

function makeResponse(overrides: Partial<WyntraxCheckResponse> = {}): WyntraxCheckResponse {
  return {
    ok: true,
    creatorId: 'ck_creator_1',
    wallet,
    chain: 'solana',
    active: true,
    tier: 'PRO',
    validUntil: '2026-12-28T12:00:00.000Z',
    checkedAt: now.toISOString(),
    ttlSeconds: 30,
    memberships: [
      {
        membershipId: 'mem_pro',
        name: 'Pro',
        accessTier: 'PRO',
        source: 'PAYMENT',
        startedAt: '2026-11-01T00:00:00.000Z',
        validUntil: '2026-12-28T12:00:00.000Z',
        gateCheckedAt: null,
      },
    ],
    ...overrides,
  };
}

describe('wyntraxCheck', () => {
  beforeEach(() => {
    _resetWyntraxCheckCache();
  });

  it('calls POST /api/v1/memberships/check with Bearer key and caches for 30s', async () => {
    let calls = 0;
    const config: WyntraxCheckConfig = {
      apiUrl: 'https://wyntrax.xyz',
      apiKey: 'wx_live_test_key',
      creatorId: 'ck_creator_1',
      fetchFn: (async (url, init) => {
        calls++;
        expect(url).toBe('https://wyntrax.xyz/api/v1/memberships/check');
        expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer wx_live_test_key');
        expect(JSON.parse(String(init?.body))).toEqual({
          wallet,
          chain: 'solana',
          creatorId: 'ck_creator_1',
        });
        return new Response(JSON.stringify(makeResponse()), { status: 200 });
      }) as typeof fetch,
    };

    const first = await checkWyntraxMembership(config, { wallet, chain: 'solana', now });
    expect(first.fromCache).toBe(false);
    expect(first.response.active).toBe(true);
    expect(calls).toBe(1);

    // Within 30s -> served from cache
    const second = await checkWyntraxMembership(config, {
      wallet,
      chain: 'solana',
      now: new Date(now.getTime() + 15_000),
    });
    expect(second.fromCache).toBe(true);
    expect(calls).toBe(1);

    // fresh: true bypasses cache
    const third = await checkWyntraxMembership(config, {
      wallet,
      chain: 'solana',
      fresh: true,
      now: new Date(now.getTime() + 15_000),
    });
    expect(third.fromCache).toBe(false);
    expect(calls).toBe(2);
  });

  it('uses cached state up to 60s on API error, then fails closed', async () => {
    let shouldFail = false;
    const config: WyntraxCheckConfig = {
      apiUrl: 'https://wyntrax.xyz',
      apiKey: 'wx_live_test_key',
      fetchFn: (async () => {
        if (shouldFail) return new Response('error', { status: 503 });
        return new Response(JSON.stringify(makeResponse()), { status: 200 });
      }) as typeof fetch,
    };

    await checkWyntraxMembership(config, { wallet, chain: 'solana', now });
    shouldFail = true;

    // 45s old (past 30s TTL, within 60s error grace) -> serves stale fallback
    const fallback = await checkWyntraxMembership(config, {
      wallet,
      chain: 'solana',
      now: new Date(now.getTime() + 45_000),
    });
    expect(fallback.fromCache).toBe(true);
    expect(fallback.staleFallback).toBe(true);

    // 61s old -> fails closed
    await expect(
      checkWyntraxMembership(config, {
        wallet,
        chain: 'solana',
        now: new Date(now.getTime() + 61_000),
      })
    ).rejects.toThrow('WYNTRAX_UNAVAILABLE');
  });

  it('reconciles active lifetime memberships and revokes removed ones', async () => {
    const store = new Map<string, any>([
      [
        'mem_old',
        {
          membershipId: 'mem_old',
          chain: 'solana',
          address: wallet,
          key: 'PRO',
          seq: 5n,
          validUntil: new Date('2026-12-10T00:00:00.000Z'),
          status: 'ACTIVE',
          lastEventId: 'evt_1',
          receivedAt: new Date('2026-11-10T00:00:00.000Z'),
          proSince: new Date('2026-11-10T00:00:00.000Z'),
          eliteSince: null,
        },
      ],
    ]);

    const fakeDb: any = {
      $transaction: async (fn: any) =>
        fn({
          $executeRaw: async () => 1,
          wyntraxEntitlement: {
            findMany: async () => Array.from(store.values()),
            upsert: async ({ where, create, update }: any) => {
              const id = where.membershipId_chain_address.membershipId;
              store.set(id, store.has(id) ? { ...store.get(id), ...update } : create);
            },
            update: async ({ where, data }: any) => {
              const id = where.membershipId_chain_address.membershipId;
              store.set(id, { ...store.get(id), ...data });
            },
          },
        }),
    };

    const lifetimeSnapshot = makeResponse({
      validUntil: null,
      memberships: [
        {
          membershipId: 'mem_lifetime',
          name: 'Lifetime Pro',
          accessTier: 'PRO',
          source: 'PAYMENT',
          startedAt: '2026-11-01T00:00:00.000Z',
          validUntil: null,
          gateCheckedAt: null,
        },
      ],
    });

    await syncWalletFromCheckApi(fakeDb, 'solana', wallet, lifetimeSnapshot, now);

    expect(store.get('mem_old').status).toBe('REVOKED');
    expect(store.get('mem_old').seq).toBe(6n);
    expect(store.get('mem_lifetime').status).toBe('ACTIVE');
    expect(store.get('mem_lifetime').validUntil).toBeNull();
    // Preserved proSince continuity from mem_old
    expect(store.get('mem_lifetime').proSince).toEqual(new Date('2026-11-10T00:00:00.000Z'));

    // Verify @narra/shared resolveEntitlements grants PRO for lifetime (validUntil: null)
    const resolved = resolveEntitlements(
      {
        userId: 'u_1',
        linkedWallets: [{ userId: 'u_1', chain: 'solana', address: wallet, verifiedAt: new Date('2026-11-01T00:00:00.000Z') }],
        grants: [],
        memberships: Array.from(store.values()),
        earlyAccessEnabled: false,
      },
      now
    );
    expect(resolved.effectiveTier).toBe('PRO');
    expect(resolved.nextExpiry).toBeNull();
  });
});
