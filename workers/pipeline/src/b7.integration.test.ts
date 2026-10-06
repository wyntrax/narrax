import pg from 'pg';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrisma } from '@narra/database';
import { createEventStream, type StreamEvent } from '@narra/realtime';
import { dispatchAlerts } from './notifications';
import { publishNewEvents } from './realtimePublisher';
import { SOL_PRICE_KEY } from './marketData';

const url = process.env.DATABASE_URL ?? 'postgresql://narra:narra@localhost:5432/narra';
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
async function dbUp() {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 800 });
  try { await c.connect(); await c.query('select "dispatchedAt" from "Alert" limit 1'); await c.query('select 1 from "UserSettings" limit 1'); return true; } catch { return false; } finally { await c.end().catch(() => {}); }
}
async function redisUp() {
  const r = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null });
  try { await r.connect(); await r.ping(); return true; } catch { return false; } finally { r.disconnect(); }
}
const up = (await dbUp()) && (await redisUp());

describe.skipIf(!up)('B7 workers: notification dispatch and realtime publishing (needs Postgres and Redis)', () => {
  const db = createPrisma(url);
  const redis = new Redis(redisUrl);
  const tag = `b7w${Date.now()}`;
  const streamKey = `test:events:${tag}`;
  const stream = createEventStream(redis, streamKey);
  const users: Record<string, string> = {};
  const addr = (s: string) => `${s}${tag}`.padEnd(40, '1');
  const createdAlerts: string[] = [];
  let solBackup: { value: unknown } | null = null;

  const alert = async (kind: string, priority: 'INFO' | 'WATCH' | 'IMPORTANT' | 'CRITICAL', extra: { userId?: string; nested?: boolean; createdAt?: Date } = {}) => {
    const a = await db.alert.create({
      data: {
        kind: `${kind}_${tag}`.toUpperCase().replace(/[^A-Z0-9_]/g, '_'), priority, title: `${kind} title`, body: 'body', userId: extra.userId ?? null,
        ...(extra.createdAt ? { createdAt: extra.createdAt } : {}),
        ...(extra.nested && extra.userId ? { notifications: { create: { userId: extra.userId } } } : {}),
      },
    });
    createdAlerts.push(a.id);
    return a;
  };
  const notifFor = async (userId: string, alertId: string) => db.notification.count({ where: { userId, alertId } });

  beforeAll(async () => {
    for (const k of ['plain', 'info', 'muted', 'important', 'owner']) users[k] = (await db.user.create({ data: { privyUserId: `did:privy:${tag}-${k}` } })).id;
    await db.userSettings.create({ data: { userId: users.info!, minAlertPriority: 'INFO' } });
    await db.userSettings.create({ data: { userId: users.important!, minAlertPriority: 'IMPORTANT' } });
    solBackup = await db.systemSetting.findUnique({ where: { key: SOL_PRICE_KEY } });
  });

  afterAll(async () => {
    await db.notification.deleteMany({ where: { OR: [{ alertId: { in: createdAlerts } }, { userId: { in: Object.values(users) } }] } });
    await db.alert.deleteMany({ where: { id: { in: createdAlerts } } });
    await db.trade.deleteMany({ where: { userId: { in: Object.values(users) } } });
    await db.order.deleteMany({ where: { userId: { in: Object.values(users) } } });
    await db.position.deleteMany({ where: { userId: { in: Object.values(users) } } });
    await db.user.deleteMany({ where: { id: { in: Object.values(users) } } });
    await db.consensusSignal.deleteMany({ where: { token: { mint: { endsWith: tag.padEnd(0) } } } });
    await db.narrative.deleteMany({ where: { slug: { endsWith: tag } } });
    await db.token.deleteMany({ where: { symbol: { endsWith: tag.slice(-6) } } });
    if (solBackup) await db.systemSetting.update({ where: { key: SOL_PRICE_KEY }, data: { value: solBackup.value as object } }); else await db.systemSetting.deleteMany({ where: { key: SOL_PRICE_KEY } });
    await redis.del(streamKey, ...(await redis.keys(`${streamKey}:*`)));
    redis.disconnect();
    await db.$disconnect();
  });

  describe('dispatchAlerts', () => {
    it('applies each user\'s preferences to global alerts, and never holds back a CRITICAL one', async () => {
      const info = await alert('info', 'INFO'); const watch = await alert('watch', 'WATCH'); const important = await alert('imp', 'IMPORTANT'); const critical = await alert('crit', 'CRITICAL');
      await db.userSettings.upsert({ where: { userId: users.muted! }, create: { userId: users.muted!, minAlertPriority: 'INFO', mutedAlertKinds: [critical.kind, important.kind] }, update: { minAlertPriority: 'INFO', mutedAlertKinds: [critical.kind, important.kind] } });

      const summary = await dispatchAlerts(db, new Date());
      expect(summary.alerts).toBeGreaterThanOrEqual(4);

      const got = async (u: string) => Promise.all([info, watch, important, critical].map((a) => notifFor(users[u]!, a.id)));
      expect(await got('plain')).toEqual([0, 1, 1, 1]);      // default threshold WATCH
      expect(await got('info')).toEqual([1, 1, 1, 1]);       // lowered to INFO
      expect(await got('important')).toEqual([0, 0, 1, 1]);  // raised to IMPORTANT
      expect(await got('muted')).toEqual([1, 1, 0, 1]);      // IMPORTANT kind muted, the CRITICAL one is still delivered even though its kind is muted too
      const rows = await db.alert.findMany({ where: { id: { in: createdAlerts } }, select: { dispatchedAt: true } });
      expect(rows.every((r) => r.dispatchedAt)).toBe(true);
    });

    it('gives an alert that belongs to a user exactly one notification for that user, whether or not the writer made it, and none for anyone else', async () => {
      const bare = await alert('own_bare', 'INFO', { userId: users.owner! });                 // no nested notification
      const nested = await alert('own_nested', 'INFO', { userId: users.owner!, nested: true }); // writer already made it
      await dispatchAlerts(db, new Date());
      expect(await notifFor(users.owner!, bare.id)).toBe(1);   // delivered although INFO is below the default threshold: owned alerts ignore preferences
      expect(await notifFor(users.owner!, nested.id)).toBe(1);
      expect(await notifFor(users.plain!, bare.id)).toBe(0);
    });

    it('is idempotent, and two dispatchers running at once never double-notify', async () => {
      const a = await alert('race', 'IMPORTANT');
      const [r1, r2] = await Promise.all([dispatchAlerts(db, new Date()), dispatchAlerts(db, new Date())]);
      expect(r1.alerts + r2.alerts).toBeGreaterThanOrEqual(1);
      for (const u of ['plain', 'info', 'important', 'muted']) expect(await notifFor(users[u]!, a.id)).toBe(1);
      const again = await dispatchAlerts(db, new Date());
      expect(again.notifications).toBe(0);
    });
  });

  describe('publishNewEvents', () => {
    const T0 = new Date();
    const at = (ms: number) => new Date(T0.getTime() + ms);
    const all = async (): Promise<StreamEvent[]> => stream.readRange('0-0', 5000);
    const mine = (events: StreamEvent[], pred: (e: StreamEvent) => boolean) => events.filter(pred);

    it('does not replay history on its first run, then publishes new rows once, scoped correctly', async () => {
      // history that exists before the publisher first runs
      const oldAlert = await alert('hist', 'IMPORTANT', { createdAt: at(-60_000) });
      await publishNewEvents(db, redis, { now: T0, streamKey });
      expect(mine(await all(), (e) => (e.data as { id?: string }).id === oldAlert.id)).toHaveLength(0);

      const nar = await db.narrative.create({ data: { name: `Nar ${tag}`, slug: `nar-${tag}`, stage: 'ACCELERATING', score: 70 } });
      await db.narrativeMetric.create({ data: { narrativeId: nar.id, score: 71, velocity: 5, acceleration: 1, organicScore: 80, manipulationRisk: 10, mentionVelocity: 1, creatorVelocity: 1, engagementVelocity: 1, at: at(5_000) } });
      const token = await db.token.create({ data: { mint: addr('T'), symbol: `T${tag.slice(-6)}`, name: 'Test token' } });
      await db.consensusSignal.create({ data: { tokenId: token.id, score: 80, walletCount: 3, independentEntities: 3, leaderCount: 1, netFlowSol: 4, at: at(6_000) } });
      const globalAlert = await alert('live_global', 'IMPORTANT', { createdAt: at(7_000) });
      const ownedAlert = await alert('live_owned', 'CRITICAL', { userId: users.owner!, nested: true, createdAt: at(7_500) });
      const notif = await db.notification.findFirstOrThrow({ where: { userId: users.owner!, alertId: ownedAlert.id } });
      await db.notification.update({ where: { id: notif.id }, data: { createdAt: at(8_000) } });

      const first = await publishNewEvents(db, redis, { now: at(10_000), streamKey });
      expect(first.errors).toEqual([]);
      const events = await all();

      const narrativeEvt = mine(events, (e) => e.type === 'narrative.updated' && (e.data as { slug: string }).slug === nar.slug);
      expect(narrativeEvt).toHaveLength(1);
      expect(narrativeEvt[0]).toMatchObject({ channel: 'narratives', scope: 'global', userId: null });

      expect(mine(events, (e) => e.type === 'consensus.updated' && (e.data as { mint: string }).mint === token.mint)).toHaveLength(1);

      const globalEvt = mine(events, (e) => e.type === 'alert.created' && (e.data as { id: string }).id === globalAlert.id);
      expect(globalEvt).toHaveLength(1);
      expect(globalEvt[0]).toMatchObject({ channel: 'alerts', scope: 'global', userId: null });

      // An owned alert is never broadcast. Its owner gets it as a private notification event.
      expect(mine(events, (e) => e.type === 'alert.created' && (e.data as { id: string }).id === ownedAlert.id)).toHaveLength(0);
      const notifEvt = mine(events, (e) => e.type === 'notification.created' && (e.data as { alertId: string }).alertId === ownedAlert.id);
      expect(notifEvt).toHaveLength(1);
      expect(notifEvt[0]).toMatchObject({ channel: 'me', scope: 'user', userId: users.owner });
      expect(notifEvt[0]!.data).toMatchObject({ kind: ownedAlert.kind, priority: 'CRITICAL' });

      // Running again publishes nothing new for those rows.
      const second = await publishNewEvents(db, redis, { now: at(12_000), streamKey });
      expect(second.published).toBe(0);
      expect((await all()).length).toBe(events.length);
    });

    it('publishes a row that became visible late with an older timestamp, once, thanks to the overlap window', async () => {
      const late = await alert('late', 'WATCH', { createdAt: at(9_000) }); // older than rows already published, committed only now
      const r = await publishNewEvents(db, redis, { now: at(20_000), streamKey });
      expect(r.errors).toEqual([]);
      expect(mine(await all(), (e) => e.type === 'alert.created' && (e.data as { id: string }).id === late.id)).toHaveLength(1);
      await publishNewEvents(db, redis, { now: at(22_000), streamKey });
      expect(mine(await all(), (e) => e.type === 'alert.created' && (e.data as { id: string }).id === late.id)).toHaveLength(1);
    });

    it('routes a position evaluation and a trade to their owner only', async () => {
      const token = await db.token.create({ data: { mint: addr('P'), symbol: `P${tag.slice(-6)}`, name: 'Pos token' } });
      const pos = await db.position.create({ data: { userId: users.owner!, tokenId: token.id, mode: 'PAPER', entryPriceUsd: 1, sizeSol: 0.2, entryContext: {}, simulated: true, openKey: `${users.owner}:${token.id}`, openedAt: at(23_000) } });
      const ev = await db.positionEvaluation.create({ data: { positionId: pos.id, action: 'REDUCE', fractionPct: 50, signals: [], unavailable: [], blind: false, pnlPct: 120, createdAt: at(24_000) } });
      const order = await db.order.create({ data: { userId: users.owner!, tokenId: token.id, idempotencyKey: `k-${tag}`, side: 'SELL', mode: 'AI_PAPER', status: 'CONFIRMED', sizeSol: 0.1, simulated: true, createdAt: at(24_000) } });
      const trade = await db.trade.create({ data: { userId: users.owner!, orderId: order.id, positionId: pos.id, side: 'SELL', mode: 'AI_PAPER', reason: 'TP', expectedPriceUsd: 2, actualPriceUsd: 2, slippageBps: 5, realizedPnlSol: 0.1, simulated: true, amountSol: 0.2, signature: `sig-${tag}`, executedAt: at(25_000) } });

      await publishNewEvents(db, redis, { now: at(30_000), streamKey });
      const events = await all();
      const evEvt = mine(events, (e) => e.type === 'position.evaluated' && (e.data as { evaluationId: string }).evaluationId === ev.id);
      expect(evEvt).toHaveLength(1);
      expect(evEvt[0]).toMatchObject({ scope: 'user', userId: users.owner, channel: 'me' });
      expect(evEvt[0]!.data).toMatchObject({ action: 'REDUCE', fractionPct: 50, pnlPct: 120, blind: false });
      const tEvt = mine(events, (e) => e.type === 'trade.created' && (e.data as { id: string }).id === trade.id);
      expect(tEvt).toHaveLength(1);
      expect(tEvt[0]).toMatchObject({ scope: 'user', userId: users.owner });
      expect(tEvt[0]!.data).toMatchObject({ simulated: true, mint: token.mint, realizedPnlSol: 0.1 });
      // Nothing of the owner's reaches another user. (The other user does have their own notification events.)
      expect(mine(events, (e) => e.userId === users.plain && e.type !== 'notification.created')).toHaveLength(0);
    });

    it('does not let a row dated far in the future stall the feed, and does not publish that row', async () => {
      const future = await alert('future', 'IMPORTANT', { createdAt: new Date(T0.getTime() + 3 * 86_400_000) });
      const r = await publishNewEvents(db, redis, { now: at(32_000), streamKey });
      expect(r.skippedFuture).toBeGreaterThanOrEqual(1);
      const normal = await alert('after_future', 'IMPORTANT', { createdAt: at(33_000) });
      await publishNewEvents(db, redis, { now: at(34_000), streamKey });
      const events = await all();
      expect(mine(events, (e) => e.type === 'alert.created' && (e.data as { id: string }).id === normal.id)).toHaveLength(1);
      expect(mine(events, (e) => e.type === 'alert.created' && (e.data as { id: string }).id === future.id)).toHaveLength(0);
    });

    it('publishes a new SOL price once per reading and ignores a stale one', async () => {
      const t = at(40_000);
      await db.systemSetting.upsert({ where: { key: SOL_PRICE_KEY }, create: { key: SOL_PRICE_KEY, value: { priceUsd: 171.5, at: t.toISOString(), source: 'test' } }, update: { value: { priceUsd: 171.5, at: t.toISOString(), source: 'test' } } });
      await publishNewEvents(db, redis, { now: at(41_000), streamKey });
      await publishNewEvents(db, redis, { now: at(43_000), streamKey });
      expect(mine(await all(), (e) => e.type === 'market.sol' && (e.data as { priceUsd: number }).priceUsd === 171.5)).toHaveLength(1);
      // A reading far older than the catch-up limit is not republished
      const old = new Date(T0.getTime() - 3_600_000).toISOString();
      await db.systemSetting.update({ where: { key: SOL_PRICE_KEY }, data: { value: { priceUsd: 99.9, at: old, source: 'test' } } });
      await publishNewEvents(db, redis, { now: at(45_000), streamKey });
      expect(mine(await all(), (e) => e.type === 'market.sol' && (e.data as { priceUsd: number }).priceUsd === 99.9)).toHaveLength(0);
    });
  });
});
