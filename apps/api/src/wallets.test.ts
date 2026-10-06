import pg from 'pg';
import { SignJWT, exportSPKI, generateKeyPair } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrisma } from '@narra/database';
import { makeWalletEventStore } from '@narra/worker-pipeline';
import { buildApp } from './app';
import { createPrivyVerifier } from './auth';

const url = process.env.DATABASE_URL ?? 'postgresql://narra:narra@localhost:5432/narra';
async function dbUp() {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 800 });
  try { await c.connect(); await c.query('select 1 from "WalletCandidate" limit 1'); return true; } catch { return false; } finally { await c.end().catch(() => {}); }
}
const up = await dbUp();

describe.skipIf(!up)('tracked wallet admin routes (needs Postgres)', () => {
  const db = createPrisma(url);
  // Addresses must be valid base58, which has no 0, O, I or l.
  const tag = `wa${Date.now()}`.replace(/0/g, 'z');
  const APP_ID = 'wallets-test';
  const admin = `did:privy:admin-${tag}`, user = `did:privy:user-${tag}`;
  const addr = (s: string) => `${s}${tag}`.padEnd(40, '1');
  let keys: Awaited<ReturnType<typeof generateKeyPair>>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let bareApp: Awaited<ReturnType<typeof buildApp>>;
  let adminId = '';
  let syncCalls = 0;
  let syncImpl: () => Promise<unknown> = async () => { syncCalls++; };

  const bearer = async (sub: string) => `Bearer ${await new SignJWT({}).setProtectedHeader({ alg: 'ES256' }).setSubject(sub).setIssuer('privy.io').setAudience(APP_ID).setIssuedAt().setExpirationTime('5m').sign(keys.privateKey)}`;
  const call = async (method: 'GET' | 'POST' | 'PATCH', path: string, sub: string | null, payload?: unknown, target = app) => {
    const res = await target.inject({ method, url: path, payload: payload as object, headers: sub ? { authorization: await bearer(sub) } : {} });
    return { status: res.statusCode, body: res.json() as Record<string, any> };
  };

  beforeAll(async () => {
    keys = await generateKeyPair('ES256');
    const verifier = createPrivyVerifier({ appId: APP_ID, verificationKey: await exportSPKI(keys.publicKey) });
    app = await buildApp({ account: { db, verifier }, requestWalletSync: () => syncImpl() });
    bareApp = await buildApp({ account: { db, verifier } });
    adminId = (await db.user.create({ data: { privyUserId: admin, isAdmin: true } })).id;
    await db.user.create({ data: { privyUserId: user } });
  });
  afterAll(async () => {
    // Shared tables: remove what this file created.
    await db.walletCandidate.deleteMany({ where: { address: { contains: tag } } });
    await db.trackedWallet.deleteMany({ where: { address: { contains: tag } } });
    await app.close(); await bareApp.close(); await db.$disconnect();
  });

  it('requires a signed-in admin for every route', async () => {
    const routes: ['GET' | 'POST' | 'PATCH', string][] = [
      ['GET', '/v1/admin/wallets'], ['POST', '/v1/admin/wallets'], ['POST', '/v1/admin/wallets/import'], ['PATCH', `/v1/admin/wallets/${addr('X')}`],
      ['GET', '/v1/admin/wallets/sync-status'], ['POST', '/v1/admin/wallets/sync'], ['GET', '/v1/admin/wallet-candidates'],
      ['POST', `/v1/admin/wallet-candidates/${addr('X')}/approve`], ['POST', `/v1/admin/wallet-candidates/${addr('X')}/reject`],
    ];
    for (const [m, p] of routes) {
      expect((await call(m, p, null, {})).status, `${m} ${p} anonymous`).toBe(401);
      expect((await call(m, p, user, {})).status, `${m} ${p} non-admin`).toBe(403);
    }
  });

  it('adds a wallet, cleans its label, audits it and asks for a sync', async () => {
    const before = syncCalls;
    const r = await call('POST', '/v1/admin/wallets', admin, { address: addr('A'), label: 'Whale\u200B\u202E ' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ wallet: { address: addr('A'), label: 'Whale', source: 'MANUAL', active: true }, syncRequested: true });
    expect(syncCalls).toBe(before + 1);
    expect(await db.auditLog.count({ where: { userId: adminId, action: 'wallet.added' } })).toBeGreaterThan(0);
  });

  it('refuses duplicates, malformed addresses and unknown fields', async () => {
    expect((await call('POST', '/v1/admin/wallets', admin, { address: addr('A') })).status).toBe(409);
    for (const address of ['short', `0OIl${'1'.repeat(36)}`, 'a'.repeat(50), '']) expect((await call('POST', '/v1/admin/wallets', admin, { address })).status, address).toBe(400);
    expect((await call('POST', '/v1/admin/wallets', admin, { address: addr('Z'), source: 'DISCOVERED' })).status).toBe(400);
    expect(await db.trackedWallet.findUnique({ where: { address: addr('Z') } })).toBeNull();
  });

  it('still saves a wallet when the sync request fails', async () => {
    const saved = syncImpl;
    syncImpl = async () => { throw new Error('redis down'); };
    const r = await call('POST', '/v1/admin/wallets', admin, { address: addr('B') });
    syncImpl = saved;
    expect(r.status).toBe(201);
    expect(r.body.syncRequested).toBe(false);
  });

  it('deactivates and reactivates a wallet; a deactivated wallet is no longer tracked', async () => {
    const store = makeWalletEventStore(db);
    expect(await store.isTracked(addr('A'))).toBe(true);
    const off = await call('PATCH', `/v1/admin/wallets/${addr('A')}`, admin, { active: false });
    expect(off.body).toMatchObject({ wallet: { active: false }, syncRequested: true });
    expect(await store.isTracked(addr('A'))).toBe(false);
    expect(await db.trackedWallet.count({ where: { address: addr('A') } })).toBe(1); // kept, not deleted
    const back = await call('POST', '/v1/admin/wallets', admin, { address: addr('A') });
    expect(back.status).toBe(200);
    expect(back.body.wallet.active).toBe(true);
    expect(await store.isTracked(addr('A'))).toBe(true);
  });

  it('edits a label without requesting a sync, and rejects empty or unknown changes', async () => {
    const r = await call('PATCH', `/v1/admin/wallets/${addr('A')}`, admin, { label: 'Renamed' });
    expect(r.body).toMatchObject({ wallet: { label: 'Renamed' }, syncRequested: false });
    expect((await call('PATCH', `/v1/admin/wallets/${addr('A')}`, admin, { label: null })).body.wallet.label).toBeNull();
    expect((await call('PATCH', `/v1/admin/wallets/${addr('A')}`, admin, {})).status).toBe(400);
    expect((await call('PATCH', `/v1/admin/wallets/${addr('A')}`, admin, { source: 'X' })).status).toBe(400);
    expect((await call('PATCH', `/v1/admin/wallets/${addr('Nope')}`, admin, { active: false })).status).toBe(404);
    expect((await call('PATCH', '/v1/admin/wallets/bad', admin, { active: false })).status).toBe(400);
  });

  it('imports a list: counts new, revived, existing and invalid entries, and audits once', async () => {
    await db.trackedWallet.update({ where: { address: addr('B') }, data: { active: false } });
    const auditBefore = await db.auditLog.count({ where: { userId: adminId, action: 'wallet.imported' } });
    const r = await call('POST', '/v1/admin/wallets/import', admin, { wallets: [
      { address: addr('J1'), label: 'one\u200B' }, { address: addr('J2') }, { address: addr('J1') },  // duplicate inside the list
      { address: addr('A') },                                                                          // already tracked
      { address: addr('B') },                                                                          // inactive: revived
      { address: 'nonsense' }, { address: '' },
    ] });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ added: 2, reactivated: 1, alreadyTracked: 1, syncRequested: true });
    expect(r.body.invalid).toEqual([{ index: 5, reason: 'not a valid address' }, { index: 6, reason: 'not a valid address' }]);
    expect(await db.trackedWallet.findUniqueOrThrow({ where: { address: addr('J1') } })).toMatchObject({ source: 'IMPORT', label: 'one', active: true });
    expect((await db.trackedWallet.findUniqueOrThrow({ where: { address: addr('B') } })).active).toBe(true);
    expect(await db.auditLog.count({ where: { userId: adminId, action: 'wallet.imported' } })).toBe(auditBefore + 1);
  });

  it('caps an import at 500 and refuses an empty one', async () => {
    expect((await call('POST', '/v1/admin/wallets/import', admin, { wallets: [] })).status).toBe(400);
    expect((await call('POST', '/v1/admin/wallets/import', admin, { wallets: Array.from({ length: 501 }, (_, i) => ({ address: addr(`M${i}`) })) })).status).toBe(400);
  });

  it('lists wallets with filters and cursor paging', async () => {
    const first = await call('GET', '/v1/admin/wallets?limit=2', admin);
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextCursor).toBeTruthy();
    const second = await call('GET', `/v1/admin/wallets?limit=2&cursor=${first.body.nextCursor}`, admin);
    const seen = [...first.body.items, ...second.body.items].map((w: { address: string }) => w.address);
    expect(new Set(seen).size).toBe(seen.length);

    await db.trackedWallet.update({ where: { address: addr('J2') }, data: { active: false } });
    const off = await call('GET', '/v1/admin/wallets?active=false&source=IMPORT&limit=100', admin);
    expect(off.body.items.map((w: { address: string }) => w.address)).toContain(addr('J2'));
    expect(off.body.items.every((w: { active: boolean; source: string }) => !w.active && w.source === 'IMPORT')).toBe(true);
    expect((await call('GET', '/v1/admin/wallets?limit=0', admin)).status).toBe(400);
    expect((await call('GET', '/v1/admin/wallets?source=NOPE', admin)).status).toBe(400);
  });

  describe('candidates', () => {
    const cand = (k: string, score: number, status = 'PENDING') => db.walletCandidate.create({ data: { address: addr(k), score, winnerTokens: 3, status, evidence: { hitRate: 0.8 } } });
    beforeAll(async () => { await cand('C1', 80); await cand('C2', 50); await cand('C3', 90, 'APPROVED'); await cand('C4', 70); await cand('C5', 60); await cand('C6', 65); });

    it('lists pending suggestions best first, and by status', async () => {
      const pending = (await call('GET', '/v1/admin/wallet-candidates?limit=100', admin)).body.items.map((c: { address: string }) => c.address);
      expect(pending.indexOf(addr('C1'))).toBeGreaterThanOrEqual(0);
      expect(pending.indexOf(addr('C1'))).toBeLessThan(pending.indexOf(addr('C2')));
      expect(pending).not.toContain(addr('C3'));
      expect((await call('GET', '/v1/admin/wallet-candidates?status=APPROVED&limit=100', admin)).body.items.map((c: { address: string }) => c.address)).toContain(addr('C3'));
      expect((await call('GET', '/v1/admin/wallet-candidates?status=NOPE', admin)).status).toBe(400);
    });

    it('approving tracks the wallet as DISCOVERED, records who reviewed it, and cannot be repeated', async () => {
      const r = await call('POST', `/v1/admin/wallet-candidates/${addr('C1')}/approve`, admin, { label: 'Early finder' });
      expect(r.body).toMatchObject({ approved: addr('C1'), syncRequested: true });
      expect(await db.trackedWallet.findUniqueOrThrow({ where: { address: addr('C1') } })).toMatchObject({ source: 'DISCOVERED', label: 'Early finder', active: true });
      expect(await db.walletCandidate.findUniqueOrThrow({ where: { address: addr('C1') } })).toMatchObject({ status: 'APPROVED', reviewedBy: adminId });
      expect((await call('POST', `/v1/admin/wallet-candidates/${addr('C1')}/approve`, admin, {})).status).toBe(409);
      expect((await call('POST', `/v1/admin/wallet-candidates/${addr('C1')}/reject`, admin)).status).toBe(409);
    });

    it('rejecting tracks nothing', async () => {
      expect((await call('POST', `/v1/admin/wallet-candidates/${addr('C2')}/reject`, admin)).body).toEqual({ rejected: addr('C2') });
      expect(await db.trackedWallet.findUnique({ where: { address: addr('C2') } })).toBeNull();
      expect((await db.walletCandidate.findUniqueOrThrow({ where: { address: addr('C2') } })).status).toBe('REJECTED');
    });

    it('answers 404 for an unknown suggestion and 400 for a malformed address or unknown field', async () => {
      expect((await call('POST', `/v1/admin/wallet-candidates/${addr('Nope')}/approve`, admin, {})).status).toBe(404);
      expect((await call('POST', '/v1/admin/wallet-candidates/bad/approve', admin, {})).status).toBe(400);
      expect((await call('POST', `/v1/admin/wallet-candidates/${addr('C4')}/approve`, admin, { active: true })).status).toBe(400);
      expect((await db.walletCandidate.findUniqueOrThrow({ where: { address: addr('C4') } })).status).toBe('PENDING');
    });

    it('lets two admins race: exactly one approval wins and only one wallet is created', async () => {
      const [a, b] = await Promise.all([call('POST', `/v1/admin/wallet-candidates/${addr('C5')}/approve`, admin, {}), call('POST', `/v1/admin/wallet-candidates/${addr('C5')}/approve`, admin, {})]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      expect(await db.trackedWallet.count({ where: { address: addr('C5') } })).toBe(1);
    });

    it('reactivates an inactive wallet when its suggestion is approved', async () => {
      await db.trackedWallet.create({ data: { address: addr('C6'), source: 'MANUAL', active: false } });
      await call('POST', `/v1/admin/wallet-candidates/${addr('C6')}/approve`, admin, {});
      expect(await db.trackedWallet.findUniqueOrThrow({ where: { address: addr('C6') } })).toMatchObject({ active: true, source: 'MANUAL' });
    });
  });

  it('reports sync status and accepts a manual sync request', async () => {
    const s = await call('GET', '/v1/admin/wallets/sync-status', admin);
    expect(s.body.configured).toBe(true);
    expect(s.body.activeWallets).toBeGreaterThan(0);
    const before = syncCalls;
    const r = await call('POST', '/v1/admin/wallets/sync', admin);
    expect(r).toMatchObject({ status: 202, body: { requested: true } });
    expect(syncCalls).toBe(before + 1);
  });

  it('says plainly when Helius sync is not configured', async () => {
    expect((await call('GET', '/v1/admin/wallets/sync-status', admin, undefined, bareApp)).body.configured).toBe(false);
    expect((await call('POST', '/v1/admin/wallets/sync', admin, undefined, bareApp)).status).toBe(503);
    const add = await call('POST', '/v1/admin/wallets', admin, { address: addr('N1') }, bareApp);
    expect(add).toMatchObject({ status: 201, body: { syncRequested: false } });
  });
});
