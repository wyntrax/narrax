import { randomBytes, randomUUID } from 'node:crypto';
import bs58 from 'bs58';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPrisma, Prisma } from '@narra/database';
import { INVESTIGATION_LIMITS, InvestigationResponse, TOKEN_DISCOVERY_KEY_PREFIX } from '@narra/shared';
import { assertTestDatabase } from '../../../scripts/test-database';
import { buildApp } from './app';
import { applyWyntraxEvent } from './entitlements/membershipStore';

const target = new URL(process.env.DATABASE_URL ?? 'invalid:');
assertTestDatabase(target);
const db = createPrisma(target.toString()), tag = `investigation-${randomUUID()}`;
const now = new Date('2026-10-26T12:00:00Z'), eventAt = new Date(+now - 2 * 3_600_000);
const address = () => bs58.encode(randomBytes(32));
const settingsKeys = ['entitlements.features'];
let saved: Awaited<ReturnType<typeof db.systemSetting.findMany>>, app: Awaited<ReturnType<typeof buildApp>>;
let mint: string, tokenId: string, clusterId: string;
const users: string[] = [], walletIds: string[] = [], tokenIds: string[] = [], localKeys: string[] = [], memberships: string[] = [];
let requestNo = 0; const discoveryRequests: string[] = [];
const get = (suffix = '', who = 'pro', targetMint = mint) => app.inject({ method: 'GET', url: `/v1/smart-money/investigations/${targetMint}${suffix}`, headers: { authorization: `Bearer ${who}` }, remoteAddress: `192.0.2.${++requestNo % 200 + 1}` });
const post = (who = 'pro', targetMint = mint, remoteAddress = `192.0.2.${++requestNo % 200 + 1}`) => app.inject({ method: 'POST', url: `/v1/smart-money/investigations/${targetMint}/discover`, headers: { authorization: `Bearer ${who}` }, remoteAddress });
const setting = async (key: string, value: Prisma.InputJsonValue) => { await db.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } }); };
const newToken = async (blacklisted = false) => { const t = await db.token.create({ data: { mint: address(), name: tag, symbol: 'TEST', blacklisted } }); tokenIds.push(t.id); return t; };
beforeAll(async () => {
  saved = await db.systemSetting.findMany({ where: { key: { in: settingsKeys } } });
  for (const who of ['admin', 'none', 'early', 'member', 'pro']) {
    const u = await db.user.create({ data: { privyUserId: `${tag}-${who}`, isAdmin: who === 'admin' } }); users.push(u.id);
    if (['early', 'member', 'pro'].includes(who)) {
      const wallet = address(); await db.linkedWallet.create({ data: { userId: u.id, chain: 'solana', address: wallet, verifiedAt: now } });
      if (who === 'early') await db.accessGrant.create({ data: { userId: u.id, source: 'EARLY_ACCESS', tier: 'EARLY_ACCESS', status: 'ACTIVE' } });
      else {
        const id = `${tag}-${who}`; memberships.push(id);
        await applyWyntraxEvent(db, { id, type: 'membership.granted', occurredAt: now.toISOString(), data: { membershipId: id, seq: 1, key: who === 'pro' ? 'PRO' : 'MEMBER', validUntil: new Date(+now + 86_400_000).toISOString(), chain: 'solana', wallet, checkedAt: now.toISOString() } }, 'fixture', now);
      }
    }
  }
  const token = await newToken(); mint = token.mint; tokenId = token.id;
  clusterId = (await db.walletCluster.create({ data: { label: 'funding', confidence: 'MEDIUM' } })).id;
  for (let i = 0; i < 4; i++) walletIds.push((await db.trackedWallet.create({ data: { address: address(), active: i !== 3, researchReview: 'APPROVED', clusterId: i < 2 ? clusterId : null } })).id);
  const sample = { checkedAt: now.toISOString(), closedTrades: 30, closedTokens: 8, observedDays: 14, unmatchedSells: 0, excessSellUnits: 0, score: 80, pnlSol: 10, medianRoi: 0.2, lastTradeAt: eventAt.toISOString() };
  const history = { checkedAt: now.toISOString(), coveredFrom: new Date(+now - 30 * 86_400_000).toISOString(), coveredTo: now.toISOString(), capped: false, skipped: 0, windowDays: 30 };
  for (const id of walletIds.slice(0, 2)) for (const [prefix, value] of [['research', sample], ['history', history]] as const) { const key = `wallet.${prefix}.${id}`; localKeys.push(key); await setting(key, value); }
  const data = [
    { walletId: walletIds[0]!, side: 'BUY' as const, amountSol: '1', tokenAmount: '100' },
    { walletId: walletIds[0]!, side: 'SELL' as const, amountSol: '3', tokenAmount: '50' },
    { walletId: walletIds[1]!, side: 'BUY' as const, amountSol: '2', tokenAmount: '25' },
    { walletId: walletIds[2]!, side: 'SELL' as const, amountSol: '2', tokenAmount: null },
    { walletId: walletIds[3]!, side: 'BUY' as const, amountSol: '1000', tokenAmount: '9999' },
  ];
  await db.walletTrade.createMany({ data: data.map(t => ({ ...t, tokenId, at: eventAt, signature: randomUUID(), evidence: { version: 1, eventAt: eventAt.toISOString(), market: null, sol: null, reasons: ['NO_CONTEMPORANEOUS_MARKET', 'NO_CONTEMPORANEOUS_SOL'] } })) });
  await db.walletTrade.createMany({ data: [new Date(+now + 1), new Date(+now - 2 * 86_400_000)].map(at => ({ tokenId, walletId: walletIds[0]!, side: 'BUY', amountSol: '100', tokenAmount: '100', at, signature: randomUUID() })) });
  await db.walletRelationship.create({ data: { fromId: walletIds[0]!, toId: walletIds[1]!, kind: 'FUNDING', confidence: 'MEDIUM', evidence: { type: 'shared', funder: address() } } });
  await db.walletRelationship.create({ data: { fromId: walletIds[0]!, toId: walletIds[3]!, kind: 'FUNDING', confidence: 'HIGH' } });
  app = await buildApp({ account: { db, now: () => now, verifier: { verify: async token => ({ privyUserId: `${tag}-${token}` }) }, requestTokenDiscovery: async target => { discoveryRequests.push(target); } } });
}, 30000);
beforeEach(async () => { await setting('entitlements.features', {}); });
afterAll(async () => {
  await app?.close();
  await db.systemSetting.deleteMany({ where: { key: { in: [...settingsKeys, ...localKeys] } } });
  for (const row of saved ?? []) await db.systemSetting.create({ data: { ...row, value: row.value === null ? Prisma.JsonNull : row.value as Prisma.InputJsonValue } });
  await db.trackedWallet.deleteMany({ where: { id: { in: walletIds } } });
  if (clusterId) await db.walletCluster.delete({ where: { id: clusterId } });
  await db.token.deleteMany({ where: { id: { in: tokenIds } } });
  await db.auditLog.deleteMany({ where: { OR: [{ userId: { in: users } }, ...memberships.map(id => ({ detail: { path: ['membershipId'], equals: id } }))] } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.wyntraxEntitlement.deleteMany({ where: { membershipId: { in: memberships } } });
  await db.webhookEvent.deleteMany({ where: { membershipId: { in: memberships } } });
  await db.$disconnect();
}, 30000);

describe('token investigation on isolated PostgreSQL', () => {
  it('requires PRO for investigation reads, with admin bypass', async () => {
    expect((await app.inject(`/v1/smart-money/investigations/${mint}`)).statusCode).toBe(401);
    for (const who of ['none', 'early', 'member']) {
      const denied=await get('', who); expect(denied.statusCode).toBe(403); expect(denied.json()).toMatchObject({ error: 'FEATURE_LOCKED', requiredTier: 'PRO' });
    }
    for (const who of ['pro', 'admin']) expect((await get('', who)).statusCode).toBe(200);
  });
  it('queues a bounded token discovery scan only for authorised users and indexed tokens', async () => {
    expect((await post('none')).statusCode).toBe(403);
    expect((await post('early')).statusCode).toBe(403);
    expect((await post('member')).statusCode).toBe(403);
    expect(discoveryRequests).toHaveLength(0);
    expect((await post('pro', 'not-a-mint')).statusCode).toBe(400);
    expect((await post('pro', address())).statusCode).toBe(404);
    const blacklisted = await newToken(true); expect((await post('pro', blacklisted.mint)).statusCode).toBe(404);
    expect((await post('pro')).statusCode).toBe(202);
    expect(discoveryRequests.at(-1)).toBe(mint);
    expect((await post('admin')).statusCode).toBe(202);
    const remote = '192.0.2.250';
    for (let i = 0; i < 3; i++) expect((await post('pro', mint, remote)).statusCode).toBe(202);
    expect((await post('pro', mint, remote)).statusCode).toBe(429);
  });
  it('shows a well-formed token discovery record and omits malformed or future records', async () => {
    const key = `${TOKEN_DISCOVERY_KEY_PREFIX}${tokenId}`;
    localKeys.push(key);
    const record = { version: 1, requestedAt: now.toISOString(), startedAt: now.toISOString(), status: 'COMPLETE', checkedAt: now.toISOString(), pagesRead: 3, transactionsRead: 300, swapsRead: 120, participantsSeen: 40, candidates: 12, newWallets: 4, backfilledWallets: 4, createdTrades: 18, capped: false, error: null };
    await setting(key, record);
    const body = InvestigationResponse.parse((await get()).json());
    expect(body.discovery).toMatchObject({ status: 'COMPLETE', newWallets: 4, backfilledWallets: 4, createdTrades: 18, capped: false });
    expect(body.discovery).not.toHaveProperty('requestedAt');
    await setting(key, { ...record, status: 'UNKNOWN' });
    expect((await get()).json().discovery).toBeUndefined();
    await setting(key, { ...record, checkedAt: new Date(+now + 10 * 60_000).toISOString() });
    expect((await get()).json().discovery).toBeUndefined();
    await db.systemSetting.delete({ where: { key } });
  });
  it('honors independent admin-configured Early Access and keeps admin bypass under age restrictions', async () => {
    const r = await app.inject({ method: 'PUT', url: '/v1/admin/entitlements/settings', headers: { authorization: 'Bearer admin' }, payload: { settings: { 'entitlements.features': { 'research.smart_money_investigation': { requiredTier: 'EARLY_ACCESS' } } }, reason: 'Investigation access test' } });
    expect(r.statusCode).toBe(200); expect((await get('', 'early')).statusCode).toBe(200); expect((await get('', 'none')).statusCode).toBe(403);
    await setting('entitlements.features', { 'research.smart_money_investigation': { requiredTier: 'PRO', min_entitlement_age_hours: 72 } });
    expect((await get('', 'early')).statusCode).toBe(403); expect((await post('early')).statusCode).toBe(403);
    expect((await get('', 'pro')).statusCode).toBe(403); expect((await get('', 'admin')).statusCode).toBe(200);
  });
  it('returns typed observed totals, current qualification, group confidence and transaction provenance', async () => {
    const r = await get(); expect(r.statusCode).toBe(200);
    const body = InvestigationResponse.parse(r.json());
    expect(body.coverage).toMatchObject({ participantCount: 3, groupCount: 2, currentlyQualifiedCount: 2, historyCoveredCount: 2, tradesRead: 4, tradesTruncated: false });
    expect(body.totals).toMatchObject({ buySol: '3', sellSol: '5', netSolSpent: '-2', observedTokenUnitDelta: null, unknownQuantityCount: 1 });
    expect(body.groups.find(g => g.id === `cluster:${clusterId}`)).toMatchObject({ basis: 'FUNDING', confidence: 'MEDIUM', participantIds: expect.arrayContaining(walletIds.slice(0, 2)), totals: { netSolSpent: '0', observedTokenUnitDelta: '75' } });
    expect(body.participants.find(p => p.id === walletIds[2])).toMatchObject({ history: { status: 'UNKNOWN' }, currentQualification: { eligible: false } });
    expect(body.trades).toHaveLength(4); expect(body.relationships).toHaveLength(1);
    expect(body.trades[0]!.evidence).toMatchObject({ eventAt: eventAt.toISOString() });
    expect(body.trades.every(t => t.walletId !== walletIds[3])).toBe(true);
  });
  it('paginates tied timestamps without duplicates and retains whole-sample totals', async () => {
    const first = InvestigationResponse.parse((await get('?limit=2')).json());
    const second = InvestigationResponse.parse((await get(`?limit=2&asOf=${first.asOf}&cursor=${first.nextCursor}`)).json());
    expect(new Set([...first.trades, ...second.trades].map(t => t.id)).size).toBe(4);
    expect(second.totals).toEqual(first.totals); expect(second.nextCursor).toBeNull();
    for (const query of [`?cursor=${first.nextCursor}`, `?asOf=${first.asOf}&cursor=bad`, `?window=7d&asOf=${first.asOf}&cursor=${first.nextCursor}`, '?limit=101', '?asOf=2027-01-01T00:00:00Z']) expect((await get(query)).statusCode).toBe(400);
    const other = await newToken(); expect((await get(`?asOf=${first.asOf}&cursor=${first.nextCursor}`, 'pro', other.mint)).statusCode).toBe(400);
    const absent = Buffer.from(JSON.stringify({ version: 1, mint, window: '24h', asOf: first.asOf, id: 'removed' })).toString('base64url');
    const invalid = await get(`?asOf=${first.asOf}&cursor=${absent}`);
    expect(invalid.statusCode).toBe(400); expect(invalid.json()).toMatchObject({ error: 'INVALID_CURSOR', restartRequired: true });
  });
  it('uses current qualification explicitly even for an earlier event window', async () => {
    const body = InvestigationResponse.parse((await get(`?asOf=${new Date(+now - 3_600_000).toISOString()}`)).json());
    expect(body.coverage.currentlyQualifiedCount).toBe(2);
    expect(body.contextMode).toBe('CURRENT'); expect(body.readAt).toBe(now.toISOString());
    expect(body.coverage.limitations).toContain('CURRENT_CONTEXT_NOT_HISTORICAL');
    expect(InvestigationResponse.parse((await get('?window=7d')).json()).totals.tradeCount).toBe(5);
  });
  it('distinguishes an empty observed window from missing or blacklisted tokens', async () => {
    const empty = await newToken(), blacklisted = await newToken(true);
    const body = InvestigationResponse.parse((await get('', 'pro', empty.mint)).json());
    expect(body.coverage.activity).toBe('NO_OBSERVED_TRADES'); expect(body.coverage.limitations).toContain('HISTORY_COVERAGE_NOT_ESTABLISHED');
    expect(body.totals.observedTokenUnitDelta).toBeNull();
    expect(body.availability).toMatchObject({ lastRecordedTradeAt: null, hasTradesIn7d: false });
    expect((await get('', 'pro', blacklisted.mint)).statusCode).toBe(404);
    expect((await get('', 'pro', address())).statusCode).toBe(404);
    expect((await get('', 'pro', 'not-a-mint')).statusCode).toBe(400);
  });
  it('explains out-of-window activity without using future or inactive-wallet trades', async () => {
    const token = await newToken(), old = new Date(+now - 3 * 86400000);
    await db.walletTrade.createMany({ data: [
      { at: old, walletId: walletIds[0]! },
      { at: new Date(+now + 1), walletId: walletIds[0]! },
      { at: new Date(+now - 1), walletId: walletIds[3]! },
    ].map(t => ({ ...t, tokenId: token.id, side: 'BUY' as const, amountSol: '1', tokenAmount: '10', signature: randomUUID() })) });
    const body = InvestigationResponse.parse((await get('', 'pro', token.mint)).json());
    expect(body.coverage.activity).toBe('NO_OBSERVED_TRADES');
    expect(body.availability).toEqual({ activeTrackedWallets: await db.trackedWallet.count({ where: { active: true } }), lastRecordedTradeAt: old.toISOString(), hasTradesIn7d: true });
    expect(InvestigationResponse.parse((await get('?window=7d', 'pro', token.mint)).json()).trades).toHaveLength(1);
    const earlier = InvestigationResponse.parse((await get(`?asOf=${new Date(+now - 4 * 86400000).toISOString()}`, 'pro', token.mint)).json());
    expect(earlier.availability).toMatchObject({ lastRecordedTradeAt: null, hasTradesIn7d: false });
  });
  it('labels capped aggregates as the latest sample and never silently returns population-wide totals', async () => {
    const token = await newToken();
    await db.walletTrade.createMany({ data: Array.from({ length: INVESTIGATION_LIMITS.trades + 1 }, () => ({ tokenId: token.id, walletId: walletIds[0]!, side: 'BUY' as const, amountSol: '0.01', tokenAmount: '1', signature: randomUUID(), at: eventAt })) });
    const body = InvestigationResponse.parse((await get('', 'pro', token.mint)).json());
    expect(body.coverage).toMatchObject({ aggregationScope: 'LATEST_CAPPED_SAMPLE', tradesTruncated: true, tradesRead: INVESTIGATION_LIMITS.trades });
    expect(body.coverage.limitations).toContain('TRADE_QUERY_CAPPED');
    expect(body.totals.netSolSpent).toBe('10'); expect(body.trades).toHaveLength(50);
    await setting('entitlements.features', { 'research.smart_money_investigation': { requiredTier: 'EARLY_ACCESS' } });
    expect(InvestigationResponse.parse((await get('', 'early', token.mint)).json()).trades).toHaveLength(20);
    expect(InvestigationResponse.parse((await get('?limit=100', 'pro', token.mint)).json()).trades).toHaveLength(70);
  });
  it('bounds relationship evidence and reports that cap separately from trade coverage', async () => {
    const token = await newToken(), ids: string[] = [];
    for (let i = 0; i < 17; i++) {
      const w = await db.trackedWallet.create({ data: { address: address() } }); ids.push(w.id); walletIds.push(w.id);
    }
    await db.walletTrade.createMany({ data: ids.map(walletId => ({ tokenId: token.id, walletId, side: 'BUY' as const, amountSol: '1', tokenAmount: '1', at: eventAt, signature: randomUUID() })) });
    await db.walletRelationship.createMany({ data: ids.flatMap(fromId => ids.filter(toId => toId !== fromId).map(toId => ({ fromId, toId, kind: 'TIMING', confidence: 'LOW' as const }))) });
    const body = InvestigationResponse.parse((await get('', 'pro', token.mint)).json());
    expect(body.coverage).toMatchObject({ tradesTruncated: false, relationshipsTruncated: true });
    expect(body.relationships).toHaveLength(INVESTIGATION_LIMITS.relationships);
    expect(body.coverage.limitations).toContain('RELATIONSHIP_QUERY_CAPPED');
  });
  it('derives wallet patterns from the full bounded sample, independently of the transaction page', async () => {
    const token = await newToken();
    await db.walletTrade.createMany({ data: [0, 2, 5, 8].map((minute, i) => ({ tokenId: token.id, walletId: walletIds[2]!, side: i === 3 ? 'SELL' : 'BUY', amountSol: '1', tokenAmount: i === 2 ? null : '10', signature: randomUUID(), at: new Date(+eventAt + minute * 60000) })) });
    const first = InvestigationResponse.parse((await get('?limit=1', 'pro', token.mint)).json());
    expect(first.trades).toHaveLength(1);
    expect(first.strategies).toMatchObject({ observedTrades: 4, evaluatedWallets: 1, candidateCount: 1, items: [{ walletId: walletIds[2], kind: 'REPEATED_BUYING', supportingCount: 3, opposingCount: 1, historyStatus: 'UNKNOWN' }] });
    expect(first.strategies!.items[0]!.examples).toHaveLength(3);
    const next = InvestigationResponse.parse((await get(`?limit=1&asOf=${first.asOf}&cursor=${first.nextCursor}`, 'pro', token.mint)).json());
    expect(next.strategies).toEqual(first.strategies);
  });
  it('keeps frozen publication identity independent of current wallet qualification and bounds token/time context', async () => {
    const token = await newToken(), other = await newToken(), historicWallet = address();
    const publicationAt = new Date(+now - 2 * 3600000), dueAt = new Date(+publicationAt + 3600000);
    const evidence = { version: 1, market: { metricId: 'historical-entry', source: 'dexscreener', pairAddress: 'historical-pair', priceUsd: 2, at: publicationAt.toISOString() }, wallets: [{ address: historicWallet, clusterId: 'old-cluster', qualification: { status: 'QUALIFIED', eligible: true, reasons: [], rulesVersion: 1 } }], trades: [{ id: 'historic-trade', wallet: historicWallet, signature: randomUUID(), side: 'SELL', amountSol: 1, at: publicationAt.toISOString() }] };
    const data = { tokenId: token.id, dedupeKey: randomUUID(), side: 'SELL' as const, walletCount: 1, independentEntities: 1, netFlowSol: '-1', entryPriceUsd: '2', entryMetricId: 'historical-entry', entryAt: publicationAt, createdAt: publicationAt, evidence };
    await db.walletResearchSignal.create({ data: { ...data, measurements: { create: [{ horizonHours: 1, dueAt, status: 'MEASURED', priceUsd: '3', priceAt: dueAt, metricId: 'horizon', returnPct: 50, measuredAt: now }, { horizonHours: 4, dueAt: new Date(+publicationAt + 4 * 3600000) }] } } });
    for (const patch of [{ tokenId: other.id }, { createdAt: new Date(+now + 1) }, { createdAt: new Date(+now - 8 * 86400000) }]) await db.walletResearchSignal.create({ data: { ...data, ...patch, dedupeKey: randomUUID() } });
    const body = InvestigationResponse.parse((await get('', 'pro', token.mint)).json());
    expect(body.coverage.activity).toBe('NO_OBSERVED_TRADES');
    expect(body.publications!.items).toHaveLength(1);
    expect(body.publications!.items[0]!.frozenEvidence.wallets[0]).toMatchObject({ address: historicWallet, clusterId: 'old-cluster', qualification: { status: 'QUALIFIED' } });
    expect(body.publications!.items[0]!.outcomes).toMatchObject([{ status: 'MEASURED', returnPct: 50 }, { status: 'PENDING', returnPct: null }]);
    expect(body.publications!.outcomesReadAt).toBe(now.toISOString());
    for (let i = 0; i < 11; i++) await db.walletResearchSignal.create({ data: { ...data, dedupeKey: randomUUID() } });
    const capped = InvestigationResponse.parse((await get('', 'pro', token.mint)).json());
    expect(capped.publications!.items).toHaveLength(10); expect(capped.publications!.truncated).toBe(true);
  });
});
