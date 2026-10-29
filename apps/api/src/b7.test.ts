import pg from 'pg';
import { SignJWT, exportSPKI, generateKeyPair } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrisma } from '@narra/database';
import { buildApp } from './app';
import { createPrivyVerifier } from './auth';
import { csvNum, csvText } from './me';
import { likeEscape } from './paging';
import { SOL_PRICE_KEY } from '@narra/worker-pipeline';
import {seedTestPro,clearTestPro} from './test-membership';

const url = process.env.DATABASE_URL ?? 'postgresql://narra:narra@localhost:5432/narra';
async function dbUp() {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 800 });
  try { await c.connect(); await c.query('select 1 from "UserSettings" limit 1'); return true; } catch { return false; } finally { await c.end().catch(() => {}); }
}
const up = await dbUp();

describe('likeEscape (pure)', () => {
  it('escapes %, _ and the backslash so they match literally', () => {
    expect(likeEscape('50%_off\\x')).toBe('50\\%\\_off\\\\x');
    expect(likeEscape('plain')).toBe('plain');
  });
});

describe('CSV cells (pure)', () => {
  it('neutralizes spreadsheet formulas in text, quotes, and flattens newlines', () => {
    expect(csvText('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvText('+1')).toBe(`"'+1"`);
    expect(csvText('@SUM(A1)')).toBe(`"'@SUM(A1)"`);
    expect(csvText('-cmd')).toBe(`"'-cmd"`);
    expect(csvText('a,b\nc')).toBe('"a,b c"');
    expect(csvText(null)).toBe('');
  });
  it('writes numbers as plain numbers, including negative ones', () => {
    expect(csvNum(-0.25)).toBe('-0.25');
    expect(csvNum(null)).toBe('');
    expect(csvNum(Number.NaN)).toBe('');
  });
});

describe.skipIf(!up)('B7 API routes (needs Postgres)', () => {
  const db = createPrisma(url);
  const tag = `b7a${Date.now()}`;
  const APP_ID = 'b7-test';
  // Base58 has no 0, O, I or l, so those become x. Cleanup must search for the same transformed tag.
  const addr = (s: string) => `${s}${tag}`.replace(/[0OIl_]/g, 'x').padEnd(40, '1');
  const tagKey = tag.replace(/[0OIl_]/g, 'x');
  const alice = `did:privy:${tag}-a`; const bob = `did:privy:${tag}-b`;
  let aliceId = ''; let bobId = '';
  let keys: Awaited<ReturnType<typeof generateKeyPair>>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let solBackup: { value: unknown } | null = null;
  const balanceCalls: string[] = [];

  async function call(method: 'GET' | 'POST' | 'PUT', path: string, sub: string | null = alice, body?: unknown, ip?: string) {
    const token = sub ? await new SignJWT({}).setProtectedHeader({ alg: 'ES256' }).setSubject(sub).setIssuer('privy.io').setAudience(APP_ID).setIssuedAt().setExpirationTime('5m').sign(keys.privateKey) : null;
    const res = await app.inject({ method, url: path, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(body !== undefined ? { payload: body as object } : {}), ...(ip ? { remoteAddress: ip } : {}) });
    const json = res.headers['content-type']?.toString().includes('json') ? res.json() : undefined;
    return { status: res.statusCode, body: json, text: res.body, headers: res.headers };
  }

  const createdAlerts: string[] = [];
  const historyDiagnosticKeys:string[]=[];
  const mkAlert = async (kind: string, priority: 'INFO' | 'WATCH' | 'IMPORTANT' | 'CRITICAL', userId: string | null = null, createdAt = new Date()) => {
    const a = await db.alert.create({ data: { kind, priority, title: `${kind} title`, body: 'b', userId, createdAt, dispatchedAt: new Date() } });
    createdAlerts.push(a.id);
    return a;
  };
  const notify = (userId: string, alertId: string, createdAt = new Date()) => db.notification.create({ data: { userId, alertId, createdAt } });

  beforeAll(async () => {
    keys = await generateKeyPair('ES256');
    app = await buildApp({
      account: { db, verifier: createPrivyVerifier({ appId: APP_ID, verificationKey: await exportSPKI(keys.publicKey) }) },
      balances: { getBalanceLamports: async (a) => { balanceCalls.push(a); if (a.startsWith('fail')) throw new Error('rpc down'); return 2_500_000_000n; } },
    });
    aliceId = (await db.user.create({ data: { privyUserId: alice } })).id;
    bobId = (await db.user.create({ data: { privyUserId: bob } })).id;
    await seedTestPro(db,aliceId);await seedTestPro(db,bobId);
    solBackup = await db.systemSetting.findUnique({ where: { key: SOL_PRICE_KEY } });
  });

  afterAll(async () => {
    await db.systemSetting.deleteMany({where:{key:{in:historyDiagnosticKeys}}});
    await clearTestPro(db,[aliceId,bobId]);
    const uids = [aliceId, bobId];
    await db.notification.deleteMany({ where: { OR: [{ userId: { in: uids } }, { alertId: { in: createdAlerts } }] } });
    await db.alert.deleteMany({ where: { id: { in: createdAlerts } } });
    await db.trade.deleteMany({ where: { userId: { in: uids } } });
    await db.order.deleteMany({ where: { userId: { in: uids } } });
    await db.wallet.deleteMany({ where: { userId: { in: uids } } });
    await db.auditLog.deleteMany({ where: { userId: { in: uids } } });
    await db.user.deleteMany({ where: { id: { in: uids } } });
    // Tokens first: they cascade to opportunities, consensus and relations, which narratives cannot be deleted under.
    await db.walletTrade.deleteMany({ where: { token: { mint: { contains: tagKey.slice(-8) } } } });
    await db.token.deleteMany({ where: { mint: { contains: tagKey.slice(-8) } } });
    await db.trackedWallet.deleteMany({ where: { address: { contains: tagKey.slice(-8) } } });
    await db.walletCluster.deleteMany({ where: { label: `cl-${tag}` } });
    await db.narrative.deleteMany({ where: { slug: { endsWith: tag } } });
    await db.creator.deleteMany({ where: { handle: { endsWith: tag } } });
    if (solBackup) await db.systemSetting.update({ where: { key: SOL_PRICE_KEY }, data: { value: solBackup.value as object } }); else await db.systemSetting.deleteMany({ where: { key: SOL_PRICE_KEY } });
    await app.close(); await db.$disconnect();
  });

  it('requires a signed-in user on every new route', async () => {
    for (const [m, p] of [['GET', '/v1/alerts'], ['GET', '/v1/alerts/unread-count'], ['POST', '/v1/alerts/read-all'], ['GET', '/v1/settings'], ['PUT', '/v1/settings/interests'], ['GET', '/v1/overview'], ['GET', '/v1/intelligence-bar'], ['GET', '/v1/narratives/rotation'], ['GET', '/v1/search?q=abc'], ['GET', `/v1/wallets/${addr('w')}`], ['GET', '/v1/me/wallets'], ['GET', '/v1/me/wallets/balances'], ['GET', '/v1/trades/export']] as const) {
      const r = await call(m, p, null, undefined, '10.9.9.9');
      expect(r.status, `${m} ${p}`).toBe(401);
    }
  });

  describe('alerts', () => {
    it('lists only the caller\'s notifications, newest first, with unread count, filters and paging', async () => {
      const t0 = Date.now();
      const a1 = await mkAlert(`K1_${tag}`.toUpperCase(), 'INFO', null, new Date(t0 - 4000));
      const a2 = await mkAlert(`K2_${tag}`.toUpperCase(), 'IMPORTANT', null, new Date(t0 - 3000));
      const a3 = await mkAlert(`K3_${tag}`.toUpperCase(), 'CRITICAL', aliceId, new Date(t0 - 2000));
      const bobs = await mkAlert(`BOBS_${tag}`.toUpperCase(), 'CRITICAL', bobId, new Date(t0 - 1000));
      for (const [u, a, off] of [[aliceId, a1, 4000], [aliceId, a2, 3000], [aliceId, a3, 2000], [bobId, bobs, 1000], [bobId, a2, 3000]] as const) await notify(u, a.id, new Date(t0 - off));

      const list = await call('GET', '/v1/alerts?limit=2');
      expect(list.status).toBe(200);
      expect(list.body.items.map((i: { alertId: string }) => i.alertId)).toEqual([a3.id, a2.id]);
      expect(list.body.unreadCount).toBe(3);
      expect(list.body.nextCursor).toBeTruthy();
      expect(JSON.stringify(list.body)).not.toContain(bobs.id); // nothing of Bob's

      const page2 = await call('GET', `/v1/alerts?limit=2&cursor=${list.body.nextCursor}`);
      expect(page2.body.items.map((i: { alertId: string }) => i.alertId)).toEqual([a1.id]);
      expect(page2.body.nextCursor).toBeNull();

      const byPriority = await call('GET', '/v1/alerts?sort=priority');
      expect(byPriority.body.items.map((i: { priority: string }) => i.priority)).toEqual(['CRITICAL', 'IMPORTANT', 'INFO']);
      const min = await call('GET', '/v1/alerts?minPriority=IMPORTANT');
      expect(min.body.items).toHaveLength(2);
      const kind = await call('GET', `/v1/alerts?kind=K2_${tag.toUpperCase()}`);
      expect(kind.body.items).toHaveLength(1);
      expect((await call('GET', '/v1/alerts?minPriority=LOUD')).status).toBe(400);
    });

    it('refuses a cursor that belongs to another user, and a malformed one', async () => {
      const bobsRow = await db.notification.findFirstOrThrow({ where: { userId: bobId } });
      expect((await call('GET', `/v1/alerts?cursor=${bobsRow.id}`)).status).toBe(400);
      expect((await call('GET', '/v1/alerts?cursor=%27%3B--')).status).toBe(400);
    });

    it('marks one read (idempotently, keeping the first time), 404s for another user\'s id, and marks all read with filters', async () => {
      const mine = await db.notification.findMany({ where: { userId: aliceId }, include: { alert: true }, orderBy: { createdAt: 'asc' } });
      const info = mine.find((n) => n.alert.priority === 'INFO')!;
      const first = await call('POST', `/v1/alerts/${info.id}/read`);
      expect(first.body).toEqual({ id: info.id, read: true });
      const t1 = (await db.notification.findUniqueOrThrow({ where: { id: info.id } })).readAt!;
      await call('POST', `/v1/alerts/${info.id}/read`);
      expect((await db.notification.findUniqueOrThrow({ where: { id: info.id } })).readAt!.getTime()).toBe(t1.getTime());

      const bobsRow = await db.notification.findFirstOrThrow({ where: { userId: bobId } });
      expect((await call('POST', `/v1/alerts/${bobsRow.id}/read`)).status).toBe(404);
      expect((await db.notification.findUniqueOrThrow({ where: { id: bobsRow.id } })).readAt).toBeNull();

      const count = await call('GET', '/v1/alerts/unread-count');
      expect(count.body).toMatchObject({ unread: 2, capped: false, byPriority: { IMPORTANT: 1, CRITICAL: 1 } });
      const some = await call('POST', '/v1/alerts/read-all', alice, { minPriority: 'CRITICAL' });
      expect(some.body).toEqual({ marked: 1 });
      const all = await call('POST', '/v1/alerts/read-all', alice, {});
      expect(all.body).toEqual({ marked: 1 });
      expect((await call('GET', '/v1/alerts?unread=true')).body.items).toHaveLength(0);
      expect(await db.notification.count({ where: { userId: bobId, readAt: null } })).toBe(2); // Bob's are untouched
      expect((await call('POST', '/v1/alerts/read-all', alice, { surprise: 1 })).status).toBe(400);
    });
  });

  describe('settings', () => {
    it('returns defaults for a new user', async () => {
      const r = await call('GET', '/v1/settings', bob);
      expect(r.body).toMatchObject({
        profile: { displayName: null, timezone: null }, appearance: { theme: 'DARK', density: 'COMFORTABLE', reducedMotion: false },
        notifications: { minPriority: 'WATCH', mutedKinds: [], alwaysDelivered: expect.arrayContaining(['CRITICAL']) }, interests: [],
      });
    });

    it('saves and returns each section, sanitizes text, audits, and keeps sections independent', async () => {
      const p = await call('PUT', '/v1/settings/profile', alice, { displayName: '  Ada\u202E  Lovelace ', timezone: 'Asia/Jakarta' });
      expect(p.body).toEqual({ displayName: 'Ada Lovelace', timezone: 'Asia/Jakarta' });
      const ap = await call('PUT', '/v1/settings/appearance', alice, { theme: 'LIGHT', reducedMotion: true });
      expect(ap.body).toEqual({ theme: 'LIGHT', density: 'COMFORTABLE', reducedMotion: true });
      const nt = await call('PUT', '/v1/settings/notifications', alice, { minPriority: 'IMPORTANT', mutedKinds: ['NARRATIVE_EMERGING', 'NARRATIVE_EMERGING'] });
      expect(nt.body).toMatchObject({ minPriority: 'IMPORTANT', mutedKinds: ['NARRATIVE_EMERGING'] });
      const iv = await call('PUT', '/v1/settings/interests', alice, { interests: [' AI Agents ', 'ai agents', 'Memecoins'] });
      expect(iv.body).toEqual({ interests: ['ai agents', 'memecoins'] });

      const all = await call('GET', '/v1/settings');
      expect(all.body).toMatchObject({ profile: { displayName: 'Ada Lovelace', timezone: 'Asia/Jakarta' }, appearance: { theme: 'LIGHT', reducedMotion: true }, notifications: { minPriority: 'IMPORTANT' }, interests: ['ai agents', 'memecoins'] });
      // Bob is unaffected
      expect((await call('GET', '/v1/settings', bob)).body.interests).toEqual([]);
      const actions = (await db.auditLog.findMany({ where: { userId: aliceId, action: { startsWith: 'settings.' } } })).map((a) => a.action).sort();
      expect(actions).toEqual(['settings.appearance.changed', 'settings.interests.changed', 'settings.notifications.changed', 'settings.profile.changed']);
      // A profile change does not reset notification preferences
      await call('PUT', '/v1/settings/profile', alice, { timezone: null });
      expect((await call('GET', '/v1/settings')).body.notifications.minPriority).toBe('IMPORTANT');
    });

    it('rejects unknown fields, bad enums, a bad time zone and too many interests with the field names', async () => {
      expect((await call('PUT', '/v1/settings/appearance', alice, { theme: 'NEON' })).status).toBe(400);
      expect((await call('PUT', '/v1/settings/appearance', alice, {})).status).toBe(400);
      expect((await call('PUT', '/v1/settings/profile', alice, { timezone: 'Nowhere/Land' })).body).toMatchObject({ error: 'INVALID_INPUT', fields: ['timezone'] });
      expect((await call('PUT', '/v1/settings/profile', alice, { displayName: 'x', isAdmin: true })).status).toBe(400);
      expect((await call('PUT', '/v1/settings/notifications', alice, { minPriority: 'WATCH', mutedKinds: ['bad kind!'] })).status).toBe(400);
      expect((await call('PUT', '/v1/settings/interests', alice, { interests: Array.from({ length: 21 }, (_, i) => `t${i}`) })).status).toBe(400);
    });
  });

  describe('overview, intelligence bar and rotation', () => {
    it('reports an unknown SOL price as null and a stale one as stale, never as a number it cannot vouch for', async () => {
      await db.systemSetting.deleteMany({ where: { key: SOL_PRICE_KEY } });
      expect((await call('GET', '/v1/intelligence-bar')).body.solUsd).toBeNull();
      await db.systemSetting.create({ data: { key: SOL_PRICE_KEY, value: { priceUsd: 160, at: new Date(Date.now() - 3_600_000).toISOString(), source: 't' } } });
      expect((await call('GET', '/v1/intelligence-bar')).body.solUsd).toMatchObject({ priceUsd: 160, stale: true });
      await db.systemSetting.update({ where: { key: SOL_PRICE_KEY }, data: { value: { priceUsd: 161.5, at: new Date().toISOString(), source: 't' } } });
      expect((await call('GET', '/v1/intelligence-bar')).body.solUsd).toMatchObject({ priceUsd: 161.5, stale: false });
    });

    it('builds the dashboard from the data, with a rules-built brief and the caller\'s own counts only', async () => {
      const now = Date.now();
      const nar = async (slug: string, name: string, stage: 'ACCELERATING' | 'DECAYING', score: number, prevScore: number) => {
        const n = await db.narrative.create({ data: { name, slug: `${slug}-${tag}`, stage, score } });
        await db.narrativeMetric.create({ data: { narrativeId: n.id, score: prevScore, velocity: 1, acceleration: 0, organicScore: 50, manipulationRisk: 1, mentionVelocity: 1, creatorVelocity: 1, engagementVelocity: 1, at: new Date(now - 30 * 3600_000) } });
        await db.narrativeMetric.create({ data: { narrativeId: n.id, score, velocity: 1, acceleration: 0, organicScore: 50, manipulationRisk: 1, mentionVelocity: 1, creatorVelocity: 1, engagementVelocity: 1, at: new Date(now - 60_000) } });
        return n;
      };
      const rising = await nar('rising', `Rising ${tag}`, 'ACCELERATING', 99.5, 40);
      await nar('falling', `Falling ${tag}`, 'DECAYING', 50, 92);
      const tok = await db.token.create({ data: { mint: addr('OV'), symbol: `OV${tag.slice(-4)}`, name: 'ov', metrics: { create: { priceUsd: 0.02, marketCapUsd: 1_000_000, liquidityUsd: 100_000, volume24hUsd: 50_000 } }, consensus: { create: { score: 80, walletCount: 2, independentEntities: 2, leaderCount: 0, netFlowSol: 12.5, at: new Date(now - 60_000) } } } });
      await db.opportunity.create({ data: { tokenId: tok.id, narrativeId: rising.id, score: 99.9, narrativeScore: 1, smartMoneyScore: 1, liquidityScore: 1, momentumScore: 1, ogScore: 1, riskScore: 1 } });
      const a = await mkAlert(`OVW_${tag}`.toUpperCase(), 'WATCH', null);
      await notify(aliceId, a.id);

      const r = await call('GET', '/v1/overview');
      expect(r.status).toBe(200);
      expect(r.body.strip.topNarratives[0]).toMatchObject({ slug: `rising-${tag}`, score: 99.5 });
      expect(r.body.strip.hottestOpportunity).toMatchObject({ score: 99.9, token: { symbol: `OV${tag.slice(-4)}` } });
      expect(r.body.bar.smartMoneyNetFlowSol24h).toBeGreaterThanOrEqual(12.5 - 0.0001);
      expect(r.body.bar.counts.acceleratingNarratives).toBeGreaterThanOrEqual(1);
      expect(r.body.brief.generated).toBe('rules');
      expect(r.body.brief.points.join(' ')).toContain(`Rising ${tag} leads`);
      expect(r.body.me).toMatchObject({ unreadAlerts: 1, openPositions: 0, pendingConfirmations: 0 });
      // Bob has two unread notifications of his own from the alerts test above. He sees his count, never Alice's.
      expect((await call('GET', '/v1/overview', bob)).body.me.unreadAlerts).toBe(2);
    });

    it('shows up to ten narratives while heat still uses only the strongest five',async()=>{
      for(let i=0;i<7;i++)await db.narrative.create({data:{name:`Scope ${i} ${tag}`,slug:`scope-${i}-${tag}`,stage:'SEED',score:98-i}});
      const expected=await db.narrative.findMany({where:{stage:{not:'DEAD'}},orderBy:[{score:'desc'},{id:'asc'}],take:10});
      const r=await call('GET','/v1/overview');
      expect(r.body.strip.topNarratives.map((n:{id:string})=>n.id)).toEqual(expected.map(n=>n.id));
      expect(r.body.strip.topNarratives.length).toBeGreaterThan(5);
      expect(r.body.bar.narrativeHeat).toBe(Math.round(expected.slice(0,5).reduce((s,n)=>s+n.score,0)/5));
    });

    it('finds the rotation from falling to rising narratives, and says what it could not compare', async () => {
      const r = await call('GET', '/v1/narratives/rotation?window=24h');
      expect(r.status).toBe(200);
      expect(r.body.rising.map((x: { slug: string }) => x.slug)).toContain(`rising-${tag}`);
      expect(r.body.falling.map((x: { slug: string }) => x.slug)).toContain(`falling-${tag}`);
      expect(r.body.detected).toBe(true);
      expect(r.body.rising.find((x: { slug: string }) => x.slug === `rising-${tag}`)).toMatchObject({ from: 40, to: 99.5 });
      expect(r.body.rules.minDeltaPoints).toBe(10);
      expect(typeof r.body.unknown).toBe('number');
      expect((await call('GET', '/v1/narratives/rotation?window=3y')).status).toBe(400);
      // A narrative with no reading old enough is unknown, not unchanged
      const fresh = await db.narrative.create({ data: { name: `Fresh ${tag}`, slug: `fresh-${tag}`, stage: 'EMERGING', score: 70 } });
      await db.narrativeMetric.create({ data: { narrativeId: fresh.id, score: 70, velocity: 1, acceleration: 0, organicScore: 1, manipulationRisk: 1, mentionVelocity: 1, creatorVelocity: 1, engagementVelocity: 1 } });
      const again = await call('GET', '/v1/narratives/rotation?window=24h');
      expect([...again.body.rising, ...again.body.falling].some((x: { slug: string }) => x.slug === `fresh-${tag}`)).toBe(false);
      expect(again.body.unknown).toBeGreaterThanOrEqual(1);
    });
  });

  describe('tracked wallet detail and search', () => {
    let wAddr = ''; let tokA = ''; let tokB = '';
    const base = Date.now();

    it('builds a wallet profile with performance, cluster, funding, relationships and narrative history, and hides inactive wallets', async () => {
      wAddr = addr('WAL');
      const cluster = await db.walletCluster.create({ data: { label: `cl-${tag}`, confidence: 'MEDIUM' } });
      const w = await db.trackedWallet.create({ data: { address: wAddr, label: 'Alpha one', clusterId: cluster.id, profile: { create: { score: 92, leaderScore: 80, style: 'EARLY_MOMENTUM', medianHoldSeconds: 600, bestPattern: 'early entries' } } } });
      const mate = await db.trackedWallet.create({ data: { address: addr('MATE'), label: 'Mate', clusterId: cluster.id } });
      const gone = await db.trackedWallet.create({ data: { address: addr('GONE'), active: false } });
      await db.walletRelationship.create({ data: { fromId: w.id, toId: mate.id, kind: 'FUNDING', confidence: 'HIGH' } });
      await db.walletRelationship.create({ data: { fromId: w.id, toId: gone.id, kind: 'TIMING', confidence: 'LOW' } });
      await db.walletFunding.create({ data: { walletId: w.id, funder: addr('FUNDER'), lamports: 5_000_000_000n, fundedAt: new Date(base - 86_400_000), status: 'FOUND' } });
      for (const [window, win, pnl] of [['30D', 0.7, 12.5], ['7D', 0.5, 2]] as const) await db.walletMetric.create({ data: { walletId: w.id, window, winRate: win, pnlSol: pnl, closedTrades: 10, avgRoi: 0.3, medianRoi: 0.2, maxDrawdown: 0.1 } });
      await db.walletMetric.create({ data: { walletId: w.id, window: '30D', winRate: 0.1, pnlSol: -1, closedTrades: 1, avgRoi: 0, medianRoi: 0, maxDrawdown: 0.9, computedAt: new Date(base - 3_600_000) } }); // older reading, must lose to the newest

      const nar = await db.narrative.create({ data: { name: `Wal Narr ${tag}`, slug: `walnarr-${tag}`, stage: 'ACCELERATING', score: 80 } });
      tokA = (await db.token.create({ data: { mint: addr('TKA'), symbol: `TKA${tag.slice(-4)}`, name: 'A' } })).id;
      tokB = (await db.token.create({ data: { mint: addr('TKB'), symbol: `TKB${tag.slice(-4)}`, name: 'B' } })).id;
      await db.narrativeTokenRelation.create({ data: { narrativeId: nar.id, tokenId: tokA, relation: 'OG', ogScore: 80, matchScore: 80, confidence: 0.8 } });
      await db.narrativeTokenRelation.create({ data: { narrativeId: nar.id, tokenId: tokB, relation: 'SUSPICIOUS', ogScore: 10, matchScore: 80, confidence: 0.8 } }); // suspicious links are not narrative history
      const trade = (id: string, tokenId: string, side: 'BUY' | 'SELL', sol: number, ago: number, sig: string) => db.walletTrade.create({ data: { walletId: id, tokenId, side, amountSol: sol, tokenAmount: 1, signature: `${sig}${tag}`, at: new Date(base - ago) } });
      await trade(w.id, tokA, 'BUY', 2, 5000, 'sa'); await trade(w.id, tokA, 'SELL', 3.5, 3000, 'sb'); await trade(w.id, tokB, 'BUY', 1, 1000, 'sc');
      const attemptKey=`wallet.historyAttempt.${w.id}`;historyDiagnosticKeys.push(attemptKey);
      await db.systemSetting.create({data:{key:attemptKey,value:{version:1,status:'FAILED',mode:'RESUME',lastAttemptAt:new Date(base).toISOString(),lastSuccessAt:new Date(base-3600000).toISOString(),errorCode:'RATE_LIMITED',httpStatus:429,consecutiveFailures:1,attempts:2,pagesRead:0}}});

      const r = await call('GET', `/v1/wallets/${wAddr}`);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ address: wAddr, label: 'Alpha one', profile: { score: 92, style: 'EARLY_MOMENTUM' } });
      expect(r.body.historyAttempt).toMatchObject({status:'FAILED',mode:'RESUME',errorCode:'RATE_LIMITED',httpStatus:429,attempts:2});
      expect(r.body.performance['30D']).toMatchObject({ winRate: 0.7, pnlSol: 12.5 }); // the newest 30D reading
      expect(r.body.performance['7D']).toMatchObject({ winRate: 0.5 });
      expect(r.body.cluster).toMatchObject({ confidence: 'MEDIUM', size: 2, members: [{ address: mate.address }] });
      expect(r.body.relationships).toEqual([{ direction: 'OUT', kind: 'FUNDING', confidence: 'HIGH', wallet: { address: mate.address, label: 'Mate' } }]); // the inactive wallet is not listed
      expect(r.body.funding).toMatchObject({ status: 'FOUND', amountSol: 5, funder: addr('FUNDER') });
      expect(r.body.recentTrades.map((t: { signature: string }) => t.signature)).toEqual([`sc${tag}`, `sb${tag}`, `sa${tag}`]);
      expect(r.body.narrativeHistory.items).toEqual([expect.objectContaining({ slug: `walnarr-${tag}`, buys: 1, sells: 1, netSol: 1.5 })]);
      expect(r.body.narrativeHistory).toMatchObject({ lookbackDays: 90, scannedTrades: 3, scanCapped: false });

      expect((await call('GET', `/v1/wallets/${gone.address}`)).status).toBe(404);
      expect((await call('GET', `/v1/wallets/${addr('NOPE')}`)).status).toBe(404);
      expect((await call('GET', '/v1/wallets/not-an-address')).status).toBe(400);
    });

    it('pages a wallet\'s trades and refuses a cursor from another wallet', async () => {
      const p1 = await call('GET', `/v1/wallets/${wAddr}/trades?limit=2`);
      expect(p1.body.items).toHaveLength(2); expect(p1.body.nextCursor).toBeTruthy();
      const p2 = await call('GET', `/v1/wallets/${wAddr}/trades?limit=2&cursor=${p1.body.nextCursor}`);
      expect(p2.body.items.map((t: { signature: string }) => t.signature)).toEqual([`sa${tag}`]);
      expect((await call('GET', `/v1/wallets/${wAddr}/trades?side=SELL`)).body.items).toHaveLength(1);
      const other = await db.trackedWallet.findFirstOrThrow({ where: { address: addr('MATE') } });
      const foreign = await db.walletTrade.create({ data: { walletId: other.id, tokenId: tokA, side: 'BUY', amountSol: 1, signature: `zz${tag}`, at: new Date() } });
      expect((await call('GET', `/v1/wallets/${wAddr}/trades?cursor=${foreign.id}`)).status).toBe(400);
    });

    it('searches tokens, narratives, wallets, creators and transaction signatures, and treats % and _ as plain text', async () => {
      await db.creator.create({ data: { platform: 'X', handle: `searchme${tag}` } });
      const byText = await call('GET', `/v1/search?q=${encodeURIComponent(`TKA${tag.slice(-4)}`)}`);
      expect(byText.body).toMatchObject({ kind: 'TEXT', results: { tokens: [{ symbol: `TKA${tag.slice(-4)}` }] } });
      expect((await call('GET', `/v1/search?q=${encodeURIComponent(`wal narr ${tag}`)}`)).body.results.narratives[0]).toMatchObject({ slug: `walnarr-${tag}` });
      expect((await call('GET', '/v1/search?q=Alpha')).body.results.wallets[0]).toMatchObject({ address: wAddr, label: 'Alpha one', score: 92 });
      expect((await call('GET', `/v1/search?q=${encodeURIComponent('@searchme' + tag)}`)).body.results.creators).toEqual([{ platform: 'X', handle: `searchme${tag}` }]);

      const exactMint = await call('GET', `/v1/search?q=${addr('TKA')}`);
      expect(exactMint.body.kind).toBe('ADDRESS');
      expect(exactMint.body.results.tokens[0].mint).toBe(addr('TKA'));
      expect((await call('GET', `/v1/search?q=${wAddr}`)).body.results.wallets[0].address).toBe(wAddr);

      // A tracked wallet's swap is found by its exact signature, which is 88 base58 characters.
      const sig = 'sig1'.padEnd(88, '2');
      const wRow = await db.trackedWallet.findFirstOrThrow({ where: { address: wAddr } });
      await db.walletTrade.create({ data: { walletId: wRow.id, tokenId: tokA, side: 'BUY', amountSol: 1, signature: sig, at: new Date() } });
      const bySig = await call('GET', `/v1/search?q=${sig}`);
      expect(bySig.body.kind).toBe('SIGNATURE');
      expect(bySig.body.results.transactions).toEqual([expect.objectContaining({ source: 'TRACKED_WALLET', signature: sig, wallet: wAddr })]);

      // Wildcards are literal. "%%" matches nothing, "A_" does not match "AB", and a real "%" in a name is found.
      expect((await call('GET', '/v1/search?q=%25%25')).body.results.tokens).toEqual([]);
      await db.token.create({ data: { mint: addr('PCT'), symbol: `AB${tag.slice(-4)}`, name: `Half ${tag.slice(-4)} 100% sure` } });
      expect((await call('GET', `/v1/search?q=${encodeURIComponent(`AB${tag.slice(-4)}`.slice(0, 2) + '_')}`)).body.results.tokens.map((t: { symbol: string }) => t.symbol)).not.toContain(`AB${tag.slice(-4)}`);
      expect((await call('GET', `/v1/search?q=${encodeURIComponent(`${tag.slice(-4)} 100%`)}`)).body.results.tokens.map((t: { symbol: string }) => t.symbol)).toContain(`AB${tag.slice(-4)}`);
      expect((await call('GET', `/v1/tokens?q=${encodeURIComponent('%%')}`)).body.items).toEqual([]); // the plain list is guarded the same way
      expect((await call('GET', '/v1/search?q=a')).status).toBe(400);
      expect((await call('GET', `/v1/search?q=${'x'.repeat(101)}`)).status).toBe(400);
    });

    it('finds the caller\'s own trade by signature and never another user\'s', async () => {
      const order = await db.order.create({ data: { userId: aliceId, tokenId: tokA, idempotencyKey: `ord-${tag}`, side: 'BUY', mode: 'AI_PAPER', status: 'CONFIRMED', sizeSol: 0.2, simulated: true } });
      const sig = 'mine1'.padEnd(88, '3');
      await db.trade.create({ data: { userId: aliceId, orderId: order.id, side: 'BUY', mode: 'AI_PAPER', reason: 'entry', expectedPriceUsd: 1, actualPriceUsd: 1, slippageBps: 5, simulated: true, signature: sig } });
      expect((await call('GET', `/v1/search?q=${sig}`, alice)).body.results.transactions).toEqual([expect.objectContaining({ source: 'MY_TRADE', signature: sig, simulated: true })]);
      expect((await call('GET', `/v1/search?q=${sig}`, bob)).body.results.transactions).toEqual([]);
    });
  });

  describe('token screener and pagination', () => {
    const mk = async (key: string, o: { price?: number; mc?: number; liq?: number; vol?: number; holders?: number; top10?: number; risk?: number; flags?: string[]; ageMin?: number | null; blacklisted?: boolean; metrics?: boolean }) => {
      const t = await db.token.create({ data: { mint: addr(key), symbol: `SC${key}${tag.slice(-3)}`, name: `scr ${key}`, blacklisted: o.blacklisted ?? false, createdOnChainAt: o.ageMin === null ? null : new Date(Date.now() - (o.ageMin ?? 600) * 60_000) } });
      if (o.metrics !== false) {
        await db.tokenMetric.create({ data: { tokenId: t.id, priceUsd: o.price ?? 0.01, marketCapUsd: o.mc ?? 1_000_000, liquidityUsd: o.liq ?? 100_000, volume24hUsd: o.vol ?? 50_000 } });
        await db.tokenHolderMetric.create({ data: { tokenId: t.id, holders: o.holders ?? 500, top10Pct: o.top10 ?? 30, smartWalletHolders: 1 } });
        await db.tokenRiskMetric.create({ data: { tokenId: t.id, riskScore: o.risk ?? 30, flags: o.flags ?? [] } });
      }
      return t;
    };
    const syms = (r: { body: { items: { symbol: string }[] } }) => r.body.items.map((i) => i.symbol.replace(/^SC/, '').replace(tag.slice(-3), ''));
    const scr = (qs: string) => call('GET', `/v1/tokens?q=scr&${qs}`);

    beforeAll(async () => {
      await mk('A', { mc: 5_000_000, liq: 400_000, holders: 2000, risk: 10, ageMin: 60 * 24 });
      await mk('B', { mc: 2_000_000, liq: 90_000, holders: 800, risk: 55, flags: ['HONEYPOT'], ageMin: 120 });
      await mk('C', { mc: 800_000, liq: 30_000, holders: 150, risk: 80, ageMin: 30 });
      await mk('D', { mc: 3_000_000, liq: 200_000, holders: 1200, risk: 20, ageMin: null });   // unknown launch time
      await mk('E', { metrics: false });                                                        // no readings at all
      await mk('F', { mc: 9_000_000, blacklisted: true });
    });

    it('filters on latest readings, and leaves out tokens whose reading is unknown instead of treating it as zero', async () => {
      expect(syms(await scr('minMarketCapUsd=1000000&sort=marketCap'))).toEqual(['A', 'D', 'B']); // E has no reading, F is blacklisted, C is below
      expect(syms(await scr('maxRiskScore=25&sort=risk'))).toEqual(['A', 'D']);
      expect(syms(await scr('minHolders=1000&sort=holders'))).toEqual(['A', 'D']);
      expect(syms(await scr('excludeHoneypot=true&sort=marketCap'))).toEqual(['A', 'D', 'C']);
      expect(syms(await scr('maxAgeMinutes=200&sort=age'))).toEqual(['C', 'B']); // newest first; D (age unknown) is left out, not counted as new
      expect(syms(await scr('minAgeMinutes=1000&sort=age'))).toEqual(['A']);
      expect(syms(await scr('includeBlacklisted=true&sort=marketCap'))).toContain('F');
      expect(syms(await scr('sort=liquidity&order=asc'))).toEqual(['C', 'B', 'D', 'A']);
    });

    it('filters by narrative stage, slug and OG score through the narrative links', async () => {
      const n = await db.narrative.create({ data: { name: `Scr ${tag}`, slug: `scr-${tag}`, stage: 'ACCELERATING', score: 60 } });
      const a = await db.token.findUniqueOrThrow({ where: { mint: addr('A') } }); const c = await db.token.findUniqueOrThrow({ where: { mint: addr('C') } });
      await db.narrativeTokenRelation.create({ data: { narrativeId: n.id, tokenId: a.id, relation: 'OG', ogScore: 88, matchScore: 90, confidence: 0.9 } });
      await db.narrativeTokenRelation.create({ data: { narrativeId: n.id, tokenId: c.id, relation: 'SUSPICIOUS', ogScore: 95, matchScore: 90, confidence: 0.9 } });
      expect(syms(await scr(`narrative=scr-${tag}&sort=og`))).toEqual(['A']); // the suspicious link does not count
      expect(syms(await scr('minOgScore=80&sort=og'))).toEqual(['A']);
      expect(syms(await scr('narrativeStage=ACCELERATING&sort=marketCap')).includes('A')).toBe(true);
      expect(syms(await scr('narrativeStage=DEAD&sort=marketCap'))).toEqual([]);
    });

    it('pages a sorted result without skipping or repeating rows, including ties', async () => {
      await mk('G', { mc: 3_000_000 }); await mk('H', { mc: 3_000_000 }); // ties with D on market cap
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < 10; i++) {
        const r = await scr(`sort=marketCap&limit=2${cursor ? `&cursor=${cursor}` : ''}`);
        expect(r.status).toBe(200);
        seen.push(...syms(r));
        cursor = r.body.nextCursor;
        if (!cursor) break;
      }
      expect(seen).toHaveLength(new Set(seen).size);
      expect(seen.slice().sort()).toEqual(['A', 'B', 'C', 'D', 'G', 'H']);
      expect(seen[0]).toBe('A'); // 5M first
    });

    it('rejects bad filters, and bad or foreign-shaped cursors, with a 400 and never an error', async () => {
      expect((await scr('minHolders=-1')).status).toBe(400);
      expect((await scr('sort=price')).status).toBe(400);
      expect((await scr('narrative=Bad Slug')).status).toBe(400);
      expect((await scr('sort=marketCap&cursor=garbage')).status).toBe(400);
      const forged = Buffer.from(JSON.stringify(['1; DROP TABLE "Token"', 'x'])).toString('base64url');
      expect((await scr(`sort=marketCap&cursor=${forged}`)).status).toBe(400);
      expect(await db.token.count()).toBeGreaterThan(0);
    });

    it('keeps the simple list working with a cursor, and pages narratives, opportunities, smart-money wallets and confirmations', async () => {
      const t1 = await call('GET', `/v1/tokens?q=scr&limit=2`);
      expect(t1.body.items).toHaveLength(2); expect(t1.body.nextCursor).toBeTruthy();
      const t2 = await call('GET', `/v1/tokens?q=scr&limit=2&cursor=${t1.body.nextCursor}`);
      expect(t2.body.items.map((i: { mint: string }) => i.mint)).not.toContain(t1.body.items[0].mint);
      expect((await call('GET', '/v1/tokens?cursor=nope-nope')).status).toBe(400);

      const n1 = await call('GET', '/v1/narratives?limit=1');
      expect(n1.body.items).toHaveLength(1); expect(n1.body.nextCursor).toBeTruthy();
      const n2 = await call('GET', `/v1/narratives?limit=1&cursor=${n1.body.nextCursor}`);
      expect(n2.body.items[0].id).not.toBe(n1.body.items[0].id);
      expect((await call('GET', '/v1/narratives?cursor=missing')).status).toBe(400);

      const o1 = await call('GET', '/v1/opportunities?limit=1');
      expect(o1.status).toBe(200);
      if (o1.body.nextCursor) {
        const o2 = await call('GET', `/v1/opportunities?limit=1&cursor=${o1.body.nextCursor}`);
        expect(o2.body.items[0].id).not.toBe(o1.body.items[0].id);
        expect(o2.body.items[0].score).toBeLessThanOrEqual(o1.body.items[0].score);
      }
      expect((await call('GET', '/v1/opportunities?cursor=garbage')).status).toBe(400);

      expect((await call('GET', '/v1/smart-money/wallets?limit=1')).body).toHaveProperty('nextCursor');
      expect((await call('GET', '/v1/smart-money/wallets?cursor=missing')).status).toBe(400);

      const exp = new Date(Date.now() + 300_000);
      for (const i of [1, 2, 3]) await db.pendingConfirmation.create({ data: { userId: aliceId, idempotencyKey: `pc${i}-${tag}`, kind: 'ENTRY', mint: addr('A'), job: {}, sizeSol: 0.1, quote: {}, expiresAt: exp, createdAt: new Date(Date.now() - i * 1000) } });
      const bobsPc = await db.pendingConfirmation.create({ data: { userId: bobId, idempotencyKey: `pcb-${tag}`, kind: 'ENTRY', mint: addr('A'), job: {}, sizeSol: 0.1, quote: {}, expiresAt: exp } });
      const c1 = await call('GET', '/v1/confirmations?limit=2');
      expect(c1.body.items).toHaveLength(2); expect(c1.body.nextCursor).toBeTruthy();
      const c2 = await call('GET', `/v1/confirmations?limit=2&cursor=${c1.body.nextCursor}`);
      expect(c2.body.items).toHaveLength(1); expect(c2.body.nextCursor).toBeNull();
      expect((await call('GET', `/v1/confirmations?cursor=${bobsPc.id}`)).status).toBe(400); // another user's row
      await db.pendingConfirmation.deleteMany({ where: { userId: { in: [aliceId, bobId] } } });
    });
  });

  describe('own wallets, balances and trade export', () => {
    it('lists only the caller\'s wallets, reads balances through the RPC port, and reports a failed or missing read as unknown, never zero', async () => {
      await db.wallet.create({ data: { userId: aliceId, address: addr('AW1'), kind: 'TRADING' } });
      await db.wallet.create({ data: { userId: aliceId, address: `fail-${tagKey}`.padEnd(40, '1'), kind: 'MAIN' } });
      await db.wallet.create({ data: { userId: bobId, address: addr('BW1'), kind: 'TRADING' } });
      const list = await call('GET', '/v1/me/wallets');
      expect(list.body.items.map((w: { address: string }) => w.address)).toEqual([addr('AW1'), expect.stringContaining('fail')]);
      const bal = await call('GET', '/v1/me/wallets/balances');
      expect(bal.body.available).toBe(true);
      expect(bal.body.items[0]).toMatchObject({ address: addr('AW1'), balanceSol: 2.5, status: 'OK' });
      expect(bal.body.items[1]).toMatchObject({ balanceSol: null, status: 'UNKNOWN' });
      expect(balanceCalls).not.toContain(addr('BW1')); // Bob's wallet was never read for Alice

      const noRpc = await buildApp({ account: { db, verifier: createPrivyVerifier({ appId: APP_ID, verificationKey: await exportSPKI(keys.publicKey) }) } });
      const token = await new SignJWT({}).setProtectedHeader({ alg: 'ES256' }).setSubject(alice).setIssuer('privy.io').setAudience(APP_ID).setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
      const r = await noRpc.inject({ url: '/v1/me/wallets/balances', headers: { authorization: `Bearer ${token}` } });
      expect(r.json()).toMatchObject({ available: false, items: [{ balanceSol: null, status: 'UNKNOWN' }, { balanceSol: null, status: 'UNKNOWN' }] });
      await noRpc.close();
    });

    it('exports only the caller\'s trades as CSV or JSON, neutralizes formulas, honours filters, and audits the export', async () => {
      const tok = await db.token.create({ data: { mint: addr('EXP'), symbol: '=CMD|calc', name: 'bad' } });
      const mkTrade = async (userId: string, key: string, o: { side: 'BUY' | 'SELL'; at: Date; pnl?: number; simulated?: boolean; amount?: number }) => {
        const order = await db.order.create({ data: { userId, tokenId: tok.id, idempotencyKey: `exp-${key}-${tag}`, side: o.side, mode: 'AI_PAPER', status: 'CONFIRMED', sizeSol: 0.2, simulated: o.simulated ?? true } });
        return db.trade.create({ data: { userId, orderId: order.id, side: o.side, mode: 'AI_PAPER', reason: key.startsWith('f') ? '=1+1' : 'entry', expectedPriceUsd: 1, actualPriceUsd: 1.01, slippageBps: 12, realizedPnlSol: o.pnl ?? null, amountSol: o.amount ?? 0.2, simulated: o.simulated ?? true, signature: `exp-${key}-${tag}`, executedAt: o.at } });
      };
      const day = (d: number) => new Date(Date.UTC(2026, 8, d, 12));
      await mkTrade(aliceId, 'a1', { side: 'BUY', at: day(1) });
      await mkTrade(aliceId, 'f2', { side: 'SELL', at: day(2), pnl: -0.15 });
      await mkTrade(aliceId, 'a3', { side: 'SELL', at: day(3), pnl: 0.4, simulated: false });
      await mkTrade(bobId, 'b1', { side: 'BUY', at: day(2) });

      // The window keeps Alice's other trade from the signature-search test (dated today) out of this export.
      const csv = await call('GET', `/v1/trades/export?format=csv&from=${day(1).toISOString()}&to=${day(3).toISOString()}`);
      expect(csv.status).toBe(200);
      expect(csv.headers['content-type']).toContain('text/csv');
      expect(csv.headers['content-disposition']).toMatch(/attachment; filename="trades-\d{4}-\d{2}-\d{2}\.csv"/);
      expect(csv.headers['x-export-truncated']).toBe('false');
      expect(csv.headers['cache-control']).toBe('no-store');
      const lines = csv.text.trim().split('\r\n');
      expect(lines[0]).toBe('tradeId,executedAt,mode,side,simulated,tokenMint,tokenSymbol,reason,amountSol,feeSol,expectedPriceUsd,actualPriceUsd,slippageBps,realizedPnlSol,signature,orderId,positionId');
      expect(lines).toHaveLength(4); // header + Alice's three
      expect(csv.text).not.toContain(`exp-b1-${tag}`); // never Bob's
      expect(csv.text).toContain(`"'=CMD|calc"`); // a formula in the symbol is defused
      expect(csv.text).toContain(`"'=1+1"`);
      expect(csv.text).toContain(',-0.15,'); // a loss stays a plain negative number
      expect(lines[1]).toContain(',2026-09-03'.slice(1)); // newest first

      const json = await call('GET', '/v1/trades/export?format=json&simulated=false');
      expect(json.body).toMatchObject({ count: 1, truncated: false, items: [{ simulated: false, realizedPnlSol: 0.4, tokenSymbol: '=CMD|calc' }] });
      const ranged = await call('GET', `/v1/trades/export?format=json&from=${day(2).toISOString()}&to=${day(2).toISOString()}`);
      expect(ranged.body.count).toBe(1);
      expect((await call('GET', `/v1/trades/export?from=${day(5).toISOString()}&to=${day(1).toISOString()}`, alice, undefined, '10.9.9.8')).status).toBe(400);
      expect((await call('GET', '/v1/trades/export?format=xml', alice, undefined, '10.9.9.8')).status).toBe(400);
      expect(await db.auditLog.count({ where: { userId: aliceId, action: 'trades.exported' } })).toBeGreaterThanOrEqual(2);
    });
  });

  it('shows admins which providers are configured as yes or no, refuses everyone else, and never returns a value', async () => {
    const adminSub = `did:privy:${tag}-admin`;
    const admin = await db.user.create({ data: { privyUserId: adminSub, isAdmin: true } });
    const secret = 'super-secret-key-value';
    const a2 = await buildApp({
      account: { db, verifier: createPrivyVerifier({ appId: APP_ID, verificationKey: await exportSPKI(keys.publicKey) }) },
      connections: () => [{ name: 'helius-rpc', configured: true, purpose: 'Balances' }, { name: 'jupiter', configured: false, purpose: 'Quotes', ...({ apiKey: secret } as object) } as never],
    });
    const get = async (sub: string) => a2.inject({ url: '/v1/admin/connections', headers: { authorization: `Bearer ${await new SignJWT({}).setProtectedHeader({ alg: 'ES256' }).setSubject(sub).setIssuer('privy.io').setAudience(APP_ID).setIssuedAt().setExpirationTime('5m').sign(keys.privateKey)}` } });
    expect((await get(alice)).statusCode).toBe(403);
    const ok = await get(adminSub);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ items: [{ name: 'helius-rpc', configured: true, purpose: 'Balances' }, { name: 'jupiter', configured: false, purpose: 'Quotes' }] });
    expect(ok.body).not.toContain(secret);
    await a2.close();
    await db.auditLog.deleteMany({ where: { userId: admin.id } });
    await db.user.delete({ where: { id: admin.id } });
  });
});
