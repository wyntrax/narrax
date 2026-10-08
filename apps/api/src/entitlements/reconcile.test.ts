import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrisma, Prisma } from '@narra/database';
import { partnerClient } from './partner';
import { reconcile, sweepExpired } from './reconcile';
import { applyMembershipState } from './membershipStore';
import { scheduleReconcile, requestReconcile } from '../../../../workers/pipeline/src/entitlementRegistration';
const target = new URL(process.env.DATABASE_URL ?? 'invalid:');
if (target.hostname !== 'localhost' || target.port !== '5432' || target.pathname !== '/narra_ent') throw Error('Scratch only');
const db = createPrisma(target.toString()), tag = `reconcile-${randomUUID()}`, key = 'entitlements.reconcile_state';
const at = new Date('2026-10-08T00:00:00Z'), address = 'So11111111111111111111111111111111111111112';
const config = { baseUrl: 'https://partner.example', apiKey: 'fixture-partner-key', sleep: async () => {} };
let saved: Awaited<ReturnType<typeof db.systemSetting.findUnique>>, userId: string;
const item = (suffix: string, version = 1, tier = 'PRO') => ({ wyntraxUserId: `${tag}-${suffix}`, version, tier, wallets: [{ chain: 'solana', address }], validUntil: new Date(+at + 86400000).toISOString(), updatedAt: at.toISOString(), balanceSnapshotAt: at.toISOString() });
const response = (items: unknown[] = [], nextCursor: string | null = null) => new Response(JSON.stringify({ items, nextCursor }), { status: 200 });
const state = async () => (await db.systemSetting.findUnique({ where: { key } }))?.value as any;
beforeAll(async () => { saved = await db.systemSetting.findUnique({ where: { key } }); userId = (await db.user.create({ data: { privyUserId: tag } })).id; });
beforeEach(async () => { await db.systemSetting.deleteMany({ where: { key } }); });
afterAll(async () => {
  await db.auditLog.deleteMany({ where: { OR: [{ detail: { path: ['wyntraxUserId'], string_starts_with: tag } }, { detail: { path: ['userId'], equals: userId } }] } });
  await db.user.delete({ where: { id: userId } }); await db.wyntraxMembership.deleteMany({ where: { wyntraxUserId: { startsWith: tag } } });
  await db.systemSetting.deleteMany({ where: { key } }); if (saved) await db.systemSetting.create({ data: { ...saved, value: saved.value === null ? Prisma.JsonNull : saved.value as Prisma.InputJsonValue } }); await db.$disconnect();
});
describe('partner client and reconciliation (fake fetch, real scratch persistence)', () => {
  it('unset config disables without fetch or mutation; registration is bounded and idempotently named', async () => {
    const fetch = vi.fn(); expect(await reconcile(db, { fetch }, () => at)).toEqual({ status: 'disabled' }); expect(fetch).not.toHaveBeenCalled(); expect(await state()).toBeUndefined();
    const scheduler = { upsertJobScheduler: vi.fn() }; await scheduleReconcile(scheduler as never); expect(scheduler.upsertJobScheduler.mock.calls[0]!.slice(0, 2)).toEqual(['wyntrax-reconcile-v1', { every: 900000 }]);
    const queue = { add: vi.fn() }; await requestReconcile(queue as never, 120000); expect(queue.add.mock.calls[0]![2]).toMatchObject({ jobId: 'manual-2', attempts: 1 });
  });
  it('pages opaque cursors, uses Bearer/redirect rejection and advances watermark only at the end', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(response([item('a')], 'opaque+/cursor')).mockResolvedValueOnce(response([item('b')]));
    expect(await reconcile(db, { ...config, fetch }, () => at)).toMatchObject({ status: 'complete', applied: 2 });
    expect(new URL(String(fetch.mock.calls[1]![0])).searchParams.get('cursor')).toBe('opaque+/cursor');
    expect(fetch.mock.calls[0]![1]).toMatchObject({ redirect: 'error', headers: { authorization: 'Bearer fixture-partner-key' } });
    expect(await state()).toMatchObject({ watermark: at.toISOString(), fullAt: at.toISOString() }); expect((await state()).run).toBeUndefined();
    const incremental = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response());
    await reconcile(db, { ...config, fetch: incremental }, () => new Date(+at + 900000));
    expect(new URL(String(incremental.mock.calls[0]![0])).searchParams.get('updatedSince')).toBe(new Date(+at - 300000).toISOString());
  });
  it('mid-run API failure keeps completed watermark unchanged and resumes cursor replay-safely', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(response([item('c')], 'page2')).mockImplementation(async () => new Response('do not log', { status: 500 }));
    await expect(reconcile(db, { ...config, fetch }, () => at)).rejects.toThrow('WYNTRAX_RECONCILE_UNAVAILABLE'); expect(fetch).toHaveBeenCalledTimes(4);
    expect(await state()).toMatchObject({ run: { cursor: 'page2' } }); expect((await state()).watermark).toBeUndefined();
    const resume = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response([item('d')]));
    await reconcile(db, { ...config, fetch: resume }, () => at); expect(new URL(String(resume.mock.calls[0]![0])).searchParams.get('cursor')).toBe('page2');
    expect(await state()).toMatchObject({ watermark: at.toISOString() });
  });
  it('newer webhook wins over old pull; absence does not revoke; explicit NONE and expiry remove eligibility', async () => {
    const i = item('e', 5); const { updatedAt: _at, ...data } = i;
    await applyMembershipState(db, { ...data, tier: 'PRO', wallets: [{ chain: 'solana', address }], sourceUpdatedAt: at, balanceSnapshotAt: at, validUntil: new Date(i.validUntil) }, at);
    await reconcile(db, { ...config, fetch: async () => response([item('e', 4)]) }, () => at);
    expect((await db.wyntraxMembership.findUniqueOrThrow({ where: { wyntraxUserId: i.wyntraxUserId } })).version).toBe(5n);
    await reconcile(db, { ...config, fetch: async () => response() }, () => at);
    expect((await db.wyntraxMembership.findUniqueOrThrow({ where: { wyntraxUserId: i.wyntraxUserId } })).tier).toBe('PRO');
    await reconcile(db, { ...config, fetch: async () => response([item('e', 6, 'NONE')]) }, () => at);
    expect((await db.wyntraxMembership.findUniqueOrThrow({ where: { wyntraxUserId: i.wyntraxUserId } })).tier).toBe('NONE');
  });
  it('concurrent runs have one DB lease winner and no second fetch', async () => {
    let release!: () => void, entered!: () => void; const blocked = new Promise<void>(r => { release = r; }), started = new Promise<void>(r => { entered = r; });
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => { entered(); await blocked; return response(); });
    const first = reconcile(db, { ...config, fetch }, () => at); await started;
    expect(await reconcile(db, { ...config, fetch }, () => at)).toEqual({ status: 'busy' }); release(); await first; expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects looping cursors and out-of-order pages without advancing watermark', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(response([item('f')], 'same')).mockResolvedValueOnce(response([item('g')], 'same'));
    await expect(reconcile(db, { ...config, fetch }, () => at)).rejects.toThrow(); expect((await state()).watermark).toBeUndefined();
    await db.systemSetting.delete({ where: { key } });
    await expect(reconcile(db, { ...config, fetch: async () => response([item('z'), item('a')]) }, () => at)).rejects.toThrow(); expect((await state()).watermark).toBeUndefined();
  });
  it('validates whole page before writes, caps response bytes and refuses unsafe base URLs', async () => {
    for (const baseUrl of ['http://partner.example', 'https://user:secret@partner.example', 'https://partner.example/?key=secret']) expect(() => partnerClient({ ...config, baseUrl })).toThrow('WYNTRAX_PARTNER_UNAVAILABLE');
    await expect(reconcile(db, { ...config, fetch: async () => response([item('new-valid'), item('new-bad', 1, 'INVALID')]) }, () => at)).rejects.toThrow();
    expect(await db.wyntraxMembership.count({ where: { wyntraxUserId: `${tag}-new-valid` } })).toBe(0);
    const client = partnerClient({ ...config, fetch: async () => new Response('x'.repeat(1048577)) })!; await expect(client.page()).rejects.toThrow('WYNTRAX_PARTNER_UNAVAILABLE');
  });
  it('permanent 401 is not retried; network/429 have at most three attempts with bounded delays and safe errors', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('fixture-partner-key', { status: 401 }));
    await expect(partnerClient({ ...config, fetch })!.page()).rejects.toThrow('WYNTRAX_PARTNER_UNAVAILABLE'); expect(fetch).toHaveBeenCalledTimes(1);
    const retry = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => new Response('', { status: 429, headers: { 'retry-after': '999999' } })), sleep = vi.fn(async (_ms: number) => {});
    await expect(partnerClient({ ...config, fetch: retry, sleep })!.page()).rejects.toThrow('WYNTRAX_PARTNER_UNAVAILABLE'); expect(retry).toHaveBeenCalledTimes(3); expect(sleep.mock.calls.every(c => Number(c[0]) <= 5000)).toBe(true);
  });
  it('expired grant sweep is audited and preserves membership version tombstones and trading state', async () => {
    const grant = await db.accessGrant.create({ data: { userId, source: 'EARLY_ACCESS', tier: 'EARLY_ACCESS', status: 'ACTIVE', validUntil: new Date(+at - 1) } });
    const before = await db.user.findUnique({ where: { id: userId } }); await sweepExpired(db, at);
    expect((await db.accessGrant.findUniqueOrThrow({ where: { id: grant.id } })).status).toBe('EXPIRED');
    expect(await db.auditLog.count({ where: { action: 'entitlements.grant_expired', detail: { path: ['grantId'], equals: grant.id } } })).toBe(1);
    expect(await db.user.findUnique({ where: { id: userId } })).toEqual(before);
  });
  it('aborts timed-out requests and exhausts three bounded attempts without leaking provider errors', async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => options!.signal!.addEventListener('abort', () => reject(Error(config.apiKey)), { once: true })));
      const work = partnerClient({ ...config, fetch })!.page(); const assertion = expect(work).rejects.toThrow('WYNTRAX_PARTNER_UNAVAILABLE');
      await vi.advanceTimersByTimeAsync(30001); await assertion; expect(fetch).toHaveBeenCalledTimes(3);
    } finally { vi.useRealTimers(); }
  });
});
