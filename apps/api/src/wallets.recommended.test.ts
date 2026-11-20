import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@narra/database';

vi.mock('./admin', () => ({
  makeRequireAdmin: () => async (req: { userId?: string }) => {
    req.userId = 'admin-1';
  },
}));

const quals = new Map<string, { status: string; eligible: boolean; reasons: string[]; rulesVersion: number; sample?: { pnlSol?: number } }>();
vi.mock('@narra/worker-pipeline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@narra/worker-pipeline')>();
  return {
    ...actual,
    walletQualifications: vi.fn(async (_db: unknown, wallets: { id: string }[]) => new Map(wallets.map((w) => [w.id, quals.get(w.id)!]))),
  };
});

import { registerWalletAdminRoutes } from './wallets';

describe('GET /v1/admin/wallets?sort=recommended', () => {
  it('places ready-to-approve wallets first, supports offset pagination, and filters readyOnly', async () => {
    const now = new Date('2026-11-16T00:00:00Z');
    const rows = [
      { id: 'w1', address: 'Addr111111111111111111111111111111111111111', label: null, source: 'DISCOVERED', active: true, createdAt: now, researchReview: 'PROVISIONAL', researchReviewReason: null, profile: { score: 95, style: 'ROTATION', leaderScore: 50 }, cluster: null, funding: null },
      { id: 'w2', address: 'Addr222222222222222222222222222222222222222', label: 'Top Ready', source: 'DISCOVERED', active: true, createdAt: now, researchReview: 'PROVISIONAL', researchReviewReason: null, profile: { score: 74.1, style: 'FOLLOWER', leaderScore: 16.1 }, cluster: null, funding: null },
      { id: 'w3', address: 'Addr333333333333333333333333333333333333333', label: null, source: 'DISCOVERED', active: true, createdAt: now, researchReview: 'PROVISIONAL', researchReviewReason: null, profile: { score: 71.2, style: 'SCALPER', leaderScore: 36.6 }, cluster: null, funding: null },
      { id: 'w4', address: 'Addr444444444444444444444444444444444444444', label: null, source: 'DISCOVERED', active: true, createdAt: now, researchReview: 'PROVISIONAL', researchReviewReason: null, profile: null, cluster: null, funding: null },
    ];
    quals.set('w1', { status: 'PROVISIONAL', eligible: false, reasons: ['REVIEW_REQUIRED', 'HISTORY_INCOMPLETE_OR_STALE'], rulesVersion: 1, sample: { pnlSol: 20 } });
    quals.set('w2', { status: 'PROVISIONAL', eligible: false, reasons: ['REVIEW_REQUIRED'], rulesVersion: 1, sample: { pnlSol: 1.22 } });
    quals.set('w3', { status: 'PROVISIONAL', eligible: false, reasons: ['REVIEW_REQUIRED'], rulesVersion: 1, sample: { pnlSol: 4.38 } });
    quals.set('w4', { status: 'PROVISIONAL', eligible: false, reasons: ['TOO_FEW_CLOSES', 'HISTORY_INCOMPLETE_OR_STALE'], rulesVersion: 1 });

    const db = {
      trackedWallet: { findMany: vi.fn(async () => rows) },
    } as unknown as PrismaClient;

    const app = Fastify();
    registerWalletAdminRoutes(app, { db, verifier: {} as never });

    const page1 = await app.inject({ method: 'GET', url: '/v1/admin/wallets?sort=recommended&limit=2' });
    expect(page1.statusCode).toBe(200);
    const body1 = page1.json();
    expect(body1.items.map((x: { address: string }) => x.address)).toEqual([rows[1]!.address, rows[2]!.address]);
    expect(body1.items[0]).toMatchObject({ readyToApprove: true, score: 74.1, style: 'FOLLOWER' });
    expect(body1.nextCursor).toBe('off:2');

    const page2 = await app.inject({ method: 'GET', url: `/v1/admin/wallets?sort=recommended&limit=2&cursor=${body1.nextCursor}` });
    expect(page2.statusCode).toBe(200);
    expect(page2.json().items.map((x: { address: string }) => x.address)).toEqual([rows[0]!.address, rows[3]!.address]);
    expect(page2.json().nextCursor).toBeNull();

    const readyOnly = await app.inject({ method: 'GET', url: '/v1/admin/wallets?sort=recommended&readyOnly=true' });
    expect(readyOnly.statusCode).toBe(200);
    expect(readyOnly.json().items).toHaveLength(2);
    expect(readyOnly.json().items.every((x: { readyToApprove: boolean }) => x.readyToApprove)).toBe(true);

    const badCursor = await app.inject({ method: 'GET', url: '/v1/admin/wallets?sort=recommended&cursor=invalid' });
    expect(badCursor.statusCode).toBe(400);

    await app.close();
  });

  it('finds a reviewed wallet by address or label and filters review status', async () => {
    const findMany = vi.fn(async () => []);
    const db = { trackedWallet: { findMany } } as unknown as PrismaClient;
    const app = Fastify();
    registerWalletAdminRoutes(app, { db, verifier: {} as never });

    const found = await app.inject({ method: 'GET', url: '/v1/admin/wallets?q=27hfm&review=APPROVED' });
    expect(found.statusCode).toBe(200);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        researchReview: 'APPROVED',
        OR: [
          { address: { contains: '27hfm', mode: 'insensitive' } },
          { label: { contains: '27hfm', mode: 'insensitive' } },
        ],
      }),
    }));

    expect((await app.inject({ method: 'GET', url: '/v1/admin/wallets?review=NOPE' })).statusCode).toBe(400);
    await app.close();
  });
});
