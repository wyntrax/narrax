import pg from 'pg';
import { SignJWT, exportSPKI, generateKeyPair } from 'jose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createPrisma } from '@narra/database';
import { DEFAULT_AI_CONFIG } from '@narra/ai';
import { loadAiConfig, saveAiConfig, setAiEnabled } from '@narra/worker-pipeline';
import { buildApp } from './app';
import { createPrivyVerifier } from './auth';
import {seedTestPro,clearTestPro} from './test-membership';

const url = process.env.DATABASE_URL ?? 'postgresql://narra:narra@localhost:5432/narra';
async function dbUp() {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 800 });
  try { await c.connect(); await c.query('select 1 from "AgentAnalysis" limit 1'); return true; } catch { return false; } finally { await c.end().catch(() => {}); }
}
const up = await dbUp();

describe.skipIf(!up)('admin and analysis routes (needs Postgres)', () => {
  const db = createPrisma(url);
  const tag = `adm${Date.now()}`;
  const APP_ID = 'admin-test';
  let keys: Awaited<ReturnType<typeof generateKeyPair>>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const admin = `did:privy:admin-${tag}`, user = `did:privy:user-${tag}`, other = `did:privy:other-${tag}`;
  let userId = '', otherId = '';

  const call = async (method: 'GET' | 'PUT', path: string, sub: string, payload?: unknown, headers?: Record<string, string>) => {
    const token = await new SignJWT({}).setProtectedHeader({ alg: 'ES256' }).setSubject(sub).setIssuer('privy.io').setAudience(APP_ID).setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
    const res = await app.inject({ method, url: path, payload: payload as object, headers: { authorization: `Bearer ${token}`, ...headers } });
    return { status: res.statusCode, body: res.json() };
  };
  /** Runs `work` with ADMIN_EMAIL / ADMIN_PRIVY_USER_ID replaced, then puts the real environment back exactly as it was. */
  const withAdminEnv = async (env: { email?: string; privyUserId?: string }, work: () => Promise<void>) => {
    const before = { email: process.env.ADMIN_EMAIL, id: process.env.ADMIN_PRIVY_USER_ID };
    const set = (key: 'ADMIN_EMAIL' | 'ADMIN_PRIVY_USER_ID', value?: string) => { if (value === undefined) delete process.env[key]; else process.env[key] = value; };
    set('ADMIN_EMAIL', env.email); set('ADMIN_PRIVY_USER_ID', env.privyUserId);
    try { await work(); } finally { set('ADMIN_EMAIL', before.email); set('ADMIN_PRIVY_USER_ID', before.id); }
  };

  beforeAll(async () => {
    keys = await generateKeyPair('ES256');
    app = await buildApp({ account: { db, verifier: createPrivyVerifier({ appId: APP_ID, verificationKey: await exportSPKI(keys.publicKey) }) } });
    await db.user.create({ data: { privyUserId: admin, isAdmin: true } });
    userId = (await db.user.create({ data: { privyUserId: user } })).id;
    otherId = (await db.user.create({ data: { privyUserId: other } })).id;
    await seedTestPro(db,userId);await seedTestPro(db,otherId);
  });
  afterEach(async () => { await saveAiConfig(db, DEFAULT_AI_CONFIG); await setAiEnabled(db, true); });
  afterAll(async () => { await clearTestPro(db,[userId,otherId]);await db.linkedWallet.deleteMany({where:{userId:{in:[userId,otherId]}}});await app.close(); await db.$disconnect(); });

  it('keeps model settings away from non-admins', async () => {
    expect((await call('GET', '/v1/admin/ai-models', user)).status).toBe(403);
    expect((await call('PUT', '/v1/admin/ai-models', user, DEFAULT_AI_CONFIG)).status).toBe(403);
    expect((await call('PUT', '/v1/admin/ai-enabled', user, { enabled: false })).status).toBe(403);
    expect(await loadAiConfig(db)).toEqual(DEFAULT_AI_CONFIG);
  });

  it('lets an admin read and change the models, and audits the change', async () => {
    const g = await call('GET', '/v1/admin/ai-models', admin);
    expect(g.status).toBe(200);
    expect(g.body).toMatchObject({ config: DEFAULT_AI_CONFIG, enabled: true });
    const next = { ...DEFAULT_AI_CONFIG, fastModel: 'fast-x', reasoningModel: 'deep-x', judgeModel: 'judge-x', confidenceThreshold: 0.85 };
    expect((await call('PUT', '/v1/admin/ai-models', admin, next)).status).toBe(200);
    expect(await loadAiConfig(db)).toMatchObject({ fastModel: 'fast-x', judgeModel: 'judge-x', confidenceThreshold: 0.85 });
    const me = await db.user.findUniqueOrThrow({ where: { privyUserId: admin } });
    expect(await db.auditLog.count({ where: { userId: me.id, action: 'ai_config.changed' } })).toBeGreaterThan(0);
  });

  it('refuses unknown fields such as an API key, and out-of-range values', async () => {
    const withKey = await call('PUT', '/v1/admin/ai-models', admin, { ...DEFAULT_AI_CONFIG, apiKey: 'sk-secret' });
    expect(withKey.status).toBe(400);
    expect(withKey.body.fields).toContain('apiKey');
    expect(JSON.stringify(await db.systemSetting.findUnique({ where: { key: 'ai.models' } }))).not.toContain('sk-secret');
    expect((await call('PUT', '/v1/admin/ai-models', admin, { ...DEFAULT_AI_CONFIG, confidenceThreshold: 0.2 })).status).toBe(400);
    expect((await call('GET', '/v1/admin/ai-models', admin)).body.config).toEqual(DEFAULT_AI_CONFIG);
  });

  it('has a kill switch', async () => {
    expect((await call('PUT', '/v1/admin/ai-enabled', admin, { enabled: false })).body).toEqual({ enabled: false });
    expect((await call('GET', '/v1/admin/ai-models', admin)).body.enabled).toBe(false);
    expect((await call('PUT', '/v1/admin/ai-enabled', admin, { enabled: 'no' })).status).toBe(400);
  });

  it('lets only the ADMIN_PRIVY_USER_ID account be admin, ignoring a leftover database flag', async () => {
    await withAdminEnv({ privyUserId: user }, async () => {
      // The database admin is refused and the environment-listed account is allowed, without touching any stored row.
      expect((await call('GET', '/v1/admin/ai-models', admin)).status).toBe(403);
      expect((await call('GET', '/v1/admin/ai-models', user)).status).toBe(200);
      expect((await call('GET', '/v1/me', admin)).body).toMatchObject({ isAdmin: false });
      expect((await call('GET', '/v1/me', user)).body).toMatchObject({ isAdmin: true, admin: { configured: true, privyUserId: user } });
      expect((await db.user.findUniqueOrThrow({ where: { privyUserId: admin } })).isAdmin).toBe(true);
    });
  });

  it('accepts the configured admin by verified email from a Privy identity token', async () => {
    const address = `owner-${tag}@example.com`;
    await withAdminEnv({ email: address }, async () => {
      // A signed identity token is the only thing that can vouch for an email, and it is bound to the same user as the access token.
      const identity = await new SignJWT({ linked_accounts: [{ type: 'email', address: `Owner-${tag}@Example.com` }] })
        .setProtectedHeader({ alg: 'ES256' }).setSubject(other).setIssuer('privy.io').setAudience(APP_ID).setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
      const me = await call('GET', '/v1/me', other, undefined, { 'x-privy-identity-token': identity });
      expect(me.body).toMatchObject({ isAdmin: true, admin: { email: address } });
      expect((await db.user.findUniqueOrThrow({ where: { privyUserId: other } })).email).toBe(address);
      // Someone else's identity token is ignored, so it cannot borrow the admin email.
      const borrowed = await call('GET', '/v1/me', user, undefined, { 'x-privy-identity-token': identity });
      expect(borrowed.body).toMatchObject({ isAdmin: false });
      // A junk identity token is ignored too, and never rejects an otherwise valid sign-in.
      expect((await call('GET', '/v1/me', other, undefined, { 'x-privy-identity-token': 'not-a-token' })).status).toBe(200);
    });
  });

  it('explains a decision with the bull, bear and risk arguments, and shows each user only their own view', async () => {
    const token = await db.token.create({ data: { mint: `${tag}tok`.padEnd(40, '1'), symbol: 'X', name: 'X' } });
    const opp = await db.opportunity.create({ data: { tokenId: token.id, score: 88, narrativeScore: 1, smartMoneyScore: 1, liquidityScore: 1, momentumScore: 1, ogScore: 1, riskScore: 1 } });
    const a = await db.agentAnalysis.create({
      data: { opportunityId: opp.id, fastClassification: 'ANALYZE', fastScore: 85, bullCase: { arguments: ['wallets agree'], strength: 0.7, keyUncertainties: [] }, bearCase: { arguments: ['young token'], strength: 0.5, keyUncertainties: [] }, riskCase: { risks: [], maxLossScenario: 'x' }, model: 'deep-x' },
    });
    const dec = (action: string, summary: string) => ({ decision: { action, summary, positiveSignals: ['p'], negativeSignals: ['n'], risks: ['r'], invalidationConditions: ['i'] }, guardrails: ['SIZE_CAPPED'], judge: null });
    await db.agentDecision.create({ data: { analysisId: a.id, userId: null, action: 'BUY', confidence: 0.88, payload: dec('BUY', 'shared view') } });
    await db.agentDecision.create({ data: { analysisId: a.id, userId: otherId, action: 'WATCH', confidence: 0.5, payload: dec('WATCH', 'private view') } });

    const mine = await call('GET', `/v1/opportunities/${opp.id}/analysis`, user);
    expect(mine.status).toBe(200);
    expect(mine.body).toMatchObject({ model: 'deep-x', fast: { classification: 'ANALYZE', score: 85 }, bull: { arguments: ['wallets agree'] }, bear: { arguments: ['young token'] }, guardrails: ['SIZE_CAPPED'], decision: { action: 'BUY', summary: 'shared view' } });
    expect((await call('GET', `/v1/opportunities/${opp.id}/analysis`, other)).body.decision).toMatchObject({ action: 'WATCH', summary: 'private view' });
    expect((await call('GET', '/v1/opportunities/nope/analysis', user)).status).toBe(404);
    void userId;
  });
});
