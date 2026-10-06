import pg from 'pg';
import { SignJWT, exportSPKI, generateKeyPair } from 'jose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createPrisma } from '@narra/database';
import { KILL_SWITCH_KEY, interpretKillSwitch } from '@narra/trading';
import { buildApp } from './app';
import { createPrivyVerifier } from './auth';

const url = process.env.DATABASE_URL ?? 'postgresql://narra:narra@localhost:5432/narra';
async function dbUp() {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 800 });
  try { await c.connect(); await c.query('select 1 from "DryRun" limit 1'); return true; } catch { return false; } finally { await c.end().catch(() => {}); }
}
const up = await dbUp();

describe.skipIf(!up)('executor admin routes: kill switch and dry-run review (needs Postgres)', () => {
  const db = createPrisma(url);
  const tag = `exa${Date.now()}`;
  const APP_ID = 'exec-admin-test';
  const admin = `did:privy:admin-${tag}`, user = `did:privy:user-${tag}`;
  let keys: Awaited<ReturnType<typeof generateKeyPair>>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let adminId = ''; let userId = '';

  const call = async (method: 'GET' | 'PUT', path: string, sub: string | null, payload?: unknown, ip?: string) => {
    const token = sub ? await new SignJWT({}).setProtectedHeader({ alg: 'ES256' }).setSubject(sub).setIssuer('privy.io').setAudience(APP_ID).setIssuedAt().setExpirationTime('5m').sign(keys.privateKey) : null;
    const res = await app.inject({ method, url: path, payload: payload as object, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(ip ? { remoteAddress: ip } : {}) });
    return { status: res.statusCode, body: res.json() };
  };
  const stored = async () => (await db.systemSetting.findUnique({ where: { key: KILL_SWITCH_KEY } }))?.value;

  beforeAll(async () => {
    keys = await generateKeyPair('ES256');
    app = await buildApp({ account: { db, verifier: createPrivyVerifier({ appId: APP_ID, verificationKey: await exportSPKI(keys.publicKey) }) } });
    adminId = (await db.user.create({ data: { privyUserId: admin, isAdmin: true } })).id;
    userId = (await db.user.create({ data: { privyUserId: user } })).id;
  });
  afterEach(async () => { await db.systemSetting.deleteMany({ where: { key: KILL_SWITCH_KEY } }); await db.auditLog.deleteMany({ where: { userId: adminId, action: 'executor.kill_switch.changed' } }); });
  afterAll(async () => {
    await db.dryRun.deleteMany({ where: { userId: { in: [adminId, userId] } } });
    await db.auditLog.deleteMany({ where: { userId: { in: [adminId, userId] } } });
    await db.user.deleteMany({ where: { id: { in: [adminId, userId] } } });
    await app.close(); await db.$disconnect();
  });

  it('keeps every executor admin route away from signed-out callers and ordinary users', async () => {
    for (const [m, p, b] of [['GET', '/v1/admin/executor/kill-switch'], ['PUT', '/v1/admin/executor/kill-switch', { enabled: true }], ['GET', '/v1/admin/dry-runs']] as const) {
      expect((await call(m, p, null, b, '10.1.1.1')).status, `${m} ${p} signed out`).toBe(401);
      expect((await call(m, p, user, b, '10.1.1.2')).status, `${m} ${p} user`).toBe(403);
    }
    expect(await stored()).toBeUndefined();
  });

  describe('kill switch', () => {
    it('starts off, turns on with or without a reason, and records who and when', async () => {
      expect((await call('GET', '/v1/admin/executor/kill-switch', admin)).body).toMatchObject({ tripped: false, malformed: false });
      const on = await call('PUT', '/v1/admin/executor/kill-switch', admin, { enabled: true });
      expect(on.body).toMatchObject({ tripped: true, by: adminId });
      expect(interpretKillSwitch(await stored())).toMatchObject({ tripped: true, malformed: false });
      expect((await call('GET', '/v1/admin/executor/kill-switch', admin)).body).toMatchObject({ tripped: true, by: adminId });
    });
    it('requires a reason to turn it back off, and audits both changes', async () => {
      await call('PUT', '/v1/admin/executor/kill-switch', admin, { enabled: true, reason: 'rpc node returning odd balances' });
      expect((await call('PUT', '/v1/admin/executor/kill-switch', admin, { enabled: false })).body).toEqual({ error: 'REASON_REQUIRED' });
      expect((await call('GET', '/v1/admin/executor/kill-switch', admin)).body.tripped).toBe(true); // the refused request changed nothing
      const off = await call('PUT', '/v1/admin/executor/kill-switch', admin, { enabled: false, reason: 'node fixed, checked three balances' });
      expect(off.body).toMatchObject({ tripped: false, reason: 'node fixed, checked three balances' });
      const audit = await db.auditLog.findMany({ where: { userId: adminId, action: 'executor.kill_switch.changed' }, orderBy: { createdAt: 'asc' } });
      expect(audit.map((a) => (a.detail as { enabled: boolean }).enabled)).toEqual([true, false]);
    });
    it('refuses unknown fields and empty or oversized reasons', async () => {
      for (const body of [{ enabled: true, force: 1 }, { enabled: 'yes' }, { enabled: true, reason: '' }, { enabled: true, reason: 'x'.repeat(201) }, {}]) {
        expect((await call('PUT', '/v1/admin/executor/kill-switch', admin, body)).status, JSON.stringify(body)).toBe(400);
      }
    });
    it('reports an unreadable stored value as tripped and malformed, so a corrupted switch stops trading', async () => {
      await db.systemSetting.create({ data: { key: KILL_SWITCH_KEY, value: { enabled: 'maybe' } } });
      expect((await call('GET', '/v1/admin/executor/kill-switch', admin)).body).toMatchObject({ tripped: true, malformed: true });
    });
  });

  describe('dry-run review', () => {
    const mk = (over: Record<string, unknown> = {}) => db.dryRun.create({ data: { userId, idempotencyKey: `dr-${tag}-${Math.random().toString(36).slice(2)}`, side: 'BUY', mint: 'M'.padEnd(40, '1'), sizeSol: 0.01, outcome: 'ACCEPTED', reasons: [], summary: { transaction: { feePayer: 'W' } }, simulation: { err: null }, messageHash: 'a'.repeat(64), ...over } as never });

    it('lists dry runs newest first with the decoded summary, and filters by outcome and user', async () => {
      const a = await mk({ createdAt: new Date(Date.now() - 3000) });
      const b = await mk({ outcome: 'REJECTED', reasons: [{ code: 'PROGRAM_NOT_ALLOWED', message: 'x' }], createdAt: new Date(Date.now() - 2000) });
      const c = await mk({ outcome: 'ERROR', reasons: [{ code: 'RPC_FAILED', message: 'x' }], sizeSol: null, createdAt: new Date(Date.now() - 1000) });
      const all = await call('GET', `/v1/admin/dry-runs?userId=${userId}`, admin);
      expect(all.body.items.map((i: { id: string }) => i.id)).toEqual([c.id, b.id, a.id]);
      expect(all.body.items[2]).toMatchObject({ outcome: 'ACCEPTED', sizeSol: 0.01, summary: { transaction: { feePayer: 'W' } }, simulation: { err: null }, messageHash: 'a'.repeat(64) });
      expect(all.body.items[0].sizeSol).toBeNull();
      expect((await call('GET', `/v1/admin/dry-runs?userId=${userId}&outcome=REJECTED`, admin)).body.items.map((i: { id: string }) => i.id)).toEqual([b.id]);
      expect((await call('GET', '/v1/admin/dry-runs?outcome=MAYBE', admin)).status).toBe(400);
    });
    it('pages with a cursor, and refuses one that does not exist', async () => {
      const p1 = await call('GET', `/v1/admin/dry-runs?userId=${userId}&limit=2`, admin);
      expect(p1.body.items).toHaveLength(2); expect(p1.body.nextCursor).toBeTruthy();
      const p2 = await call('GET', `/v1/admin/dry-runs?userId=${userId}&limit=2&cursor=${p1.body.nextCursor}`, admin);
      expect(p2.body.items).toHaveLength(1); expect(p2.body.nextCursor).toBeNull();
      expect((await call('GET', '/v1/admin/dry-runs?cursor=nope', admin)).status).toBe(400);
    });
    it('has no way to change or delete a dry run', async () => {
      expect((await call('PUT', '/v1/admin/dry-runs', admin, {})).status).toBe(404);
    });
  });
});
