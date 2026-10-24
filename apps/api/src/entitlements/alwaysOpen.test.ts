import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import { createPrisma, Prisma } from '@narra/database';
import { RealtimeHub, type EventStream, type StreamEvent } from '@narra/realtime';
import * as policy from '@narra/shared';
import { buildApp } from '../app';

/** Exact route names are pinned for Checkpoint B and Stage 4 regression coverage. */
export const ALWAYS_OPEN_HTTP = [
  'GET /health', 'POST /webhooks/helius', 'POST /v1/risk/evaluate',
  'GET /v1/me', 'PUT /v1/mode', 'PUT /v1/ai-access', 'PUT /v1/risk-profile', 'POST /v1/ai-access/revoke', 'POST /v1/agent/pause', 'POST /v1/agent/resume',
  'GET /v1/me/wallets', 'GET /v1/me/wallets/balances', 'GET /v1/positions', 'GET /v1/trades', 'GET /v1/trades/export',
  'GET /v1/confirmations', 'POST /v1/confirmations/:id/confirm', 'POST /v1/confirmations/:id/reject',
  'GET /v1/alerts', 'GET /v1/alerts/unread-count', 'POST /v1/alerts/:id/read', 'POST /v1/alerts/read-all',
  'GET /v1/settings', 'PUT /v1/settings/profile', 'PUT /v1/settings/appearance', 'PUT /v1/settings/notifications', 'PUT /v1/settings/interests',
  'GET /v1/analytics/me/performance', 'GET /v1/analytics/me/equity',
  'GET /v1/chat/conversations', 'GET /v1/chat/conversations/:id', 'GET /v1/chat/proposals', 'POST /v1/chat/proposals/:id/apply', 'POST /v1/chat/proposals/:id/reject',
  'GET /v1/overview', 'GET /v1/search',
  'GET /v1/admin/connections', 'GET /v1/admin/dry-runs', 'GET /v1/admin/executor/kill-switch', 'PUT /v1/admin/executor/kill-switch',
  'GET /v1/admin/ai-models', 'PUT /v1/admin/ai-models', 'PUT /v1/admin/ai-enabled',
  'GET /v1/admin/wallets', 'POST /v1/admin/wallets', 'POST /v1/admin/wallets/import', 'PATCH /v1/admin/wallets/:address',
  'GET /v1/admin/wallets/sync-status', 'POST /v1/admin/wallets/sync', 'GET /v1/admin/wallet-candidates', 'POST /v1/admin/wallet-candidates/:address/approve', 'POST /v1/admin/wallet-candidates/:address/reject',
  'GET /v1/admin/system-limits', 'PUT /v1/admin/system-limits', 'POST /v1/admin/system-limits/reset', 'GET /v1/admin/trading-pause', 'PUT /v1/admin/trading-pause',
  'GET /v1/admin/blacklist', 'PUT /v1/admin/tokens/:mint/blacklist', 'GET /v1/admin/audit',
  'GET /v1/admin/status', 'GET /v1/admin/data-health', 'GET /v1/admin/costs', 'GET /v1/admin/ai-pricing', 'PUT /v1/admin/ai-pricing',
  'GET /v1/analytics/backtests', 'GET /v1/analytics/backtests/:id',
  'POST /v1/me/linked-wallets/challenge', 'POST /v1/me/linked-wallets/verify', 'GET /v1/me/linked-wallets', 'DELETE /v1/me/linked-wallets/:id',
] as const;
import { assertTestDatabase } from '../../../../scripts/test-database';
const target = new URL(process.env.DATABASE_URL ?? 'invalid:');
assertTestDatabase(target);
const db = createPrisma(target.toString());
const privyUserId = `open-${randomUUID()}`;
const keys = ['entitlements.enforced', 'entitlements.shadow_log'];
let original: Awaited<ReturnType<typeof db.systemSetting.findMany>>;
let userId: string;
let app: Awaited<ReturnType<typeof buildApp>>;
let resolver: MockInstance<typeof policy.resolveEntitlements>;
const hub = new RealtimeHub();
const ownEvent = (id: string): StreamEvent => ({ id, type: 'notification.created', channel: 'me', scope: 'user', userId, at: new Date().toISOString(), data: { id: 'notification', alertId: 'alert', kind: 'SAFETY', priority: 'CRITICAL', title: 'Safety', body: 'Own alert', refType: null, refId: null } });
const stream = {
  newestId: async () => '0-0', canResumeFrom: async () => true,
  readRangePage: async () => ({ events: [ownEvent('1-0')], rawCount: 1, lastId: '1-0' }),
  readBlocking: async (lastId: string) => { await new Promise(resolve => setTimeout(resolve, 10)); return { entries: [], lastId }; },
} as unknown as EventStream;
beforeAll(async () => {
  original = await db.systemSetting.findMany({ where: { key: { in: keys } } });
  userId = (await db.user.create({ data: { privyUserId, isAdmin: true } })).id;
  expect(policy.resolveEntitlements({ userId, linkedWallets: [], grants: [], memberships: [], earlyAccessEnabled: false }, new Date()).effectiveTier).toBe('NONE');
  resolver = vi.spyOn(policy, 'resolveEntitlements').mockImplementation(() => { throw Error('Own-data/control paths must not depend on entitlement availability'); });
  app = await buildApp({ account: { db, verifier: { verify: async () => ({ privyUserId }) } }, webhooks: { secret: 'test-helius', enqueue: async () => undefined, isTracked: async () => false }, realtime: { hub, stream, readerStream: stream } });
}, 20_000);
afterAll(async () => {
  resolver.mockRestore(); await app.close();
  await db.auditLog.deleteMany({ where: { userId } }); await db.user.delete({ where: { id: userId } });
  await db.systemSetting.deleteMany({ where: { key: { in: keys } } });
  for (const row of original) await db.systemSetting.create({ data: { ...row, value: row.value === null ? Prisma.JsonNull : row.value as Prisma.InputJsonValue } });
  await db.$disconnect();
});
describe('named always-open routes at NONE with enforced=true', () => {
  it('GET /v1/stream authenticates and delivers private replay/live events at NONE with enforcement ON', async () => {
    await db.systemSetting.upsert({ where: { key: 'entitlements.enforced' }, create: { key: 'entitlements.enforced', value: true }, update: { value: true } });
    await app.ready();
    const socket = await app.injectWS('/v1/stream');
    const message = (id: string) => new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('private event timeout')), 3000);
      socket.on('message', raw => { const m = JSON.parse(raw.toString()); if (m.type === 'event' && m.id === id) { clearTimeout(timer); resolve(m); } });
    });
    try {
      const replay = message('1-0'); socket.send(JSON.stringify({ type: 'auth', token: 'test-session-token', lastEventId: '0-0', channels: [] }));
      expect((await replay).channel).toBe('me');
      const live = message('2-0'); hub.dispatch(ownEvent('2-0'));
      expect((await live).event.data.body).toBe('Own alert');
      expect(resolver).not.toHaveBeenCalled();
    } finally { socket.close(); }
  });
  it.each(ALWAYS_OPEN_HTTP)('%s preserves own-data/control availability when enforcement turns on', async name => {
    resolver.mockClear();
    const [method, path] = name.split(' ') as ['GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', string];
    expect(app.hasRoute({ method, url: path }), name).toBe(true);
    const endpoint = path.replace(':id', 'missing-fixture').replace(':address', 'So11111111111111111111111111111111111111112').replace(':mint', 'So11111111111111111111111111111111111111112');
    const payloads: Record<string, unknown> = { 'PUT /v1/mode': { mode: 'SHADOW' }, 'PUT /v1/ai-access': { enabled: false }, 'PUT /v1/risk-profile': { preset: 'CONSERVATIVE' }, 'PUT /v1/settings/profile': { displayName: 'test' }, 'PUT /v1/settings/appearance': { theme: 'DARK' }, 'PUT /v1/settings/notifications': { minAlertPriority: 'WATCH' }, 'PUT /v1/settings/interests': { interests: [] } };
    const call = () => app.inject({ method, url: endpoint + (path === '/v1/search' ? '?q=SOL' : ''), remoteAddress: `192.0.2.${ALWAYS_OPEN_HTTP.indexOf(name) + 1}`, headers: { authorization: 'Bearer test-session' }, ...(method === 'GET' || method === 'DELETE' ? {} : { payload: (payloads[name] ?? {}) as object }) });
    for (const key of keys) await db.systemSetting.upsert({ where: { key }, create: { key, value: false }, update: { value: false } });
    const baseline = await call();
    await db.systemSetting.update({ where: { key: 'entitlements.enforced' }, data: { value: true } });
    const enforced = await call();
    expect(enforced.statusCode).toBe(baseline.statusCode);
    expect(enforced.body).not.toContain('FEATURE_LOCKED');
    expect(enforced.statusCode).not.toBe(500);
    if (method === 'GET' && !path.includes(':') && path !== '/v1/admin/status') expect(enforced.statusCode).toBe(200);
    if (path === '/v1/overview') {
      expect(resolver).toHaveBeenCalled(); expect(enforced.json().me).toEqual(baseline.json().me);
      expect(enforced.json()).toMatchObject({ bar: null, rotation: null, strip: { topNarratives: [], hottestOpportunity: null } });
    } else if (path === '/v1/search') {
      expect(resolver).toHaveBeenCalled(); expect(enforced.json().results).toMatchObject({ tokens: [], narratives: [], wallets: [], creators: [] });
    } else expect(resolver).not.toHaveBeenCalled();
  });
});
