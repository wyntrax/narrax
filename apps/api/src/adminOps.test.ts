import pg from 'pg';
import { SignJWT, exportSPKI, generateKeyPair } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrisma } from '@narra/database';
import { GLOBAL_LIMITS, SYSTEM_LIMITS_KEY } from '@narra/risk';
import { TRADING_PAUSE_KEY, loadSystemControls } from '@narra/worker-pipeline';
import { buildApp } from './app';
import { createPrivyVerifier } from './auth';

const APP_ID = 'test-app-id';
const { publicKey, privateKey } = await generateKeyPair('ES256');
const verifier = createPrivyVerifier({ appId: APP_ID, verificationKey: await exportSPKI(publicKey) });
const sign = (sub: string) => new SignJWT({}).setProtectedHeader({ alg: 'ES256' }).setSubject(sub).setIssuer('privy.io').setAudience(APP_ID).setIssuedAt().setExpirationTime('5m').sign(privateKey);

const url = process.env.DATABASE_URL ?? 'postgresql://narra:narra@localhost:5432/narra';
async function dbUp() {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 800 });
  try { await c.connect(); await c.query('select "blacklistReason" from "Token" limit 1'); return true; } catch { return false; } finally { await c.end().catch(() => {}); }
}
const up = await dbUp();

describe.skipIf(!up)('admin operations (needs Postgres)', () => {
  const db = createPrisma(url);
  const tag = `ao${Date.now()}`;
  const boss = `did:privy:boss-${tag}`, alice = `did:privy:alice-${tag}`;
  const MINT = `Ops${tag}`.padEnd(40, '1').replace(/0/g, 'x').replace(/O/g, 'y').replace(/I/g, 'z').replace(/l/g, 'w');
  const userIds: string[] = [];
  let app: Awaited<ReturnType<typeof buildApp>>;
  let bossId = '';
  let saved: { limits: unknown; pause: unknown } = { limits: undefined, pause: undefined };

  const http = async (method: 'GET' | 'PUT' | 'POST', path: string, sub: string | null, body?: unknown) => {
    const res = await app.inject({ method, url: path, headers: sub ? { authorization: `Bearer ${await sign(sub)}` } : {}, ...(body !== undefined ? { payload: body as object } : {}) });
    return { status: res.statusCode, body: res.json() };
  };

  beforeAll(async () => {
    app = await buildApp({ account: { db, verifier } });
    bossId = (await http('GET', '/v1/me', boss)).body.id as string;
    userIds.push(bossId, (await http('GET', '/v1/me', alice)).body.id as string);
    await db.user.update({ where: { id: bossId }, data: { isAdmin: true } });
    // Other test files share this database, so remember the real settings and put them back afterwards.
    const [l, p] = await Promise.all([db.systemSetting.findUnique({ where: { key: SYSTEM_LIMITS_KEY } }), db.systemSetting.findUnique({ where: { key: TRADING_PAUSE_KEY } })]);
    saved = { limits: l?.value, pause: p?.value };
    await db.systemSetting.deleteMany({ where: { key: { in: [SYSTEM_LIMITS_KEY, TRADING_PAUSE_KEY] } } });
  });
  afterAll(async () => {
    await db.systemSetting.deleteMany({ where: { key: { in: [SYSTEM_LIMITS_KEY, TRADING_PAUSE_KEY] } } });
    if (saved.limits !== undefined) await db.systemSetting.create({ data: { key: SYSTEM_LIMITS_KEY, value: saved.limits as object } });
    if (saved.pause !== undefined) await db.systemSetting.create({ data: { key: TRADING_PAUSE_KEY, value: saved.pause as object } });
    await db.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.token.deleteMany({ where: { mint: MINT } });
    await db.$disconnect();
  });

  it('is admin-only on every endpoint', async () => {
    const calls: ['GET' | 'PUT' | 'POST', string][] = [['GET', '/v1/admin/system-limits'], ['PUT', '/v1/admin/system-limits'], ['POST', '/v1/admin/system-limits/reset'], ['GET', '/v1/admin/trading-pause'], ['PUT', '/v1/admin/trading-pause'], ['GET', '/v1/admin/blacklist'], ['PUT', `/v1/admin/tokens/${MINT}/blacklist`], ['GET', '/v1/admin/audit']];
    for (const [m, p] of calls) {
      expect((await http(m, p, null, {})).status, `${m} ${p} anon`).toBe(401);
      expect((await http(m, p, alice, {})).status, `${m} ${p} user`).toBe(403);
    }
  });

  describe('system limits', () => {
    it('shows the code defaults when nothing is set', async () => {
      const r = await http('GET', '/v1/admin/system-limits', boss);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ effective: GLOBAL_LIMITS, overrides: {}, ignoredInvalid: [], codeCeilings: GLOBAL_LIMITS, lastChange: null });
    });

    it('tightens limits, audits who, what and why, and the worker sees the change at once', async () => {
      const r = await http('PUT', '/v1/admin/system-limits', boss, { limits: { maxPerTradeSol: 0.2, minConfidence: 0.8 }, reason: 'Volatile week: cutting size.' });
      expect(r.status).toBe(200);
      expect(r.body.effective).toMatchObject({ maxPerTradeSol: 0.2, minConfidence: 0.8, maxDailyAllocationSol: GLOBAL_LIMITS.maxDailyAllocationSol });
      expect(r.body.overrides).toEqual({ maxPerTradeSol: 0.2, minConfidence: 0.8 });
      expect(r.body.lastChange).toMatchObject({ by: bossId, action: 'system_limits.changed', reason: 'Volatile week: cutting size.' });
      const audit = await db.auditLog.findFirstOrThrow({ where: { userId: bossId, action: 'system_limits.changed' }, orderBy: { createdAt: 'desc' } });
      expect(audit.detail).toMatchObject({ before: {}, after: { maxPerTradeSol: 0.2, minConfidence: 0.8 }, reason: 'Volatile week: cutting size.' });
      expect((await loadSystemControls(db)).limits).toMatchObject({ maxPerTradeSol: 0.2, minConfidence: 0.8 });
    });

    it('a new submission replaces the overrides: a limit left out returns to the code default, and the audit shows the before', async () => {
      const r = await http('PUT', '/v1/admin/system-limits', boss, { limits: { maxOpenPositions: 4 }, reason: 'Simplify.' });
      expect(r.body.overrides).toEqual({ maxOpenPositions: 4 });
      expect(r.body.effective.maxPerTradeSol).toBe(GLOBAL_LIMITS.maxPerTradeSol);
      const audit = await db.auditLog.findFirstOrThrow({ where: { userId: bossId, action: 'system_limits.changed' }, orderBy: { createdAt: 'desc' } });
      expect(audit.detail).toMatchObject({ before: { maxPerTradeSol: 0.2, minConfidence: 0.8 }, after: { maxOpenPositions: 4 } });
    });

    it('refuses anything looser than the code, anything unknown, and anything without a reason, and stores nothing', async () => {
      const before = (await db.systemSetting.findUnique({ where: { key: SYSTEM_LIMITS_KEY } }))!.value;
      const cases: [unknown, string][] = [
        [{ limits: { maxPerTradeSol: 50 }, reason: 'x' }, 'LOOSER_THAN_CODE_CEILING'],
        [{ limits: { minConfidence: 0.1 }, reason: 'x' }, 'LOOSER_THAN_CODE_CEILING'],
        [{ limits: { maxPerTradeSol: 0 }, reason: 'x' }, 'STRICTER_THAN_ALLOWED'],
        [{ limits: { maxOpenPositions: 2.5 }, reason: 'x' }, 'NOT_INTEGER'],
        [{ limits: { maxPerTradeSol: '0.1' }, reason: 'x' }, 'NOT_A_NUMBER'],
        [{ limits: { apiKey: 'sk-secret' }, reason: 'x' }, 'UNKNOWN_FIELD'],
        [{ limits: { __proto__: { maxPerTradeSol: 1 }, constructor: 1 }, reason: 'x' }, 'UNKNOWN_FIELD'],
      ];
      for (const [body, code] of cases) {
        const r = await http('PUT', '/v1/admin/system-limits', boss, body);
        expect(r.status, code).toBe(400);
        expect(JSON.stringify(r.body.problems), code).toContain(code);
      }
      for (const body of [{ limits: { maxPerTradeSol: 0.5 } }, { limits: { maxPerTradeSol: 0.5 }, reason: '' }, { limits: [], reason: 'x' }, { limits: {}, reason: 'x', extra: 1 }, { limits: { maxPerTradeSol: 0.5 }, reason: '\u202e\u200b' }]) {
        expect((await http('PUT', '/v1/admin/system-limits', boss, body)).status, JSON.stringify(body)).toBe(400);
      }
      expect((await db.systemSetting.findUnique({ where: { key: SYSTEM_LIMITS_KEY } }))!.value).toEqual(before);
    });

    it('a stored setting that was tampered with directly never loosens anything, and the view says what was ignored', async () => {
      await db.systemSetting.update({ where: { key: SYSTEM_LIMITS_KEY }, data: { value: { maxPerTradeSol: 500, minConfidence: 0.01, maxOpenPositions: 3, secret: 'x' } } });
      const r = await http('GET', '/v1/admin/system-limits', boss);
      expect(r.body.effective).toMatchObject({ ...GLOBAL_LIMITS, maxOpenPositions: 3 });
      expect(r.body.ignoredInvalid.sort()).toEqual(['maxPerTradeSol', 'minConfidence', 'secret']);
      const c = await loadSystemControls(db);
      expect(c.limits.maxPerTradeSol).toBe(GLOBAL_LIMITS.maxPerTradeSol);
      expect(c.limits.minConfidence).toBe(GLOBAL_LIMITS.minConfidence);
    });

    it('reset returns every limit to the code default and is audited', async () => {
      const r = await http('POST', '/v1/admin/system-limits/reset', boss, { reason: 'Back to defaults.' });
      expect(r.body).toMatchObject({ effective: GLOBAL_LIMITS, overrides: {}, lastChange: { action: 'system_limits.reset', reason: 'Back to defaults.' } });
      expect(await db.systemSetting.findUnique({ where: { key: SYSTEM_LIMITS_KEY } })).toBeNull();
      expect((await http('POST', '/v1/admin/system-limits/reset', boss, {})).status).toBe(400);
    });
  });

  describe('global pause', () => {
    it('pauses and resumes new entries, with a reason, audited, and visible to the worker', async () => {
      expect((await http('GET', '/v1/admin/trading-pause', boss)).body).toMatchObject({ paused: false });
      const p = await http('PUT', '/v1/admin/trading-pause', boss, { paused: true, reason: 'RPC provider incident.' });
      expect(p.body).toMatchObject({ paused: true, reason: 'RPC provider incident.', by: bossId });
      expect((await loadSystemControls(db)).pause).toMatchObject({ paused: true, reason: 'RPC provider incident.' });
      expect(await db.auditLog.count({ where: { userId: bossId, action: 'system.trading_paused' } })).toBe(1);
      expect((await http('PUT', '/v1/admin/trading-pause', boss, { paused: false, reason: 'Resolved.' })).body.paused).toBe(false);
      expect((await loadSystemControls(db)).pause.paused).toBe(false);
      expect(await db.auditLog.count({ where: { userId: bossId, action: 'system.trading_resumed' } })).toBe(1);
      expect((await http('PUT', '/v1/admin/trading-pause', boss, { paused: true })).status).toBe(400); // no reason
      expect((await http('PUT', '/v1/admin/trading-pause', boss, { paused: 'yes', reason: 'x' })).status).toBe(400);
    });
  });

  describe('token blacklist', () => {
    it('blacklists with a reason, lists it, reports open positions, audits, and un-blacklists', async () => {
      const token = await db.token.create({ data: { mint: MINT, symbol: 'OPS', name: 'ops token' } });
      expect((await http('PUT', `/v1/admin/tokens/${MINT}/blacklist`, boss, { blacklisted: true, reason: 'Honeypot confirmed.' })).body).toMatchObject({ mint: MINT, blacklisted: true, changed: true, openPositions: 0 });
      expect(await db.token.findUniqueOrThrow({ where: { mint: MINT } })).toMatchObject({ blacklisted: true, blacklistReason: 'Honeypot confirmed.', blacklistedBy: bossId });
      expect((await db.token.findUniqueOrThrow({ where: { mint: MINT } })).blacklistedAt).not.toBeNull();
      const list = await http('GET', '/v1/admin/blacklist?limit=100', boss);
      expect(list.body.items.find((i: { mint: string }) => i.mint === MINT)).toMatchObject({ symbol: 'OPS', reason: 'Honeypot confirmed.', blacklistedBy: bossId });
      expect(await db.auditLog.count({ where: { userId: bossId, action: 'token.blacklisted' } })).toBe(1);

      const again = await http('PUT', `/v1/admin/tokens/${MINT}/blacklist`, boss, { blacklisted: true, reason: 'again' });
      expect(again.body).toMatchObject({ changed: false });
      expect(await db.auditLog.count({ where: { userId: bossId, action: 'token.blacklisted' } })).toBe(1); // a no-op is not a change

      const off = await http('PUT', `/v1/admin/tokens/${MINT}/blacklist`, boss, { blacklisted: false, reason: 'False alarm.' });
      expect(off.body).toMatchObject({ blacklisted: false, changed: true });
      expect(await db.token.findUniqueOrThrow({ where: { mint: MINT } })).toMatchObject({ blacklisted: false, blacklistReason: null, blacklistedAt: null, blacklistedBy: null });
      expect((await http('GET', '/v1/admin/blacklist?limit=100', boss)).body.items.map((i: { mint: string }) => i.mint)).not.toContain(MINT);
      expect(await db.auditLog.count({ where: { userId: bossId, action: 'token.unblacklisted' } })).toBe(1);

      // Open positions are reported, never closed by the list.
      await db.position.create({ data: { userId: bossId, tokenId: token.id, mode: 'PAPER', simulated: true, entryPriceUsd: 1, sizeSol: 0.1, entryContext: {}, openKey: `${bossId}:${token.id}` } });
      const withPos = await http('PUT', `/v1/admin/tokens/${MINT}/blacklist`, boss, { blacklisted: true, reason: 'Rug.' });
      expect(withPos.body.openPositions).toBe(1);
      expect((await db.position.findFirstOrThrow({ where: { tokenId: token.id } })).status).toBe('OPEN');
    });

    it('validates input and 404s an unknown token', async () => {
      expect((await http('PUT', `/v1/admin/tokens/${'A'.repeat(40)}/blacklist`, boss, { blacklisted: true, reason: 'x' })).status).toBe(404);
      for (const [p, b] of [['/v1/admin/tokens/not-base58-0OIl/blacklist', { blacklisted: true, reason: 'x' }], [`/v1/admin/tokens/${MINT}/blacklist`, { blacklisted: true }], [`/v1/admin/tokens/${MINT}/blacklist`, { blacklisted: 'yes', reason: 'x' }], [`/v1/admin/tokens/${MINT}/blacklist`, { blacklisted: true, reason: 'x', symbol: 'evil' }]] as const) {
        expect((await http('PUT', p, boss, b)).status, p).toBe(400);
      }
      expect((await http('GET', '/v1/admin/blacklist?cursor=%%%', boss)).status).toBe(400);
    });
  });

  describe('audit log', () => {
    it('lists admin actions newest first, filters by action, pages without gaps, and rejects bad input', async () => {
      const all = await http('GET', `/v1/admin/audit?limit=100&userId=${bossId}`, boss);
      expect(all.status).toBe(200);
      const actions = all.body.items.map((i: { action: string }) => i.action);
      expect(actions).toEqual(expect.arrayContaining(['system_limits.changed', 'system_limits.reset', 'system.trading_paused', 'token.blacklisted']));
      const times = all.body.items.map((i: { at: string }) => Date.parse(i.at));
      expect(times).toEqual([...times].sort((a, b) => b - a));
      const only = await http('GET', `/v1/admin/audit?action=token.blacklisted&userId=${bossId}`, boss);
      expect(only.body.items.every((i: { action: string }) => i.action === 'token.blacklisted')).toBe(true);
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < 20; i++) {
        const r: { body: { items: { id: string }[]; nextCursor: string | null } } = await http('GET', `/v1/admin/audit?limit=2&userId=${bossId}${cursor ? `&cursor=${cursor}` : ''}`, boss);
        seen.push(...r.body.items.map((x) => x.id));
        if (!r.body.nextCursor) break;
        cursor = r.body.nextCursor;
      }
      expect(new Set(seen).size).toBe(seen.length);
      expect(seen.length).toBe(all.body.items.length);
      for (const q of ['limit=0', 'limit=1000', 'action=DROP TABLE', 'cursor=%%%', `cursor=${Buffer.from('["x","y"]').toString('base64url')}`]) expect((await http('GET', `/v1/admin/audit?${q}`, boss)).status, q).toBe(400);
    });
  });
});
