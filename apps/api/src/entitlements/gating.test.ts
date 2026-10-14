import { randomBytes, randomUUID } from 'node:crypto';
import bs58 from 'bs58';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrisma, Prisma } from '@narra/database';
import { buildApp } from '../app';
import { GATED_ROUTES } from './gating';
import { FEATURE_TIERS } from '@narra/shared';
import { applyWyntraxEvent } from './membershipStore';
import { entitlementTrace, featureDecision } from './access';
import { updateLocalSettings } from './settings';
import { researchEgress } from './egress';
import { researchPorts } from './chatAccess';
import { makeAgentPorts } from '../chatPorts';
import { RealtimeHub, type EventStream, type StreamEvent } from '@narra/realtime';
import * as access from './access';
const target = new URL(process.env.DATABASE_URL ?? 'invalid:');
if (target.hostname !== 'localhost' || target.port !== '5432' || target.pathname !== '/narra_ent') throw Error('Scratch only');
const db = createPrisma(target.toString()), tag = `gate-${randomUUID()}`, address = bs58.encode(randomBytes(32));
const keys = ['entitlements.enforced', 'entitlements.shadow_log', 'entitlements.features', 'early_access.enabled', 'early_access.seat_cap'];
let saved: Awaited<ReturnType<typeof db.systemSetting.findMany>>, app: Awaited<ReturnType<typeof buildApp>>, user: string, admin: string, other: string;
let at = new Date('2026-10-08T00:00:00Z'), version = 0, ownOpp: string, sharedOpp: string, mint: string;
const get = (url: string, who = 'user') => app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${who}` }, remoteAddress: `192.0.2.${++requestNo % 200 + 1}` });
let requestNo = 0;
const settings = (values: Record<string, unknown>) => updateLocalSettings(db, admin, values, 'Gate test');
const membership = (tier: 'NONE' | 'PRO' | 'ELITE' = 'PRO', validUntil = new Date(+at + 86400000)) => applyWyntraxEvent(db, { id: `${tag}-${++version}`, type: tier === 'NONE' ? 'membership.revoked' : 'membership.granted', occurredAt: at.toISOString(), data: { membershipId: tag, seq: version, key: tier === 'NONE' ? 'PRO' : tier, validUntil: tier === 'NONE' ? null : validUntil.toISOString(), chain: 'solana', wallet: address, checkedAt: at.toISOString() } }, 'fixture', at);
beforeAll(async () => {
  saved = await db.systemSetting.findMany({ where: { key: { in: keys } } });
  const ids = await Promise.all(['user', 'admin', 'other'].map(async who => (await db.user.create({ data: { privyUserId: `${tag}-${who}`, isAdmin: who === 'admin' } })).id));
  user = ids[0]!; admin = ids[1]!; other = ids[2]!;
  await db.linkedWallet.create({ data: { userId: user, chain: 'solana', address, verifiedAt: at } });
  await db.tradingPermission.create({ data: { userId: user, aiTradingEnabled: false, agentPaused: true } }); await db.riskProfile.create({ data: { userId: user } });
  const token = await db.token.create({ data: { mint: bs58.encode(randomBytes(32)), symbol: tag, name: tag } }); mint = token.mint;
  for (const owner of [user, null]) {
    const o = await db.opportunity.create({ data: { tokenId: token.id, score: 80, narrativeScore: 1, smartMoneyScore: 1, liquidityScore: 1, momentumScore: 1, ogScore: 1, riskScore: 1 } });
    const a = await db.agentAnalysis.create({ data: { opportunityId: o.id, model: 'test', bullCase: { text: owner ? 'own context' : 'shared context' } } });
    await db.agentDecision.create({ data: { analysisId: a.id, userId: owner, action: 'HOLD', confidence: 0.5, payload: { decision: { own: !!owner }, guardrails: ['safe'] } } });
    if (owner) ownOpp = o.id; else sharedOpp = o.id;
  }
  await db.trackedWallet.create({ data: { address } });
  app = await buildApp({ account: { db, now: () => at, verifier: { verify: async token => ({ privyUserId: `${tag}-${token}` }) } } });
  // Fastify's route tree is checked separately below through hasRoute and the source registrations.
}, 20000);
beforeEach(async () => { await db.accessGrant.deleteMany({ where: { userId: user } }); await settings({ 'entitlements.enforced': true, 'entitlements.shadow_log': false, 'entitlements.features': {}, 'early_access.enabled': false }); await membership('NONE'); });
afterAll(async () => {
  await app.close(); await db.auditLog.deleteMany({ where: { OR: [{ userId: { in: [user, admin, other] } }, { detail: { path: ['membershipId'], equals: tag } }] } });
  await db.user.deleteMany({ where: { id: { in: [user, admin, other] } } }); await db.token.deleteMany({ where: { name: tag } }); await db.trackedWallet.deleteMany({ where: { address } });
  await db.wyntraxEntitlement.deleteMany({ where: { membershipId: tag } });
  await db.webhookEvent.deleteMany({ where: { membershipId: tag } });
  await db.systemSetting.deleteMany({ where: { key: { in: keys } } }); for (const row of saved) await db.systemSetting.create({ data: { ...row, value: row.value === null ? Prisma.JsonNull : row.value as Prisma.InputJsonValue } }); await db.$disconnect();
});
describe('enforced research boundaries on scratch PostgreSQL', () => {
  it.each([
    ['GET', '/v1/me/entitlements'], ['POST', '/v1/me/early-access/join'], ['DELETE', '/v1/me/early-access'],
    ['GET', '/v1/admin/entitlements/settings'], ['PUT', '/v1/admin/entitlements/settings'], ['GET', '/v1/admin/users/:userId/entitlements'],
    ['POST', '/v1/admin/users/:userId/entitlements/grants'], ['POST', '/v1/admin/users/:userId/entitlements/grants/:id/revoke'],
    ['DELETE', '/v1/admin/users/:userId/linked-wallets/:id'], ['GET', '/v1/admin/early-access/stats'],
  ])('%s %s is entitlement-independent at NONE with enforcement ON', async (method, path) => {
    const url = path!.replace(':userId', user).replace(':id', 'missing');
    const r = await app.inject({ method: method as 'GET' | 'POST' | 'PUT' | 'DELETE', url, headers: { authorization: `Bearer ${path!.includes('/admin/') ? 'admin' : 'user'}` }, remoteAddress: `192.0.2.${++requestNo % 200 + 1}`, ...(method === 'POST' || method === 'PUT' ? { payload: {} } : {}) });
    expect(r.statusCode).not.toBe(403); expect(r.statusCode).not.toBe(500); expect(r.body).not.toContain('FEATURE_LOCKED');
    if (method === 'GET') expect(r.statusCode).toBe(200);
  });
  it.each(Object.entries(GATED_ROUTES))('%s denies NONE with the approved requiredTier after authentication', async (route, feature) => {
    const [method, path] = route.split(' ') as ['GET' | 'POST', string];
    const url = path.replace(':slug', 'absent').replace(':mint', mint);
    const r = await app.inject({ method, url, headers: { authorization: 'Bearer user' }, ...(method === 'POST' ? { payload: {} } : {}) });
    expect(r.statusCode).toBe(403); expect(r.json()).toMatchObject({ error: 'FEATURE_LOCKED', requiredTier: FEATURE_TIERS[feature], requestId: expect.any(String) });
    expect((await app.inject({ method, url })).statusCode).toBe(401);
  });
  it('ordinary token list, screener and approved rotation distinguish EARLY_ACCESS from PRO', async () => {
    await settings({ 'early_access.enabled': true, 'early_access.seat_cap': 100 });
    await db.accessGrant.upsert({ where: { userId_source: { userId: user, source: 'EARLY_ACCESS' } }, create: { userId: user, source: 'EARLY_ACCESS', tier: 'EARLY_ACCESS', status: 'ACTIVE' }, update: { status: 'ACTIVE' } });
    expect((await get('/v1/tokens')).statusCode).toBe(200); expect((await get('/v1/narratives/rotation')).statusCode).toBe(200);
    expect((await get('/v1/tokens?sort=liquidity')).statusCode).toBe(403);
    await membership(); expect((await get('/v1/smart-money/wallets')).statusCode).toBe(200);
  });
  it('off/shadow preserve availability; shadow logs contain only safe denial metadata', async () => {
    await settings({ 'entitlements.enforced': false, 'entitlements.shadow_log': true });
    const log = vi.fn(); expect((await featureDecision(db, user, 'research.chat', at, log)).allowed).toBe(true);
    expect(log).toHaveBeenCalledWith({ code: 'ENTITLEMENT_DENIAL', feature: 'research.chat', enforced: false });
    expect((await get('/v1/narratives')).statusCode).toBe(200);
  });
  it('page clamps precede queries, preserve nextCursor and leave invalid limits invalid', async () => {
    await settings({ 'early_access.enabled': true, 'early_access.seat_cap': 100 });
    await db.accessGrant.upsert({ where: { userId_source: { userId: user, source: 'EARLY_ACCESS' } }, create: { userId: user, source: 'EARLY_ACCESS', tier: 'EARLY_ACCESS', status: 'ACTIVE' }, update: { status: 'ACTIVE' } });
    await db.token.createMany({ data: Array.from({ length: 30 }, (_, i) => ({ mint: bs58.encode(randomBytes(32)), name: tag, symbol: `${tag}-${String(i).padStart(2, '0')}` })) });
    const first = (await get(`/v1/tokens?q=${tag}&limit=100`)).json(); expect(first.items).toHaveLength(20); expect(first.nextCursor).toBeTruthy();
    const next = (await get(`/v1/tokens?q=${tag}&limit=100&cursor=${first.nextCursor}`)).json(); expect(next.items).toHaveLength(11); expect(next.nextCursor).toBeNull();
    expect((await get('/v1/narratives?limit=1000')).statusCode).toBe(400);
  });
  it('search retains caller trade matches and never another user’s trade at NONE', async () => {
    const token = await db.token.findUniqueOrThrow({ where: { mint } }), signature = bs58.encode(randomBytes(64));
    const order = await db.order.create({ data: { userId: user, tokenId: token.id, idempotencyKey: tag, side: 'BUY', mode: 'AI_AUTO', simulated: true, status: 'CONFIRMED', sizeSol: 0.1 } });
    await db.trade.create({ data: { userId: user, orderId: order.id, side: 'BUY', mode: 'AI_AUTO', simulated: true, reason: 'fixture', expectedPriceUsd: 1, actualPriceUsd: 1, slippageBps: 0, signature } });
    expect((await get(`/v1/search?q=${signature}`)).json().results.transactions).toEqual([expect.objectContaining({ source: 'MY_TRADE', signature })]);
    expect((await get(`/v1/search?q=${signature}`, 'other')).json().results.transactions).toEqual([]);
  });
  it('mixed overview/search preserve own envelope and omit shared results at NONE', async () => {
    const overview = await get('/v1/overview'); expect(overview.statusCode).toBe(200);
    expect(overview.json()).toMatchObject({ me: { openPositions: 0 }, bar: null, rotation: null, strip: { topNarratives: [], hottestOpportunity: null }, brief: { points: [] } });
    const search = await get(`/v1/search?q=${tag}`); expect(search.statusCode).toBe(200); expect(search.json().results).toMatchObject({ tokens: [], wallets: [], narratives: [], creators: [] });
  });
  it('own decisions and analysis remain readable, no global fallback and no other-user access', async () => {
    expect((await get('/v1/opportunities')).json().items.map((i: any) => i.id)).toEqual([ownOpp]);
    expect((await get(`/v1/opportunities/${ownOpp}/analysis`)).json().decision).toEqual({ own: true });
    expect((await get(`/v1/opportunities/${sharedOpp}/analysis`)).statusCode).toBe(403);
    expect((await get(`/v1/opportunities/${ownOpp}/analysis`, 'other')).statusCode).toBe(403);
    expect((await get('/v1/opportunities', 'other')).json().items).toEqual([]);
  });
  it('verified owned wallet detail/history remains open, other users need PRO', async () => {
    for (const suffix of ['', '/trades']) { expect((await get(`/v1/wallets/${address}${suffix}`)).statusCode).toBe(200); expect((await get(`/v1/wallets/${address}${suffix}`, 'other')).statusCode).toBe(403); }
  });
  it('age starts locally, survives renewal, resets on NONE and expiry; unlink age cannot be inherited', async () => {
    await settings({ 'entitlements.features': { 'research.screener': { min_entitlement_age_hours: 2 } } });
    await membership(); expect((await featureDecision(db, user, 'research.screener', at)).allowed).toBe(false);
    at = new Date(+at + 7200000); await membership(); expect((await featureDecision(db, user, 'research.screener', at)).allowed).toBe(true);
    await db.linkedWallet.update({ where: { chain_address: { chain: 'solana', address } }, data: { verifiedAt: at } });
    expect((await featureDecision(db, user, 'research.screener', at)).allowed).toBe(false);
    at = new Date(+at + 7200000); expect((await featureDecision(db, user, 'research.screener', at)).allowed).toBe(true);
    await membership('NONE'); await membership(); expect((await featureDecision(db, user, 'research.screener', at)).allowed).toBe(false);
    await membership('PRO', new Date(+at - 1)); await membership(); expect((await entitlementTrace(db, user, at)).memberships[0]!.proSince).toEqual(at);
  });
  it('ELITE age cannot borrow PRO history and invalid overrides/paid local grants are rejected and audited', async () => {
    await membership(); at = new Date(+at + 7200000); await membership('ELITE');
    await settings({ 'entitlements.features': { 'research.chat': { min_entitlement_age_hours: 1 } } });
    expect((await featureDecision(db, user, 'research.chat', at)).allowed).toBe(false);
    for (const payload of [{ 'entitlements.features': { unknown: { requiredTier: 'NONE' } } }, { 'entitlements.features': { 'research.chat': { min_entitlement_age_hours: -1 } } }, { 'executor.kill_switch': false }]) await expect(settings(payload)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(await db.auditLog.count({ where: { userId: admin, action: 'entitlements.setting_changed' } })).toBeGreaterThan(0);
    for (const tier of ['PRO', 'ELITE', 'MEMBER']) {
      const r = await app.inject({ method: 'POST', url: `/v1/admin/users/${user}/entitlements/grants`, headers: { authorization: 'Bearer admin' }, payload: { tier, validUntil: new Date(+at + 86400000).toISOString(), reason: 'no' } }); expect(r.statusCode).toBe(400);
    }
    expect((await get('/v1/admin/entitlements/settings')).statusCode).toBe(403);
    expect((await get('/v1/admin/early-access/stats', 'admin')).json()).not.toHaveProperty('items');
  });
  it('lowering chat override cannot expose research tools or change trading authority', async () => {
    const before = { user: await db.user.findUnique({ where: { id: user } }), permission: await db.tradingPermission.findUnique({ where: { userId: user } }), risk: await db.riskProfile.findUnique({ where: { userId: user } }) };
    await settings({ 'entitlements.features': { 'research.chat': { requiredTier: 'NONE' } } });
    const ports = researchPorts(makeAgentPorts(db, () => at), db, user, () => at);
    expect(await ports.listOpportunities(20)).toEqual([]); expect(await ports.getToken(mint)).toBeNull(); expect(await ports.recentDecisions(mint, 20)).toEqual([]); expect(await ports.backtestSummary()).toBeNull();
    expect({ user: await db.user.findUnique({ where: { id: user } }), permission: await db.tradingPermission.findUnique({ where: { userId: user } }), risk: await db.riskProfile.findUnique({ where: { userId: user } }) }).toEqual(before);
  });
  it('admin HTTP settings/grant/revoke/unlink are audited, user-scoped and leave protected state unchanged', async () => {
    const before = { user: await db.user.findUnique({ where: { id: user } }), permission: await db.tradingPermission.findUnique({ where: { userId: user } }), risk: await db.riskProfile.findUnique({ where: { userId: user } }) };
    const headers = { authorization: 'Bearer admin' };
    expect((await app.inject({ method: 'PUT', url: '/v1/admin/entitlements/settings', headers, payload: { settings: { 'early_access.enabled': true, 'early_access.seat_cap': 100 }, reason: 'HTTP test' } })).statusCode).toBe(200);
    const grant = await app.inject({ method: 'POST', url: `/v1/admin/users/${user}/entitlements/grants`, headers, payload: { tier: 'EARLY_ACCESS', validUntil: new Date(+at + 3600000).toISOString(), reason: 'HTTP test' } }); expect(grant.statusCode).toBe(200);
    const trace = (await get(`/v1/admin/users/${user}/entitlements`, 'admin')).json(); expect(trace.grants).toContainEqual(expect.objectContaining({ id: grant.json().id, source: 'ADMIN', eligible: true }));
    expect((await app.inject({ method: 'POST', url: `/v1/admin/users/${other}/entitlements/grants/${grant.json().id}/revoke`, headers, payload: { reason: 'HTTP test' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/v1/admin/users/${user}/entitlements/grants/${grant.json().id}/revoke`, headers, payload: { reason: 'HTTP test' } })).statusCode).toBe(200);
    const link = await db.linkedWallet.create({ data: { userId: user, chain: 'solana', address: bs58.encode(randomBytes(32)), verifiedAt: at } });
    expect((await app.inject({ method: 'DELETE', url: `/v1/admin/users/${user}/linked-wallets/${link.id}`, headers, payload: { reason: 'HTTP test' } })).statusCode).toBe(200);
    const logs = await db.auditLog.findMany({ where: { userId: admin, action: { in: ['entitlements.granted', 'entitlements.revoked', 'entitlements.wallet_unlinked'] } } }); expect(logs.length).toBeGreaterThanOrEqual(3);
    expect({ user: await db.user.findUnique({ where: { id: user } }), permission: await db.tradingPermission.findUnique({ where: { userId: user } }), risk: await db.riskProfile.findUnique({ where: { userId: user } }) }).toEqual(before);
  });
  it('real WebSocket enforces shared replay/live access and expiry while keeping private delivery', async () => {
    await membership('PRO', new Date(+at + 1000));
    const hub = new RealtimeHub();
    const event = (id: string): StreamEvent => ({ id, type: 'opportunity.created', channel: 'opportunities', scope: 'global', userId: null, at: at.toISOString(), data: { id, mint, score: 80, narrativeSlug: null } });
    const stream = { newestId: async () => '0-0', canResumeFrom: async () => true, readRangePage: async () => ({ events: [event('1-0')], rawCount: 1, lastId: '1-0' }), readBlocking: async (lastId: string) => { await new Promise(r => setTimeout(r, 10)); return { entries: [], lastId }; } } as unknown as EventStream;
    const wsApp = await buildApp({ account: { db, verifier: { verify: async () => ({ privyUserId: `${tag}-user` }) } }, realtime: { hub, stream, readerStream: stream, now: () => +at } });
    const original = access.canReadFeature; let denied!: () => void; const denial = new Promise<void>(r => { denied = r; });
    const observer = vi.spyOn(access, 'canReadFeature').mockImplementation(async (...args) => { const result = await original(...args); if (!result) denied(); return result; });
    await wsApp.ready(); const socket = await wsApp.injectWS('/v1/stream'); const seen: any[] = [];
    socket.on('message', raw => seen.push(JSON.parse(raw.toString())));
    try {
      socket.send(JSON.stringify({ type: 'auth', token: 'test-session-token', lastEventId: '0-0', channels: ['opportunities'] }));
      await vi.waitFor(() => expect(seen.some(m => m.id === '1-0')).toBe(true));
      hub.dispatch(event('2-0')); await vi.waitFor(() => expect(seen.some(m => m.id === '2-0')).toBe(true));
      at = new Date(+at + 1001); hub.dispatch(event('3-0')); await denial;
      hub.dispatch({ id: '4-0', type: 'notification.created', channel: 'me', scope: 'user', userId: user, at: at.toISOString(), data: { id: 'n', alertId: 'a', kind: 'SAFETY', priority: 'CRITICAL', title: 'Own', body: 'Own', refType: null, refId: null } });
      await vi.waitFor(() => expect(seen.some(m => m.id === '4-0')).toBe(true)); expect(seen.some(m => m.id === '3-0')).toBe(false);
    } finally { socket.close(); observer.mockRestore(); await wsApp.close(); }
  });
  it('fresh egress checks preserve ordered research, bypass private/control traffic, enforce expiry and bounded backpressure', async () => {
    await membership(); const sent: any[] = []; let release!: () => void; const wait = new Promise<void>(r => { release = r; }); let first = true;
    const lane = researchEgress(m => sent.push(m), async feature => { if (first) { first = false; await wait; } return (await featureDecision(db, user, feature, at)).allowed; }, 2);
    const event = (id: string) => ({ type: 'event' as const, id, channel: 'opportunities' as const, event: { type: 'opportunity.created', at: at.toISOString(), data: {} } });
    lane.send(event('1')); lane.send(event('2')); lane.send(event('overflow'));
    lane.send({ type: 'event', id: 'private', channel: 'me', event: { type: 'trade.created', at: at.toISOString(), data: {} } });
    expect(sent.map(m => m.id ?? m.type)).toEqual(['resync', 'private']); release(); await lane.drained(); expect(sent.slice(-2).map(m => m.id)).toEqual(['1', '2']);
    at = new Date(+at + 86400001); lane.send(event('expired')); await lane.drained(); expect(sent.some(m => m.id === 'expired')).toBe(false); lane.close();
  });
});
