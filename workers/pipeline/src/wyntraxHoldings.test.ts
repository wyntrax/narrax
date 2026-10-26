import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@narra/database';
import type { WyntraxMembershipEvent } from '@narra/queue';
import { HOLDING_MEMBERSHIP_PREFIX, HOLDING_TTL_MS, amountToBaseUnits, holdingTier, syncWyntraxHoldings } from './wyntraxHoldings';

const NOW = new Date('2026-10-25T12:00:00Z');
const MINT = 'So11111111111111111111111111111111111111112';
const WALLET = '11111111111111111111111111111111';
const OTHER = '9xQeWvG816bUx9EPf7uZ8y7m6J1n7G5b7V7v7v7v7v7v';
type Key = 'MEMBER' | 'PRO' | 'ELITE' | 'NONE';
type Row = {
  membershipId: string; chain: 'solana'; address: string; key: Key; seq: bigint;
  validUntil: Date | null; status: 'ACTIVE' | 'REVOKED'; lastEventId: string;
  receivedAt: Date; proSince: Date | null; eliteSince: Date | null;
};
const rowKey = (id: string, address: string) => `${id}|${address}`;

function fixture(input: {
  wallets?: { userId: string; address: string }[];
  mint?: string | null;
  tiers?: { MEMBER: number; PRO: number };
  rows?: Row[];
  balances?: Record<string, bigint>;
  fail?: Set<string>;
} = {}) {
  const wallets = input.wallets ?? [{ userId: 'did:privy:alice', address: WALLET }];
  const settings = [
    { key: 'access.token_mint', value: input.mint === undefined ? MINT : input.mint },
    { key: 'access.tier_requirements', value: input.tiers ?? { MEMBER: 500_000, PRO: 1_000_000 } },
  ];
  const rows = new Map((input.rows ?? []).map(row => [rowKey(row.membershipId, row.address), { ...row }]));
  const db = {
    linkedWallet: { findMany: async ({ where }: { where: { userId?: string } }) => wallets.filter(wallet => !where.userId || wallet.userId === where.userId) },
    systemSetting: { findMany: async ({ where }: { where: { key: { in: string[] } } }) => settings.filter(row => where.key.in.includes(row.key)) },
    wyntraxEntitlement: {
      findMany: async ({ where }: { where: { chain: string; membershipId: { startsWith: string }; address: { in: string[] }; status: string } }) =>
        [...rows.values()].filter(row => row.chain === where.chain && row.membershipId.startsWith(where.membershipId.startsWith) && where.address.in.includes(row.address) && row.status === where.status),
      findUnique: async ({ where }: { where: { membershipId_chain_address: { membershipId: string; address: string } } }) =>
        rows.get(rowKey(where.membershipId_chain_address.membershipId, where.membershipId_chain_address.address)) ?? null,
      upsert: async ({ where, create, update }: { where: { membershipId_chain_address: { membershipId: string; address: string } }; create: Row; update: Partial<Row> }) => {
        const key = rowKey(where.membershipId_chain_address.membershipId, where.membershipId_chain_address.address), existing = rows.get(key);
        const next = (existing ? { ...existing, ...update } : { ...create }) as Row;
        rows.set(key, next);
        return next;
      },
      update: async ({ where, data }: { where: { membershipId_chain_address: { membershipId: string; address: string } }; data: Partial<Row> }) => {
        const key = rowKey(where.membershipId_chain_address.membershipId, where.membershipId_chain_address.address), existing = rows.get(key);
        if (!existing) throw new Error('missing row');
        const next = { ...existing, ...data };
        rows.set(key, next);
        return next;
      },
    },
  };
  const rpc = {
    getMintInfo: vi.fn(async () => ({ program: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', decimals: 6, freezeAuthority: null, mintAuthority: null, hasExtensions: false })),
    getTokenBaseUnits: vi.fn(async (address: string) => {
      if (input.fail?.has(address)) throw new Error('rpc down');
      return input.balances?.[address] ?? 0n;
    }),
  };
  return { db, rpc, rows, wallets };
}

function activeRow(over: Partial<Row> = {}): Row {
  return {
    membershipId: `${HOLDING_MEMBERSHIP_PREFIX}${MINT}`, chain: 'solana', address: WALLET, key: 'PRO', seq: 10n,
    validUntil: new Date(NOW.getTime() + HOLDING_TTL_MS), status: 'ACTIVE', lastEventId: 'holding:old',
    receivedAt: NOW, proSince: NOW, eliteSince: null, ...over,
  };
}

async function sync(input: Parameters<typeof fixture>[0] = {}, options: { userId?: string } = {}) {
  const f = fixture(input), events: WyntraxMembershipEvent[] = [];
  const enqueue = vi.fn(async (event: WyntraxMembershipEvent) => { events.push(event); });
  const summary = await syncWyntraxHoldings({ db: f.db as unknown as PrismaClient, rpc: f.rpc, now: () => NOW, enqueue }, options);
  return { ...f, events, enqueue, summary };
}

describe('$WYNTRAX holding amounts', () => {
  it('converts human amounts to base units without floating point', () => {
    expect(amountToBaseUnits(500_000, 6)).toBe(500_000_000_000n);
    expect(amountToBaseUnits(0.000001, 6)).toBe(1n);
    expect(() => amountToBaseUnits(0, 6)).toThrow();
    expect(() => amountToBaseUnits(1, 19)).toThrow();
  });

  it('uses PRO above MEMBER and never rounds up a balance', () => {
    const tiers = { MEMBER: 500_000, PRO: 1_000_000 };
    expect(holdingTier(499_999_999_999n, 6, tiers)).toBe('NONE');
    expect(holdingTier(500_000_000_000n, 6, tiers)).toBe('MEMBER');
    expect(holdingTier(1_000_000_000_000n, 6, tiers)).toBe('PRO');
  });
});

describe('$WYNTRAX holding synchronization', () => {
  it('grants once, renews quietly, then revokes when the balance drops', async () => {
    const balance = { [WALLET]: 1_000_000_000_000n };
    const first = await sync({ balances: balance });
    expect(first.summary).toMatchObject({ checked: 1, active: 1, granted: 1, revoked: 0, rpcFailures: 0, eventFailures: 0 });
    expect(first.events).toHaveLength(1);
    expect(first.events[0]).toMatchObject({ type: 'membership.granted', data: { wallet: WALLET, key: 'PRO', membershipId: `${HOLDING_MEMBERSHIP_PREFIX}${MINT}` } });
    expect(first.rows.get(rowKey(`${HOLDING_MEMBERSHIP_PREFIX}${MINT}`, WALLET))).toMatchObject({ key: 'PRO', status: 'ACTIVE', validUntil: new Date(NOW.getTime() + HOLDING_TTL_MS) });

    const second = await sync({ balances: balance, rows: [...first.rows.values()] });
    expect(second.summary).toMatchObject({ checked: 1, active: 1, granted: 0, revoked: 0 });
    expect(second.events).toEqual([]);

    balance[WALLET] = 0n;
    const third = await sync({ balances: balance, rows: [...second.rows.values()] });
    expect(third.summary).toMatchObject({ checked: 1, granted: 0, revoked: 1 });
    expect(third.events[0]).toMatchObject({ type: 'membership.revoked', data: { wallet: WALLET, key: 'PRO', validUntil: null } });
    expect(third.rows.get(rowKey(`${HOLDING_MEMBERSHIP_PREFIX}${MINT}`, WALLET))).toMatchObject({ status: 'REVOKED', validUntil: null, proSince: null });

    const fourth = await sync({ balances: balance, rows: [...third.rows.values()] });
    expect(fourth.events).toEqual([]);
    expect(fourth.summary.revoked).toBe(0);
  });

  it('revokes a local holding when the configured mint changes', async () => {
    const oldMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    const stale = activeRow({ membershipId: `${HOLDING_MEMBERSHIP_PREFIX}${oldMint}` });
    const result = await sync({ mint: MINT, rows: [stale], balances: { [WALLET]: 0n } });
    expect(result.events.map(event => event.type)).toEqual(['membership.revoked']);
    expect(result.events[0]?.data.membershipId).toBe(`${HOLDING_MEMBERSHIP_PREFIX}${oldMint}`);
    expect(result.rows.get(rowKey(`${HOLDING_MEMBERSHIP_PREFIX}${oldMint}`, WALLET))).toMatchObject({ status: 'REVOKED' });
  });

  it('revokes local access when the mint setting is cleared, and does no RPC work', async () => {
    const result = await sync({ mint: null, rows: [activeRow()] });
    expect(result.summary).toMatchObject({ skipped: 'no_mint', revoked: 1 });
    expect(result.rpc.getMintInfo).not.toHaveBeenCalled();
    expect(result.events[0]?.type).toBe('membership.revoked');
  });

  it('leaves a fresh holding in place when the balance read fails', async () => {
    const result = await sync({ rows: [activeRow()], fail: new Set([WALLET]) });
    expect(result.summary).toMatchObject({ checked: 1, rpcFailures: 1, granted: 0, revoked: 0 });
    expect(result.events).toEqual([]);
    expect(result.rows.get(rowKey(`${HOLDING_MEMBERSHIP_PREFIX}${MINT}`, WALLET))).toMatchObject({ status: 'ACTIVE' });
  });

  it('counts delivery failures without losing the local grant', async () => {
    const f = fixture({ balances: { [WALLET]: 500_000_000_000n } });
    const summary = await syncWyntraxHoldings({
      db: f.db as unknown as PrismaClient, rpc: f.rpc, now: () => NOW, enqueue: vi.fn(async () => { throw new Error('queue down'); }),
    });
    expect(summary).toMatchObject({ active: 1, granted: 0, eventFailures: 1 });
    expect(f.rows.get(rowKey(`${HOLDING_MEMBERSHIP_PREFIX}${MINT}`, WALLET))).toMatchObject({ key: 'MEMBER', status: 'ACTIVE' });
  });

  it('can check only one user and skips an invalid setting without writing', async () => {
    const other = { userId: 'did:privy:bob', address: OTHER };
    const f = fixture({ wallets: [{ userId: 'did:privy:alice', address: WALLET }, other], balances: { [OTHER]: 1_000_000_000_000n } });
    const enqueue = vi.fn(async () => ({}));
    const one = await syncWyntraxHoldings({ db: f.db as unknown as PrismaClient, rpc: f.rpc, now: () => NOW, enqueue }, { userId: 'did:privy:alice' });
    expect(one).toMatchObject({ checked: 1, active: 0 });
    expect(f.rows.size).toBe(0);
    expect(f.rpc.getTokenBaseUnits).toHaveBeenCalledWith(WALLET, MINT);

    const invalid = fixture({ mint: 'not-a-mint' });
    const skipped = await syncWyntraxHoldings({ db: invalid.db as unknown as PrismaClient, rpc: invalid.rpc, now: () => NOW, enqueue });
    expect(skipped).toMatchObject({ skipped: 'invalid_settings' });
    expect(invalid.rpc.getMintInfo).not.toHaveBeenCalled();
    expect(invalid.rows.size).toBe(0);
  });
});
