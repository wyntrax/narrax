import { it, expect, vi } from 'vitest';
import type { PrismaClient } from '@narra/database';
import { recomputeWalletIntelligence } from './walletIntelligence';

it('records insufficient sample progress without inventing a wallet score', async () => {
  const upsert = vi.fn((_args: unknown) => Promise.resolve({}));
  const create = vi.fn(() => Promise.resolve({}));
  const db = {
    trackedWallet: { findMany: async () => [{ id: 'wallet', clusterId: null, cluster: null }], updateMany: create },
    walletTrade: { findMany: async () => [] },
    systemSetting: { upsert },
    walletProfile: { deleteMany: create, upsert: create },
    walletRelationship: { deleteMany: create }, walletCluster: { deleteMany: create },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  };
  const summary = await recomputeWalletIntelligence(db as unknown as PrismaClient, new Date('2026-10-18T00:00:00Z'));
  expect(summary.walletsUnscored).toBe(1);
  expect(upsert).toHaveBeenCalledWith(expect.objectContaining({create: {key:'wallet.intelligence.wallet',value:expect.objectContaining({ closedTrades: 0, requiredClosedTrades: 5, observedTrades: 0, status: 'INSUFFICIENT_HISTORY' })}}));
});
