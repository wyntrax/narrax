import { it, expect, vi } from 'vitest';
import type { PrismaClient } from '@narra/database';
import { recomputeWalletIntelligence } from './walletIntelligence';

it('records insufficient sample progress without inventing a wallet score', async () => {
  const settings:{key:string;value:unknown}[]=[];
  const createSettings=vi.fn((args:{data:{key:string;value:unknown}[]})=>{settings.push(...args.data);return Promise.resolve({count:args.data.length});});
  const create = vi.fn(() => Promise.resolve({}));
  const db = {
    trackedWallet: { findMany: async () => [{ id: 'wallet', clusterId: null, cluster: null }], updateMany: create },
    walletTrade: { findMany: async () => [] },
    systemSetting:{createMany:createSettings,deleteMany:create},
    walletProfile: { deleteMany: create, upsert: create },
    walletRelationship: { deleteMany: create }, walletCluster: { deleteMany: create },
    $transaction: async (ops: Promise<unknown>[]|((tx:unknown)=>unknown)):Promise<unknown> => typeof ops==='function'?ops(db):Promise.all(ops),
  };
  const summary = await recomputeWalletIntelligence(db as unknown as PrismaClient, new Date('2026-10-18T00:00:00Z'));
  expect(summary.walletsUnscored).toBe(1);
  expect(settings).toContainEqual({key:'wallet.intelligence.wallet',value:expect.objectContaining({ closedTrades: 0, requiredClosedTrades: 5, observedTrades: 0, status: 'INSUFFICIENT_HISTORY' })});
});
