import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@narra/database';
import type { AccessTier } from '@narra/shared';
import { registerFeatureGates } from './gating';

const now = new Date('2026-10-28T12:00:00Z');
const routes = [
  ['GET', '/v1/smart-money/rankings'],
  ['GET', '/v1/smart-money/investigations/:mint'],
  ['POST', '/v1/smart-money/investigations/:mint/discover'],
] as const;

async function fixture(tier: AccessTier, admin = false) {
  const db = {
    systemSetting: { findMany: async () => [] },
    linkedWallet: { findMany: async () => [{ userId: 'owner', chain: 'solana', address: 'wallet', verifiedAt: now }] },
    accessGrant: { findMany: async () => tier === 'EARLY_ACCESS' ? [{ id: 'seat', userId: 'owner', source: 'EARLY_ACCESS', tier, status: 'ACTIVE', validUntil: null }] : [] },
    wyntraxEntitlement: { findMany: async () => ['MEMBER', 'PRO', 'ELITE'].includes(tier) ? [{ membershipId: 'paid', chain: 'solana', address: 'wallet', key: tier, status: 'ACTIVE', seq: 1n, validUntil: new Date(+now + 60_000) }] : [] },
    user: { findUnique: async () => ({ isAdmin: admin, privyUserId: 'test-smart-money-access', email: null }) },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  };
  const app = Fastify();
  app.decorateRequest('userId', 'owner');
  registerFeatureGates(app, db as unknown as PrismaClient, () => now);
  const handler = vi.fn(async () => ({ ok: true }));
  for (const [method, url] of routes) app.route({ method, url, handler });
  app.get('/v1/smart-money/wallets', async () => ({ ok: true }));
  return { app, handler };
}

describe('Smart Money PRO HTTP gates', () => {
  it.each(['NONE', 'EARLY_ACCESS', 'MEMBER'] as const)('refuses %s before ranking reads, investigation reads or discovery side effects', async tier => {
    const { app, handler } = await fixture(tier);
    try {
      for (const [method, path] of routes) {
        const response = await app.inject({ method, url: path.replace(':mint', 'mint') });
        expect(response.statusCode).toBe(403);
        expect(response.json()).toMatchObject({ error: 'FEATURE_LOCKED', requiredTier: 'PRO' });
      }
      expect(handler).not.toHaveBeenCalled();
      expect((await app.inject('/v1/smart-money/wallets')).statusCode).toBe(tier === 'NONE' ? 403 : 200);
    } finally { await app.close(); }
  });
  it.each([['PRO', false], ['ELITE', false], ['NONE', true]] as const)('permits %s (admin=%s)', async (tier, admin) => {
    const { app, handler } = await fixture(tier, admin);
    try {
      for (const [method, path] of routes) expect((await app.inject({ method, url: path.replace(':mint', 'mint') })).statusCode).toBe(200);
      expect(handler).toHaveBeenCalledTimes(3);
    } finally { await app.close(); }
  });
});
