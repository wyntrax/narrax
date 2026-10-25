import { randomBytes, randomUUID } from 'node:crypto';
import bs58 from 'bs58';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createPrisma, Prisma } from '@narra/database';
import { snapshot } from '@narra/market-data';
import { evaluatePersonalWorkspace } from '@narra/worker-pipeline';
import { ResearchMonitorsSchema, PersonalBriefsSchema, type ResearchRules } from '@narra/shared';
import { assertTestDatabase } from '../../../scripts/test-database';
import { storeMarketSnapshot } from '../../../workers/pipeline/src/marketSnapshot';
import { dispatchAlerts } from '../../../workers/pipeline/src/notifications';
import { buildApp } from './app';
import { personalPermissions } from './personalResearch';
import { Worker, QueueEvents } from 'bullmq';
import { createRedis, createPersonalResearchQueue, PERSONAL_RESEARCH_QUEUE, PersonalResearchJobSchema } from '@narra/queue';

assertTestDatabase(new URL(process.env.DATABASE_URL ?? 'invalid:'));
const db = createPrisma(), tag = `personal-${randomUUID()}`, mint = bs58.encode(randomBytes(32));
const start = new Date('2044-10-25T12:00:00Z'); let now = start, user = '', other = '', early = '', tokenId = '', requests = 0;
const users: string[] = [], wallets: string[] = [], clusters: string[] = [], keys: string[] = [], addresses: string[] = [];
const requested: string[] = [];
let app: Awaited<ReturnType<typeof buildApp>>, saved: Awaited<ReturnType<typeof db.systemSetting.findMany>>;
const rules: ResearchRules = { minLiquidityUsd: 200_000, minIndependentBuyers: null, windowMinutes: 30, minNarrativeVelocity: null, maxRiskScore: null };
const input = (extra = {}) => ({ name: 'My conditions', thesis: '', mint, narrativeSlug: null, rules, active: true, ...extra });
const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, payload?: Record<string, unknown>, who = 'owner') => app.inject({ method, url: `/v1/personal-research/${path}`, headers: { authorization: `Bearer ${who}` }, remoteAddress: `192.0.2.${++requests % 200 + 1}`, ...(payload === undefined ? {} : { payload }) });
const evaluate = () => evaluatePersonalWorkspace(db, user, () => personalPermissions(db, user, now), () => now);
async function create(path = 'radars', extra = {}) { const response = await call('POST', path, input(extra)); expect(response.statusCode, response.body).toBe(201); return response.json().id as string; }
async function price(liquidityUsd = 250_000) { await db.$transaction(tx => storeMarketSnapshot(tx, tokenId, snapshot(mint, { priceUsd: 1, liquidityUsd, marketCapUsd: 500_000, marketCapIsFdv: false }), 'dexscreener', now)); }
beforeAll(async () => {
  saved = await db.systemSetting.findMany({ where: { key: 'entitlements.features' } });
  await db.systemSetting.upsert({ where: { key: 'entitlements.features' }, create: { key: 'entitlements.features', value: {} }, update: { value: {} } });
  for (const who of ['owner', 'other', 'early']) {
    const u = await db.user.create({ data: { privyUserId: `${tag}-${who}` } }); users.push(u.id);
    const address = bs58.encode(randomBytes(32)); addresses.push(address);
    await db.linkedWallet.create({ data: { userId: u.id, chain: 'solana', address, verifiedAt: new Date(+start - 86_400_000) } });
    if (who === 'early') { early = u.id; await db.accessGrant.create({ data: { userId: u.id, source: 'EARLY_ACCESS', tier: 'EARLY_ACCESS', status: 'ACTIVE' } }); }
    else {
      if (who === 'owner') user = u.id; else other = u.id;
      await db.wyntraxEntitlement.create({ data: { membershipId: `${tag}-${who}`, chain: 'solana', address, key: 'PRO', seq: 1, validUntil: new Date(+start + 7 * 86_400_000), status: 'ACTIVE', lastEventId: `${tag}-${who}`, receivedAt: start, proSince: start } });
    }
  }
  tokenId = (await db.token.create({ data: { mint, symbol: 'FIXTURE', name: tag } })).id;
  app = await buildApp({ account: { db, now: () => now, verifier: { verify: async who => ({ privyUserId: `${tag}-${who}` }) }, requestPersonalResearch: async userId => { requested.push(userId); } } });
});
beforeEach(async () => {
  now = start;
  await db.researchMonitor.deleteMany({ where: { userId: { in: users } } });
  await db.personalBrief.deleteMany({ where: { userId: { in: users } } });
  await db.alert.deleteMany({ where: { userId: { in: users } } });
  await db.wyntraxEntitlement.updateMany({ where: { membershipId: { startsWith: tag } }, data: { status: 'ACTIVE', validUntil: new Date(+start + 7 * 86_400_000) } });
  await db.systemSetting.update({ where: { key: 'entitlements.features' }, data: { value: {} } });
  await db.token.update({ where: { id: tokenId }, data: { blacklisted: false } });
  await db.tokenMetric.deleteMany({ where: { tokenId } });
  await db.walletTrade.deleteMany({ where: { tokenId } });
  await price();
});
afterAll(async () => {
  await app?.close();
  await db.systemSetting.deleteMany({ where: { key: { in: ['entitlements.features', `research.market.${tokenId}`, ...keys] } } });
  for (const row of saved ?? []) await db.systemSetting.create({ data: { ...row, value: row.value as Prisma.InputJsonValue } });
  const metrics = await db.tokenMetric.findMany({ where: { tokenId }, select: { id: true } });
  await db.systemSetting.deleteMany({ where: { OR: [{ key: { in: metrics.map(m => `research.marketMetric.${m.id}`) } }, { value: { path: ['mint'], equals: mint } }] } });
  await db.walletTrade.deleteMany({ where: { tokenId } });
  await db.token.deleteMany({ where: { id: tokenId } });
  await db.trackedWallet.deleteMany({ where: { id: { in: wallets } } });
  await db.walletCluster.deleteMany({ where: { id: { in: clusters } } });
  await db.wyntraxEntitlement.deleteMany({ where: { membershipId: { startsWith: tag } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
});

it('requires authentication and PRO while existing research is accessible to Early Access', async () => {
  expect((await app.inject('/v1/personal-research/radars')).statusCode).toBe(401);
  for (const path of ['radars', 'theses', 'briefings']) {
    expect((await call('GET', path, undefined, 'early')).statusCode).toBe(403);
    expect((await call('POST', `${path}/refresh`, {}, 'early')).statusCode).toBe(403);
    expect((await call('GET', path)).statusCode).toBe(200);
  }
  for (const path of ['tokens?sort=liquidity', 'smart-money/wallets', 'analytics/backtest-summary']) expect((await app.inject({ url: `/v1/${path}`, headers: { authorization: 'Bearer early' } })).statusCode).toBe(200);
  expect(early).not.toBe(user);
  const refresh = await call('POST', 'radars/refresh', { userId: other });
  expect(refresh.statusCode).toBe(202); expect(refresh.json()).toEqual({ queued: true });
  expect(requested).toEqual([user]);
});
it('validates inputs, bounds definitions, and never accepts caller ownership or another user’s id', async () => {
  expect((await call('POST', 'radars', input({ userId: other }))).statusCode).toBe(400);
  expect((await call('POST', 'theses', input())).statusCode).toBe(400);
  expect((await call('POST', 'radars', input({ narrativeSlug: 'not-indexed' }))).statusCode).toBe(400);
  const id = await create();
  expect((await call('GET', 'radars', undefined, 'other')).json().items).toEqual([]);
  expect((await call('PUT', `radars/${id}`, input(), 'other')).statusCode).toBe(404);
  expect((await call('DELETE', `radars/${id}`, undefined, 'other')).statusCode).toBe(404);
  await db.researchMonitor.createMany({ data: Array.from({ length: 19 }, (_, i) => ({ userId: user, kind: 'RADAR', name: `cap ${i}`, thesis: '', mint, rules, active: false })) });
  expect((await call('POST', 'radars', input())).statusCode).toBe(409);
});
it('serializes concurrent scans, freezes evidence, deduplicates alerts and delivers only to the owner', async () => {
  const id = await create();
  await Promise.all([evaluate(), evaluate()]);
  expect(await db.researchObservation.count({ where: { monitorId: id } })).toBe(1);
  const alerts = await db.alert.findMany({ where: { userId: user } }); expect(alerts).toHaveLength(1);
  await dispatchAlerts(db, now);
  expect(await db.notification.count({ where: { userId: user, alertId: alerts[0]!.id } })).toBe(1);
  expect(await db.notification.count({ where: { userId: other, alertId: alerts[0]!.id } })).toBe(0);
  const response = await call('GET', 'radars'); expect(response.statusCode, response.body).toBe(200);
  const body = response.json(); expect(ResearchMonitorsSchema.safeParse(body).success).toBe(true);
  expect(body.items[0]).not.toHaveProperty('userId');
  expect(body.items[0].observations[0].evaluation.checks[0]).toMatchObject({ value: 250_000, source: 'dexscreener', status: 'PASS' });
  now = new Date(+now + 5 * 60_000); await price(); await evaluate();
  expect(await db.alert.count({ where: { userId: user } })).toBe(1);
  expect(await db.researchObservation.count({ where: { monitorId: id } })).toBe(2);
});
it('tracks supported → weakened → unknown theses with explicit previous states and daily evidence', async () => {
  const id = await create('theses', { thesis: 'Liquidity remains above my minimum.' });
  await evaluate();
  now = new Date(+now + 5 * 60_000); await price(100_000); await evaluate();
  now = new Date(+now + 20 * 60_000); await evaluate();
  const rows = await db.researchObservation.findMany({ where: { monitorId: id }, orderBy: { at: 'asc' } });
  expect(rows.map(r => r.status)).toEqual(['MATCH', 'NO_MATCH', 'UNKNOWN']);
  expect(rows[2]!.evaluation).toMatchObject({ previousStatus: 'NO_MATCH', checks: [{ value: null, status: 'UNKNOWN' }] });
  expect(await db.alert.count({ where: { userId: user, kind: 'THESIS_CHANGED' } })).toBe(2);
  const brief = (await call('GET', 'briefings')).json(); expect(PersonalBriefsSchema.safeParse(brief).success).toBe(true);
  expect(brief.items[0]).toMatchObject({ thesisChanges: 2, unknown: 1 });
  expect(brief.items[0].items[0].name).toBe('My conditions');
  expect((await call('GET', 'briefings', undefined, 'other')).json().items).toEqual([]);
  now = new Date('2044-10-26T00:01:00Z'); await evaluate();
  expect(await db.personalBrief.count({ where: { userId: user } })).toBe(2);
});
it('pause/resume preserves the revision, editing resets conditions, deletion removes owned observations', async () => {
  const id = await create(); await evaluate();
  expect((await call('PUT', `radars/${id}`, input({ active: false }))).statusCode).toBe(200);
  now = new Date(+now + 6 * 60_000); await evaluate();
  expect(await db.researchObservation.count({ where: { monitorId: id } })).toBe(1);
  expect((await db.researchMonitor.findUniqueOrThrow({ where: { id } })).revision).toBe(1);
  expect((await call('PUT', `radars/${id}`, input({ rules: { ...rules, minLiquidityUsd: 1 } }))).statusCode).toBe(200);
  await evaluate(); expect((await db.researchMonitor.findUniqueOrThrow({ where: { id } })).revision).toBe(2);
  expect((await call('DELETE', `radars/${id}`)).statusCode).toBe(200);
  expect(await db.researchObservation.count({ where: { monitorId: id } })).toBe(0);
});
it('expiry stops generation and HTTP access, and mid-scan permission loss rolls the transaction back', async () => {
  const id = await create();
  let count = 0;
  await expect(evaluatePersonalWorkspace(db, user, async () => ({ radar: ++count === 1, thesis: false, briefing: false }), () => now)).rejects.toThrow('PERSONAL_ACCESS_CHANGED');
  expect(await db.researchObservation.count({ where: { monitorId: id } })).toBe(0);
  await db.wyntraxEntitlement.updateMany({ where: { membershipId: `${tag}-owner` }, data: { validUntil: now } });
  await evaluate(); expect(await db.alert.count({ where: { userId: user } })).toBe(0);
  expect((await call('GET', 'radars')).statusCode).toBe(403);
});
it('does not match missing market provenance or blacklisted tokens', async () => {
  const id = await create();
  const metric = await db.tokenMetric.findFirstOrThrow({ where: { tokenId } });
  await db.systemSetting.delete({ where: { key: `research.marketMetric.${metric.id}` } });
  await evaluate(); expect(await db.researchObservation.count({ where: { monitorId: id } })).toBe(0);
  now = new Date(+now + 5 * 60_000); await price();
  await db.token.update({ where: { id: tokenId }, data: { blacklisted: true } });
  await evaluate(); expect(await db.researchObservation.count({ where: { monitorId: id } })).toBe(0);
});
it('counts qualified independent net-buying entities, subtracts sells and does not count a cluster twice', async () => {
  const cluster = await db.walletCluster.create({ data: { label: tag, confidence: 'HIGH' } }); clusters.push(cluster.id);
  const pair = [];
  for (let i = 0; i < 3; i++) {
    const w = await db.trackedWallet.create({ data: { address: bs58.encode(randomBytes(32)), researchReview: 'APPROVED', ...(i < 2 ? { clusterId: cluster.id } : {}) } }); wallets.push(w.id); pair.push(w);
    const sample = { checkedAt: now.toISOString(), closedTrades: 30, closedTokens: 8, observedDays: 10, unmatchedSells: 0, excessSellUnits: 0, score: 80, pnlSol: 1, medianRoi: 0.1, lastTradeAt: now.toISOString() };
    const history = { checkedAt: now.toISOString(), windowDays: 30, capped: false, skipped: 0, coveredFrom: new Date(+now - 30 * 86_400_000).toISOString(), coveredTo: now.toISOString() };
    for (const [key, value] of [[`wallet.research.${w.id}`, sample], [`wallet.history.${w.id}`, history]] as const) { keys.push(key); await db.systemSetting.create({ data: { key, value } }); }
    await db.walletTrade.create({ data: { walletId: w.id, tokenId, side: 'BUY', amountSol: 1, tokenAmount: 10, at: now, signature: `${tag}-${i}-buy` } });
  }
  const id = await create('theses', { thesis: 'Two independent entities are accumulating.', rules: { ...rules, minIndependentBuyers: 2 } });
  await evaluate(); expect((await db.researchObservation.findFirstOrThrow({ where: { monitorId: id } })).status).toBe('MATCH');
  now = new Date(+now + 5 * 60_000);
  await db.walletTrade.create({ data: { walletId: pair[2]!.id, tokenId, side: 'SELL', amountSol: 1, tokenAmount: 10, at: now, signature: `${tag}-sell` } });
  await evaluate();
  const row = await db.researchObservation.findFirstOrThrow({ where: { monitorId: id }, orderBy: { at: 'desc' } });
  expect(row.status).toBe('NO_MATCH'); expect(row.evaluation).toMatchObject({ checks: expect.arrayContaining([expect.objectContaining({ key: 'buyers', value: 1 })]) });
});
it('redacts retained briefing evidence when that source feature is revoked', async () => {
  await create('theses', { thesis: 'My condition.' }); await evaluate();
  await db.systemSetting.update({ where: { key: 'entitlements.features' }, data: { value: { 'research.thesis_tracker': { requiredTier: 'PRO', min_entitlement_age_hours: 100 } } } });
  const response = await call('GET', 'briefings'); expect(response.statusCode).toBe(200);
  expect(response.json().items[0]).toMatchObject({ items: [], thesisChanges: 0, unknown: 0 });
});
it('processes one deduplicated private refresh through real isolated Redis and PostgreSQL', async () => {
  const id = await create(), connection = createRedis();
  const { queue, request } = createPersonalResearchQueue(connection);
  const events = new QueueEvents(PERSONAL_RESEARCH_QUEUE, { connection });
  const worker = new Worker(PERSONAL_RESEARCH_QUEUE, async job => {
    const data = PersonalResearchJobSchema.parse(job.data); expect(data.userId).toBe(user);
    return evaluatePersonalWorkspace(db, data.userId!, () => personalPermissions(db, data.userId!, now), () => now);
  }, { connection, concurrency: 1 });
  try {
    await events.waitUntilReady();
    const [a, b] = await Promise.all([request(user, +now), request(user, +now)]);
    expect(a.id).toBe(b.id);
    await a.waitUntilFinished(events, 20_000);
    expect(await db.researchObservation.count({ where: { monitorId: id } })).toBe(1);
    await a.remove();
  } finally { await worker.close(); await events.close(); await queue.close(); connection.disconnect(); }
});
