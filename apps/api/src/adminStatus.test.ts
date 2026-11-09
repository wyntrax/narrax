import pg from 'pg';
import { SignJWT, exportSPKI, generateKeyPair } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrisma } from '@narra/database';
import type { QueueCounts } from '@narra/queue';
import { TRADING_PAUSE_KEY } from '@narra/worker-pipeline';
import { buildApp } from './app';
import { AI_PRICING_KEY } from './adminStatus';
import { createPrivyVerifier } from './auth';

const APP_ID = 'test-app-id';
const { publicKey, privateKey } = await generateKeyPair('ES256');
const verifier = createPrivyVerifier({ appId: APP_ID, verificationKey: await exportSPKI(publicKey) });
const sign = (sub: string) => new SignJWT({}).setProtectedHeader({ alg: 'ES256' }).setSubject(sub).setIssuer('privy.io').setAudience(APP_ID).setIssuedAt().setExpirationTime('5m').sign(privateKey);

const url = process.env.DATABASE_URL ?? 'postgresql://narra:narra@localhost:5432/narra';
async function dbUp() {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 800 });
  try { await c.connect(); await c.query('select "model" from "ChatMessage" limit 1'); return true; } catch { return false; } finally { await c.end().catch(() => {}); }
}
const up = await dbUp();
const DAY = 86_400_000;

describe.skipIf(!up)('admin status and costs (needs Postgres)', () => {
  const db = createPrisma(url);
  const tag = `st${Date.now()}`;
  const boss = `did:privy:boss-${tag}`, alice = `did:privy:alice-${tag}`;
  const NOW = new Date('2032-03-10T12:00:00Z'); // far from other tests' data, so only this test's rows are in range
  const userIds: string[] = [];
  const analysisIds: string[] = [], tokenIds: string[] = [];
  let bossId = '', aliceId = '';
  let app: Awaited<ReturnType<typeof buildApp>>;
  let appDown: Awaited<ReturnType<typeof buildApp>>;
  let saved: { pricing: unknown; pause: unknown } = { pricing: undefined, pause: undefined };
  let counts: Record<string, QueueCounts> = { execution: { waiting: 0, active: 0, failed: 0, delayed: 0 }, 'entry-fan-out': { waiting: 0, active: 0, failed: 0, delayed: 0 } };

  const http = async (method: 'GET' | 'PUT', path: string, sub: string | null, body?: unknown, a = app) => {
    const res = await a.inject({ method, url: path, headers: sub ? { authorization: `Bearer ${await sign(sub)}` } : {}, ...(body !== undefined ? { payload: body as object } : {}) });
    return { status: res.statusCode, body: res.json() };
  };

  beforeAll(async () => {
    app = await buildApp({ account: { db, verifier, now: () => NOW }, ops: { redisPing: async () => true, queueCounts: async () => counts, marketDataEnabled: true } });
    appDown = await buildApp({ account: { db, verifier, now: () => NOW }, ops: { redisPing: async () => false } });
    bossId = (await http('GET', '/v1/me', boss)).body.id; aliceId = (await http('GET', '/v1/me', alice)).body.id;
    userIds.push(bossId, aliceId);
    await db.user.update({ where: { id: bossId }, data: { isAdmin: true } });
    const [p, z] = await Promise.all([db.systemSetting.findUnique({ where: { key: AI_PRICING_KEY } }), db.systemSetting.findUnique({ where: { key: TRADING_PAUSE_KEY } })]);
    saved = { pricing: p?.value, pause: z?.value };
    await db.systemSetting.deleteMany({ where: { key: { in: [AI_PRICING_KEY, TRADING_PAUSE_KEY] } } });
  });
  afterAll(async () => {
    await db.systemSetting.deleteMany({ where: { key: { in: [AI_PRICING_KEY, TRADING_PAUSE_KEY] } } });
    if (saved.pricing !== undefined) await db.systemSetting.create({ data: { key: AI_PRICING_KEY, value: saved.pricing as object } });
    if (saved.pause !== undefined) await db.systemSetting.create({ data: { key: TRADING_PAUSE_KEY, value: saved.pause as object } });
    await db.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } }); // cascades chat messages
    await db.agentAnalysis.deleteMany({ where: { id: { in: analysisIds } } });
    await db.token.deleteMany({ where: { id: { in: tokenIds } } });
    await db.$disconnect();
  });

  it('is admin-only', async () => {
    for (const [m, p] of [['GET', '/v1/admin/status'], ['GET', '/v1/admin/data-health'], ['GET', '/v1/admin/costs'], ['GET', '/v1/admin/ai-pricing'], ['PUT', '/v1/admin/ai-pricing']] as const) {
      expect((await http(m, p, null, {})).status, p).toBe(401);
      expect((await http(m, p, alice, {})).status, p).toBe(403);
    }
  });

  describe('status', () => {
    it('serves bounded read-only ingestion diagnostics for admins',async()=>{
      const r=await http('GET','/v1/admin/data-health',boss);
      expect(r.status).toBe(200);expect(r.body.checkedAt).toBe(NOW.toISOString());
      expect(r.body.queues).toHaveLength(9);expect(r.body.queues.map((q:{name:string})=>q.name)).toEqual(expect.arrayContaining(['wallet-discovery','token-resolution','holder-refresh']));expect(r.body.market.scanned).toBeLessThanOrEqual(2000);
      expect(r.body.coverage.scanned).toBeLessThanOrEqual(2000);
      expect(r.body.coverage.stages.map((s:{stage:string})=>s.stage)).toEqual(['market','social','narrative']);
      expect(r.body.webhook.configured).toBeNull();
      expect(JSON.stringify(r.body)).not.toMatch(/postgres(ql)?:\/\/|api-key=|BEGIN PUBLIC KEY|authHeader/);
    });
    it('reports database, redis, queues, controls, counts and budgets, and warns about what needs attention', async () => {
      counts = { execution: { waiting: 0, active: 1, failed: 2, delayed: 0 }, 'entry-fan-out': { waiting: 150, active: 0, failed: 0, delayed: 0 } };
      await db.systemSetting.upsert({ where: { key: TRADING_PAUSE_KEY }, create: { key: TRADING_PAUSE_KEY, value: { paused: true, reason: 'drill', at: NOW.toISOString(), by: bossId } }, update: { value: { paused: true, reason: 'drill', at: NOW.toISOString(), by: bossId } } });
      const r = await http('GET', '/v1/admin/status', boss);
      expect(r.status).toBe(200);
      expect(r.body.database).toMatchObject({ ok: true });
      expect(r.body.redis).toMatchObject({ ok: true });
      expect(r.body.queues.execution).toEqual({ waiting: 0, active: 1, failed: 2, delayed: 0 });
      expect(r.body.controls).toMatchObject({ aiEnabled: expect.any(Boolean), tradingPause: { paused: true, reason: 'drill' } });
      expect(r.body.counts).toMatchObject({ admins: expect.any(Number), openPositions: { paper: expect.any(Number), real: expect.any(Number) } });
      expect(r.body.budgets.analysis).toMatchObject({ usedToday: expect.any(Number), budget: expect.any(Number) });
      expect(r.body.budgets.chat).toMatchObject({ budget: 500_000, perUserPerDay: 50_000 });
      const w: string[] = r.body.warnings;
      expect(w.some((x) => x.includes('execution') && x.includes('2 failed'))).toBe(true);
      expect(w.some((x) => x.includes('entry-fan-out') && x.includes('backlog of 150'))).toBe(true);
      expect(w.some((x) => x.includes('paused system-wide') && x.includes('drill'))).toBe(true);
      expect(w.some((x) => x.includes('no worker consuming'))).toBe(false); // consumers not reported: unknown is not zero
      counts = { execution: { waiting: 3, active: 0, failed: 0, delayed: 0, consumers: 0 }, 'entry-fan-out': { waiting: 0, active: 0, failed: 0, delayed: 0, consumers: 1 } };
      const orphan = (await http('GET', '/v1/admin/status', boss)).body.warnings as string[];
      expect(orphan.some((x) => x.includes('Queue execution has 3 job(s) waiting and no worker consuming it') && x.includes('npm run dev:executor'))).toBe(true);
      expect(orphan.some((x) => x.includes('entry-fan-out') && x.includes('no worker'))).toBe(false);
      await db.systemSetting.deleteMany({ where: { key: TRADING_PAUSE_KEY } });
    });

    it('says when redis is down, and says "not checked" rather than guessing when nothing can check it', async () => {
      const down = await http('GET', '/v1/admin/status', boss, undefined, appDown);
      expect(down.body.redis.ok).toBe(false);
      expect(down.body.warnings).toContain('Redis did not answer.');
      expect(down.body.queues).toBeNull();
      const bare = await buildApp({ account: { db, verifier, now: () => NOW } });
      const r = await http('GET', '/v1/admin/status', boss, undefined, bare);
      expect(r.body.redis).toMatchObject({ ok: null, note: 'not checked' });
    });

    it('calls a background job stale only when it should be running, and never exposes secrets', async () => {
      const r = await http('GET', '/v1/admin/status', boss);
      const f = r.body.freshness;
      expect(f.tokenMetric).toMatchObject({ applicable: true, expectedEveryMinutes: 5 });
      expect(f.tokenMetric.stale === true || f.tokenMetric.stale === false).toBe(true);
      const off = await buildApp({ account: { db, verifier, now: () => NOW }, ops: { marketDataEnabled: false } });
      expect((await http('GET', '/v1/admin/status', boss, undefined, off)).body.freshness.tokenMetric).toMatchObject({ applicable: false, stale: null });
      expect(JSON.stringify(r.body)).not.toMatch(/postgres(ql)?:\/\/|sk-|BEGIN/);
    });
  });

  describe('pricing and costs', () => {
    it('validates and audits prices, and refuses anything unknown or negative', async () => {
      for (const body of [{ prices: { m1: { inputPer1MUsd: -1, outputPer1MUsd: 1 } }, reason: 'x' }, { prices: { m1: { inputPer1MUsd: 1 } }, reason: 'x' }, { prices: { m1: { inputPer1MUsd: 1, outputPer1MUsd: 1, extra: 1 } }, reason: 'x' }, { prices: { 'bad name!': { inputPer1MUsd: 1, outputPer1MUsd: 1 } }, reason: 'x' }, { prices: {} }, { prices: {}, reason: 'x', more: 1 }]) {
        expect((await http('PUT', '/v1/admin/ai-pricing', boss, body)).status, JSON.stringify(body)).toBe(400);
      }
      expect((await http('GET', '/v1/admin/ai-pricing', boss)).body).toEqual({ prices: {} });
    });

    it('adds up tokens by day and source, prices only what has a price, and never guesses the rest', async () => {
      const token = await db.token.create({ data: { mint: `Cost${tag}`.padEnd(40, '1').replace(/0/g, 'x'), symbol: 'C', name: 'c' } });
      tokenIds.push(token.id);
      const opp = await db.opportunity.create({ data: { tokenId: token.id, score: 70, narrativeScore: 60, smartMoneyScore: 60, liquidityScore: 60, momentumScore: 60, ogScore: 60, riskScore: 20, createdAt: new Date(NOW.getTime() - 2 * DAY) } });
      const mkAnalysis = async (model: string, inp: number, outp: number, daysAgo: number) => { const a = await db.agentAnalysis.create({ data: { opportunityId: opp.id, model, inputTokens: inp, outputTokens: outp, createdAt: new Date(NOW.getTime() - daysAgo * DAY) } }); analysisIds.push(a.id); };
      await mkAnalysis('model-priced', 1_000_000, 500_000, 2);
      await mkAnalysis('model-priced', 1_000_000, 0, 2);
      await mkAnalysis('model-free', 200_000, 100_000, 1);
      const conv = await db.chatConversation.create({ data: { userId: aliceId } });
      const chat = (model: string | null, inp: number, outp: number, daysAgo: number) => db.chatMessage.create({ data: { conversationId: conv.id, userId: aliceId, role: 'ASSISTANT', content: 'x', inputTokens: inp, outputTokens: outp, model, createdAt: new Date(NOW.getTime() - daysAgo * DAY) } });
      await chat('model-priced', 400_000, 100_000, 1); await chat(null, 50_000, 10_000, 1);
      await chat('model-priced', 999_999, 999_999, 40); // outside a 30 day window

      const none = await http('GET', '/v1/admin/costs?days=30', boss);
      expect(none.status).toBe(200);
      expect(none.body.totals).toMatchObject({ analysisTokens: 2_800_000, chatTokens: 560_000 });
      expect(none.body.totals.analysisCostUsd).toBeNull(); // no prices yet: unknown, not zero
      expect(none.body.modelsWithoutPrice).toEqual(expect.arrayContaining(['model-free', 'model-priced', 'unknown']));

      expect((await http('PUT', '/v1/admin/ai-pricing', boss, { prices: { 'model-priced': { inputPer1MUsd: 2, outputPer1MUsd: 10 } }, reason: 'From the provider price page.' })).status).toBe(200);
      expect(await db.auditLog.count({ where: { userId: bossId, action: 'ai_pricing.changed' } })).toBe(1);
      const r = await http('GET', '/v1/admin/costs?days=30', boss);
      const d2 = r.body.daily.find((d: { day: string }) => d.day === '2032-03-08'), d1 = r.body.daily.find((d: { day: string }) => d.day === '2032-03-09');
      expect(d2.analysis).toMatchObject({ calls: 2, inputTokens: 2_000_000, outputTokens: 500_000 });
      expect(d2.analysis.costUsd).toBeCloseTo(2 * 2 + 0.5 * 10); // 2M in at $2, 0.5M out at $10
      expect(d1.analysis.costUsd).toBeNull(); // model-free has no price
      expect(d1.chat).toMatchObject({ calls: 2, inputTokens: 450_000, outputTokens: 110_000 });
      expect(d1.chat.costUsd).toBeNull(); // one message has no recorded model
      expect(r.body.totals.analysisCostUsd).toBeNull(); // a priced total only when every part is priced
      expect(r.body.modelsWithoutPrice).toEqual(['model-free', 'unknown']);
      expect(r.body.topChatUsers[0]).toMatchObject({ userId: aliceId, tokens: 560_000 });
      expect(r.body.notes.join(' ')).toContain('never guessed');
      expect((await http('GET', '/v1/admin/costs?days=1', boss)).body.daily.map((d: { day: string }) => d.day)).toEqual(['2032-03-09']); // a window is inclusive at its start, and older days drop out
      for (const q of ['days=0', 'days=999']) expect((await http('GET', `/v1/admin/costs?${q}`, boss)).status, q).toBe(400);
    });
  });
});
