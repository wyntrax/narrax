import pg from 'pg';
import { SignJWT, exportSPKI, generateKeyPair } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrisma } from '@narra/database';
import { buildApp } from './app';
import { createPrivyVerifier } from './auth';

const APP_ID = 'test-app-id';
const { publicKey, privateKey } = await generateKeyPair('ES256');
const verifier = createPrivyVerifier({ appId: APP_ID, verificationKey: await exportSPKI(publicKey) });
const sign = (sub: string) => new SignJWT({}).setProtectedHeader({ alg: 'ES256' }).setSubject(sub).setIssuer('privy.io').setAudience(APP_ID).setIssuedAt().setExpirationTime('5m').sign(privateKey);

const url = process.env.DATABASE_URL ?? 'postgresql://narra:narra@localhost:5432/narra';
async function dbUp() {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 800 });
  try { await c.connect(); await c.query('select 1 from "BacktestRun" limit 1'); return true; } catch { return false; } finally { await c.end().catch(() => {}); }
}
const up = await dbUp();
const HOUR = 3_600_000, DAY = 24 * HOUR;

describe.skipIf(!up)('analytics endpoints (needs Postgres)', () => {
  const db = createPrisma(url);
  const tag = `an${Date.now()}`;
  const alice = `did:privy:alice-${tag}`, bob = `did:privy:bob-${tag}`, boss = `did:privy:boss-${tag}`;
  const NOW = new Date('2031-06-15T12:00:00Z'); // far from real data in a shared database, so only this test's rows fall in range
  const tokenIds: string[] = [], decisionIds: string[] = [], runIds: string[] = [], userIds: string[] = [];
  let app: Awaited<ReturnType<typeof buildApp>>;
  let seq = 0;

  const http = async (path: string, sub: string | null) => {
    const res = await app.inject({ method: 'GET', url: path, headers: sub ? { authorization: `Bearer ${await sign(sub)}` } : {} });
    return { status: res.statusCode, body: res.json() };
  };
  const uid = async (sub: string) => { const id = (await http('/v1/me', sub)).body.id as string; if (!userIds.includes(id)) userIds.push(id); return id; };
  // base58 has no 0, O, I or l. Each is swapped for a different letter, so two names that differ only there stay different.
  const mint = (k: string) => `${k}${tag}`.padEnd(40, '1').replace(/0/g, 'x').replace(/O/g, 'y').replace(/I/g, 'z').replace(/l/g, 'w');

  /** A global decision with its outcome. `ret` is the 24h return in percent; null means the 24h price is unknown. */
  async function seed(o: { token: string; at: Date; ret: number | null; confidence?: number; codes?: string[]; action?: string; final?: boolean; symbol?: string }) {
    const token = await db.token.upsert({ where: { mint: mint(o.token) }, create: { mint: mint(o.token), symbol: o.symbol ?? o.token.slice(0, 8), name: o.token }, update: {} });
    if (!tokenIds.includes(token.id)) tokenIds.push(token.id);
    const opp = await db.opportunity.create({ data: { tokenId: token.id, score: 80, narrativeScore: 70, smartMoneyScore: 60, liquidityScore: 50, momentumScore: 40, ogScore: 30, riskScore: 20, createdAt: o.at } });
    const analysis = await db.agentAnalysis.create({ data: { opportunityId: opp.id, model: 'test' } });
    const payload = { action: o.action ?? 'BUY', confidence: o.confidence ?? 0.85, reasonCodes: o.codes ?? ['SMART_MONEY'], positiveSignals: [], negativeSignals: [], risks: [], suggestedPositionSizePct: 2, entry: { maxSlippageBps: 100, maxPriceImpactPct: 1.5 }, exit: { stopLossPct: 30, takeProfitPct: 100, trailingStopPct: null }, invalidationConditions: [], summary: 's' };
    const d = await db.agentDecision.create({ data: { analysisId: analysis.id, action: (o.action ?? 'BUY') as 'BUY', confidence: o.confidence ?? 0.85, payload, createdAt: new Date(o.at.getTime() + ++seq) } });
    decisionIds.push(d.id);
    const label = o.ret == null ? 'UNKNOWN' : o.ret >= 10 ? 'WIN' : o.ret <= -10 ? 'LOSS' : 'FLAT';
    await db.decisionOutcome.create({ data: { decisionId: d.id, label, returnPct24h: o.ret, returnPct1h: o.ret == null ? null : o.ret / 4, maxGainPct: o.ret == null ? null : Math.max(o.ret, 0), maxDrawdownPct: 0, leadTimeSeconds: o.ret != null && o.ret >= 10 ? 7200 : null, entryPriceUsd: 1, isFinal: o.final ?? true, unknownReason: o.ret == null ? 'NO_HORIZON_PRICE' : null } });
    return d;
  }

  beforeAll(async () => { app = await buildApp({ account: { db, verifier, now: () => NOW } }); });
  afterAll(async () => {
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.agentDecision.deleteMany({ where: { id: { in: decisionIds } } });
    await db.backtestRun.deleteMany({ where: { id: { in: runIds } } });
    await db.token.deleteMany({ where: { id: { in: tokenIds } } });
    await db.$disconnect();
  });

  it('requires sign-in on every endpoint, and admin on the full backtest reports', async () => {
    for (const p of ['/v1/analytics/decisions/summary', '/v1/analytics/signals', '/v1/analytics/decisions/outcomes', '/v1/analytics/me/performance', '/v1/analytics/me/equity', '/v1/analytics/backtest-summary', '/v1/analytics/backtests', '/v1/analytics/backtests/x']) {
      expect((await http(p, null)).status, p).toBe(401);
    }
    await uid(alice);
    expect((await http('/v1/analytics/backtests', alice)).status).toBe(403);
    expect((await http('/v1/analytics/backtests/x', alice)).status).toBe(403);
  });

  it('validates input', async () => {
    await uid(alice);
    for (const p of ['/v1/analytics/decisions/summary?days=0', '/v1/analytics/decisions/summary?days=9999', '/v1/analytics/decisions/summary?action=NUKE', '/v1/analytics/decisions/summary?costPct=-1', '/v1/analytics/decisions/outcomes?limit=1000', '/v1/analytics/decisions/outcomes?cursor=%%%', '/v1/analytics/decisions/outcomes?cursor=' + Buffer.from('["nope","x"]').toString('base64url'), '/v1/analytics/me/equity?simulated=maybe']) {
      expect((await http(p, alice)).status, p).toBe(400);
    }
  });

  it('says plainly that a handful of outcomes is not enough, and still shows them', async () => {
    await uid(alice);
    const few: string[] = [];
    for (let i = 0; i < 4; i++) few.push((await seed({ token: `FEW${i}`, at: new Date(NOW.getTime() - (5 + i) * DAY), ret: 30 })).id);
    const r = await http('/v1/analytics/decisions/summary?days=30', alice);
    expect(r.status).toBe(200);
    expect(r.body.decisions).toMatchObject({ independent: 4, final: 4, unknown: 0, pending: 0 });
    expect(r.body.labels).toEqual({ WIN: 4, LOSS: 0, FLAT: 0 });
    expect(r.body.returns).toMatchObject({ n: 4, distinctTokens: 4, sufficient: false });
    expect(r.body.returns.mean).toBeCloseTo(27); // 30% less the 3% cost
    expect(r.body.evidence).toMatchObject({ sufficient: false });
    expect(r.body.evidence.note).toContain('INSUFFICIENT DATA');
    expect(r.body.caveats.length).toBeGreaterThan(0);
    await db.agentDecision.deleteMany({ where: { id: { in: few } } }); // these would otherwise count in the next test's window
  });

  it('with enough independent events it reports sufficient, counts unknown and pending separately, and drops same-token overlaps', async () => {
    await uid(alice);
    const base = new Date(NOW.getTime() - 100 * DAY); // an earlier window, kept apart from the previous test's rows
    for (let i = 0; i < 40; i++) await seed({ token: `MANY${i}`, at: new Date(base.getTime() + i * HOUR), ret: i % 4 === 0 ? -20 : 40, confidence: 0.65 + (i % 3) * 0.1, codes: i % 2 ? ['SMART_MONEY'] : ['SMART_MONEY', 'NARRATIVE'] });
    await seed({ token: 'MANY0', at: new Date(base.getTime() + 3 * HOUR), ret: 500 }); // same token within 24h of an earlier decision: not independent
    await seed({ token: 'GONE', at: new Date(base.getTime() + 50 * HOUR), ret: null }); // final, but no 24h price
    await seed({ token: 'OPEN', at: new Date(base.getTime() + 51 * HOUR), ret: null, final: false }); // window still open
    const r = await http('/v1/analytics/decisions/summary?days=120', alice);
    expect(r.status).toBe(200);
    expect(r.body.decisions).toMatchObject({ independent: 42, final: 41, pending: 1, unknown: 1 });
    expect(r.body.decisions.unknownRate).toBeCloseTo(1 / 41);
    expect(r.body.labels).toEqual({ WIN: 30, LOSS: 10, FLAT: 0 });
    expect(r.body.returns).toMatchObject({ n: 40, distinctTokens: 40, sufficient: true, note: null });
    expect(r.body.returns.mean).toBeCloseTo((30 * 37 + 10 * -23) / 40);
    expect(r.body.returns.winRateCi[0]).toBeLessThan(0.75);
    expect(r.body.medianLeadTimeSeconds).toBe(7200);
    expect(r.body.byConfidence.reduce((a: number, b: { described: { n: number } }) => a + b.described.n, 0)).toBe(40);
    const sig = await http('/v1/analytics/signals?days=120', alice);
    expect(sig.body.byReasonCode.map((b: { label: string }) => b.label).sort()).toEqual(['NARRATIVE', 'SMART_MONEY']);
    expect(sig.body.byReasonCode.find((b: { label: string }) => b.label === 'SMART_MONEY').described.n).toBe(40);
    expect(sig.body.byReasonCode.find((b: { label: string }) => b.label === 'NARRATIVE').described.n).toBe(20);
    // A different action is a different set.
    expect((await http('/v1/analytics/decisions/summary?days=120&action=WATCH', alice)).body.decisions.independent).toBe(0);
  });

  it('pages through outcomes with a cursor, newest first, with no gaps or repeats, and a symbol sent as plain text', async () => {
    await uid(alice);
    const base = new Date(NOW.getTime() - 12 * HOUR); // newer than every other row in this test, so these are the first pages
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) ids.push((await seed({ token: `PG${i}`, at: new Date(base.getTime() + i * 10 * 60_000), ret: 12, symbol: i === 6 ? '<img src=x>' : undefined })).id);
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page++) {
      const r: { body: { items: { decisionId: string; token: { symbol: string } }[]; nextCursor: string | null } } = await http(`/v1/analytics/decisions/outcomes?limit=3&final=true${cursor ? `&cursor=${cursor}` : ''}`, alice);
      const mine = r.body.items.filter((i) => ids.includes(i.decisionId));
      seen.push(...mine.map((i) => i.decisionId));
      if (!r.body.nextCursor) break;
      cursor = r.body.nextCursor;
      if (seen.length >= 7) break;
    }
    expect(new Set(seen).size).toBe(seen.length); // no repeats
    expect(seen.length).toBe(7);                  // no gaps
    expect(seen.slice(0, 7)).toEqual([...ids].reverse());
    const first = await http('/v1/analytics/decisions/outcomes?limit=1', alice);
    expect(first.body.items[0]).toHaveProperty('token.symbol');
    expect(first.body.items[0]).not.toHaveProperty('payload'); // the model's own output is not exposed here
  });

  it("the user's own performance counts only their own trades, with paper and real kept apart", async () => {
    const a = await uid(alice), b = await uid(bob);
    const token = await db.token.upsert({ where: { mint: mint('PERF') }, create: { mint: mint('PERF'), symbol: 'PERF', name: 'perf' }, update: {} });
    tokenIds.push(token.id);
    const mk = async (userId: string, simulated: boolean, buyFee: number, sellPnl: number, day: number, closed: boolean) => {
      const pos = await db.position.create({ data: { userId, tokenId: token.id, status: closed ? 'CLOSED' : 'OPEN', mode: simulated ? 'PAPER' : 'AUTO', simulated, entryPriceUsd: 1, sizeSol: 0.1, entryContext: {}, openedAt: new Date(NOW.getTime() - day * DAY) } });
      const at = new Date(NOW.getTime() - day * DAY), key = `${tag}-${++seq}`;
      const buy = await db.order.create({ data: { userId, tokenId: token.id, idempotencyKey: `buy-${key}`, side: 'BUY', mode: simulated ? 'AI_PAPER' : 'AI_AUTO', status: 'CONFIRMED', sizeSol: 0.1, simulated } });
      await db.trade.create({ data: { userId, orderId: buy.id, positionId: pos.id, side: 'BUY', mode: simulated ? 'AI_PAPER' : 'AI_AUTO', reason: 't', expectedPriceUsd: 1, actualPriceUsd: 1, slippageBps: 0, realizedPnlSol: -buyFee, feeSol: buyFee, amountSol: 0.1, simulated, signature: `sig-b-${key}`, executedAt: at } });
      if (closed) {
        const sell = await db.order.create({ data: { userId, tokenId: token.id, idempotencyKey: `sell-${key}`, side: 'SELL', mode: simulated ? 'AI_PAPER' : 'AI_AUTO', status: 'CONFIRMED', sizeSol: 0.1, simulated } });
        await db.trade.create({ data: { userId, orderId: sell.id, positionId: pos.id, side: 'SELL', mode: simulated ? 'AI_PAPER' : 'AI_AUTO', reason: 't', expectedPriceUsd: 1, actualPriceUsd: 1, slippageBps: 0, realizedPnlSol: sellPnl, feeSol: buyFee, amountSol: 0.1, simulated, signature: `sig-s-${key}`, executedAt: new Date(at.getTime() + HOUR) } });
      }
    };
    await mk(a, true, 0.002, 0.05, 2, true);   // a paper win:  -0.002 + 0.05
    await mk(a, true, 0.002, -0.03, 3, true);  // a paper loss: -0.002 - 0.03
    await mk(a, true, 0.002, 0, 1, false);     // a paper position still open: only its entry fee so far
    await mk(a, false, 0.003, 0.2, 4, true);   // a real win
    await mk(b, true, 0.002, 0.9, 2, true);    // someone else's, must never show up for alice
    const r = await http('/v1/analytics/me/performance?days=30', alice);
    expect(r.status).toBe(200);
    expect(r.body.paper.trades).toBe(5);
    expect(r.body.paper.realizedPnlSol).toBeCloseTo(-0.002 + 0.05 - 0.002 - 0.03 - 0.002);
    expect(r.body.paper.closedPositions).toMatchObject({ count: 2, wins: 1, sufficient: false });
    expect(r.body.paper.closedPositions.winRate).toBeCloseTo(0.5);
    expect(r.body.paper.closedPositions.note).toContain('INSUFFICIENT DATA');
    expect(r.body.real).toMatchObject({ trades: 2 });
    expect(r.body.real.realizedPnlSol).toBeCloseTo(-0.003 + 0.2);
    expect(r.body.paper.daily.map((d: { day: string }) => d.day)).toEqual([...r.body.paper.daily.map((d: { day: string }) => d.day)].sort());
    const rb = await http('/v1/analytics/me/performance?days=30', bob);
    expect(rb.body.paper.trades).toBe(2);
    expect(rb.body.real.trades).toBe(0);
    expect(rb.body.paper.realizedPnlSol).toBeCloseTo(-0.002 + 0.9);
  });

  it('equity is the user\'s own snapshots only, by side, with the drawdown from their peak', async () => {
    const a = await uid(alice), b = await uid(bob);
    const snap = (userId: string, simulated: boolean, v: number, h: number) => db.portfolioSnapshot.create({ data: { userId, simulated, totalValueSol: v, at: new Date(NOW.getTime() - h * HOUR) } });
    await snap(a, true, 10, 30); await snap(a, true, 12, 20); await snap(a, true, 9, 10); await snap(a, false, 3, 10); await snap(b, true, 99, 10);
    const r = await http('/v1/analytics/me/equity?days=7', alice);
    expect(r.body).toMatchObject({ simulated: true, peakSol: 12, latestSol: 9, downsampled: false });
    expect(r.body.drawdownPct).toBeCloseTo(25);
    expect(r.body.points.map((p: { valueSol: number }) => p.valueSol)).toEqual([10, 12, 9]);
    expect((await http('/v1/analytics/me/equity?days=7&simulated=false', alice)).body.points.map((p: { valueSol: number }) => p.valueSol)).toEqual([3]);
    expect((await http('/v1/analytics/me/equity?days=7', bob)).body.peakSol).toBe(99);
    const empty = await http('/v1/analytics/me/equity?days=7&simulated=false', bob); // bob has no real snapshots
    expect(empty.body).toMatchObject({ points: [], peakSol: null, drawdownPct: null });
  });

  describe('saved backtests', () => {
    const report = { generatedAt: '2031-06-01T00:00:00.000Z', coverage: { tokens: 3 }, strategies: [{ name: 'AI', events: 3, holdItems: [{ tokenId: 'a', ret: 1 }], ruleItems: [{ tokenId: 'a', ret: 2 }], hold: { n: 3, sufficient: false } }], findings: ['A finding.'], noConclusion: ['Not enough data.', 'Still not enough.'] };
    it('anyone signed in sees the headline; only an admin sees the full report, without raw per-event arrays', async () => {
      const none = await http('/v1/analytics/backtest-summary', alice);
      const existing = await db.backtestRun.count({ where: { kind: 'FULL' } });
      if (existing === 0) expect(none.body).toEqual({ available: false });
      const run = await db.backtestRun.create({ data: { kind: 'FULL', params: { costPct: 3 }, report, createdAt: new Date(NOW.getTime() + 365 * DAY) } });
      runIds.push(run.id);
      const s = await http('/v1/analytics/backtest-summary', alice);
      expect(s.body).toMatchObject({ available: true, id: run.id, findings: ['A finding.'], noConclusion: ['Not enough data.', 'Still not enough.'] });
      expect(JSON.stringify(s.body)).not.toContain('holdItems');
      const adminId = await uid(boss);
      await db.user.update({ where: { id: adminId }, data: { isAdmin: true } });
      const list = await http('/v1/analytics/backtests?limit=5', boss);
      expect(list.status).toBe(200);
      expect(list.body.items[0]).toMatchObject({ id: run.id, findings: 1, noConclusion: 2 });
      const detail = await http(`/v1/analytics/backtests/${run.id}`, boss);
      expect(detail.status).toBe(200);
      expect(detail.body.report.strategies[0]).toMatchObject({ name: 'AI', events: 3 });
      expect(detail.body.report.strategies[0]).not.toHaveProperty('holdItems');
      expect(detail.body.report.strategies[0]).not.toHaveProperty('ruleItems');
      expect(detail.body.gates).toEqual({ minSample: 30, minDistinctTokens: 15 });
      expect((await http('/v1/analytics/backtests/nope', boss)).status).toBe(404);
      expect((await http('/v1/analytics/backtests/bad id!', boss)).status).toBe(400);
      expect((await db.backtestRun.findUniqueOrThrow({ where: { id: run.id } })).report).toMatchObject({ strategies: [{ holdItems: [{ tokenId: 'a', ret: 1 }] }] }); // the stored report is untouched
    });
  });
});
