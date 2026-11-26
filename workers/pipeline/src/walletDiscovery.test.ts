import { expect, it, vi } from 'vitest';
import type { PrismaClient } from '@narra/database';
import { discoverCandidates } from './walletDiscovery';

const now = new Date('2026-11-26T12:00:00Z');
const t0 = new Date(+now - 10 * 3_600_000);
const tPeak = new Date(+now - 6 * 3_600_000);
const tLast = new Date(+now - 1 * 3_600_000);

it('judges a token as a winner when its post-launch peak liquid price reached >= 2.5x even if latest price faded', async () => {
  const upserts: unknown[] = [];
  const rows = [
    { token: { id: 'tok1', mint: 'Mint111111111111111111111111111111111111pump', risk: [] }, buyers: [{ wallet: 'W1', rank: 1 }] },
    { token: { id: 'tok2', mint: 'Mint222222222222222222222222222222222222pump', risk: [] }, buyers: [{ wallet: 'W1', rank: 2 }] },
    { token: { id: 'tokHP', mint: 'Mint333333333333333333333333333333333333pump', risk: [{ flags: ['HONEYPOT'] }] }, buyers: [{ wallet: 'W2', rank: 1 }] },
  ];
  const db = {
    tokenEarlyBuyers: { findMany: async () => rows },
    tokenMetric: {
      findFirst: vi.fn(async (args: { where: { tokenId: string; liquidityUsd?: unknown }; orderBy: { at?: string; priceUsd?: string } }) => {
        if (args.orderBy.at === 'asc') return { id: 'm0', at: t0, priceUsd: '1' };
        if (args.orderBy.at === 'desc') return { priceUsd: '1.2', liquidityUsd: '25000', at: tLast };
        // Peak query (ordered by priceUsd desc with liquidity >= minLiquidityUsd)
        return { priceUsd: '3.0', liquidityUsd: '25000', at: tPeak };
      }),
    },
    trackedWallet: { findMany: async () => [] },
    walletCandidate: {
      findMany: async () => [],
      upsert: vi.fn(async (arg: unknown) => { upserts.push(arg); return {}; }),
    },
    systemSetting: { upsert: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  } as unknown as PrismaClient;

  const summary = await discoverCandidates(db, now);
  expect(summary.tokensJudged).toBe(3);
  expect(summary.winners).toBe(2); // tok1 & tok2 won via peak liquid price; tokHP blocked by HONEYPOT
  expect(summary.candidates).toBe(1); // W1 was early in 2 winners
  expect(upserts).toHaveLength(1);
});
