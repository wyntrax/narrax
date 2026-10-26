import { randomBytes, randomUUID } from 'node:crypto';
import bs58 from 'bs58';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPrisma } from '@narra/database';
import { TOKEN_DISCOVERY_KEY_PREFIX } from '@narra/shared';
import { assertTestDatabase } from '../../../scripts/test-database';
import { discoverTokenWallets } from './tokenWalletDiscovery';

const target = new URL(process.env.DATABASE_URL ?? 'invalid:');
assertTestDatabase(target);
const db = createPrisma(target.toString()), tag = `token-discovery-${randomUUID()}`;
const at = new Date('2026-10-26T12:00:00.000Z');
const address = () => bs58.encode(randomBytes(32));
const walletA = address(), walletB = address(), mint = address();
const buy = (signature: string, wallet: string) => ({
  signature, timestamp: Math.floor(+at / 1000), feePayer: wallet,
  events: { swap: { nativeInput: { amount: '1000000000' }, nativeOutput: null, tokenOutputs: [{ mint, rawTokenAmount: { tokenAmount: '10', decimals: 0 } }] } },
});
const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
let tokenId: string, statusKey: string, walletIds: string[] = [];
const historyKey = (id: string) => `wallet.history.${id}`;

beforeAll(async () => {
  const token = await db.token.create({ data: { mint, symbol: 'DISC', name: tag } });
  tokenId = token.id; statusKey = `${TOKEN_DISCOVERY_KEY_PREFIX}${tokenId}`;
}, 30_000);
afterAll(async () => {
  await db.systemSetting.deleteMany({ where: { key: { in: [statusKey, ...walletIds.map(historyKey)] } } });
  await db.trackedWallet.deleteMany({ where: { address: { in: [walletA, walletB] } } });
  await db.token.deleteMany({ where: { id: tokenId } });
  await db.$disconnect();
}, 30_000);

describe('token wallet discovery on isolated PostgreSQL', () => {
  it('tracks a repeated participant as provisional, stores supported history and records bounded progress', async () => {
    const fetcher = vi.fn(async () => json([buy(randomUUID() + 'a', walletA), buy(randomUUID() + 'b', walletA), buy(randomUUID() + 'c', walletB)]));
    const collected = vi.fn(async (wallet: string, opts: { apiKey: string; maxPages?: number; now?: Date }) => {
      expect(wallet).toBe(walletA); expect(opts).toMatchObject({ apiKey: 'test-key', maxPages: 2, now: at });
      return { events: [{ signature: randomUUID() + 'd', wallet: walletA, mint, side: 'BUY' as const, amountSol: 1, tokenAmount: 10, at: at.toISOString() }], scanned: 1, skipped: 0, capped: false, coveredFrom: new Date(+at - 30 * 86_400_000).toISOString(), coveredTo: at.toISOString() };
    });
    const summary = await discoverTokenWallets(db, { tokenId, mint, symbol: 'DISC', apiKey: 'test-key', now: at, fetch: fetcher as typeof fetch, collect: collected as typeof import('./walletHistory').collectWalletHistory });
    expect(summary).toMatchObject({ status: 'COMPLETE', pagesRead: 1, transactionsRead: 3, swapsRead: 3, participantsSeen: 2, candidates: 1, newWallets: 1, backfilledWallets: 1, createdTrades: 1, capped: false });
    expect(fetcher).toHaveBeenCalledTimes(1); expect(collected).toHaveBeenCalledTimes(1);

    const wallet = await db.trackedWallet.findUniqueOrThrow({ where: { address: walletA } });
    walletIds = [wallet.id];
    expect(wallet).toMatchObject({ source: 'DISCOVERED', active: true, researchReview: 'PROVISIONAL' });
    expect(await db.trackedWallet.count({ where: { address: { in: [walletA, walletB] } } })).toBe(1);
    expect(await db.walletTrade.findFirst({ where: { walletId: wallet.id, tokenId } })).toMatchObject({ side: 'BUY', amountSol: expect.anything() });
    expect((await db.systemSetting.findUniqueOrThrow({ where: { key: statusKey } })).value).toMatchObject({ status: 'COMPLETE', newWallets: 1, createdTrades: 1 });
    expect((await db.systemSetting.findUniqueOrThrow({ where: { key: historyKey(wallet.id) } })).value).toMatchObject({ scanned: 1, accepted: 1, capped: false, windowDays: 30 });
  });

  it('reports NOT_CONFIGURED instead of pretending a keyless scan ran', async () => {
    const fetcher = vi.fn();
    const summary = await discoverTokenWallets(db, { tokenId, mint, symbol: 'DISC', now: at, fetch: fetcher as typeof fetch });
    expect(summary).toMatchObject({ status: 'FAILED', error: 'NOT_CONFIGURED', newWallets: 0, backfilledWallets: 0 });
    expect(fetcher).not.toHaveBeenCalled();
    expect((await db.systemSetting.findUniqueOrThrow({ where: { key: statusKey } })).value).toMatchObject({ status: 'FAILED', error: 'NOT_CONFIGURED' });
  });
  it('does not duplicate an already discovered wallet or re-fetch its history', async () => {
    const fetcher = vi.fn(async () => json([buy(randomUUID() + 'e', walletA), buy(randomUUID() + 'f', walletA)]));
    const collected = vi.fn();
    const summary = await discoverTokenWallets(db, { tokenId, mint, symbol: 'DISC', apiKey: 'test-key', now: at, fetch: fetcher as typeof fetch, collect: collected as unknown as typeof import('./walletHistory').collectWalletHistory });
    expect(summary).toMatchObject({ status: 'COMPLETE', candidates: 0, newWallets: 0, backfilledWallets: 0, createdTrades: 0 });
    expect(collected).not.toHaveBeenCalled();
    expect(await db.trackedWallet.count({ where: { source: 'DISCOVERED', address: { in: [walletA, walletB] } } })).toBe(1);
  });
});
