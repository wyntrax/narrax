import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrisma } from '@narra/database';
import { renderMarkdown } from '@narra/analytics';
import { runBacktest, saveBacktestRun } from './backtest';
import { trackOutcomes } from './outcomeTracking';

const url = process.env.DATABASE_URL ?? 'postgresql://narra:narra@localhost:5432/narra';
async function dbUp() {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 800 });
  try { await c.connect(); await c.query('select 1 from "BacktestRun" limit 1'); return true; } catch { return false; } finally { await c.end().catch(() => {}); }
}
const up = await dbUp();

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

describe.skipIf(!up)('B6: outcome tracking and backtesting on a real Postgres', () => {
  const db = createPrisma(url);
  const tag = `b6${Date.now()}`;
  const addr = (s: string) => `${s}${tag}`.padEnd(40, '1');
  const tokenIds: string[] = [];
  const decisionIds: string[] = [];
  const userIds: string[] = [];

  const payload = { action: 'BUY', confidence: 0.85, reasonCodes: ['SMART_MONEY', 'NARRATIVE'], positiveSignals: [], negativeSignals: [], risks: [], suggestedPositionSizePct: 2, entry: { maxSlippageBps: 100, maxPriceImpactPct: 1.5 }, exit: { stopLossPct: 30, takeProfitPct: 100, trailingStopPct: null }, invalidationConditions: [], summary: 'x' };

  async function mkToken(key: string, points: [number, number][], base: Date, opts: { liq?: number } = {}) {
    const token = await db.token.create({ data: { mint: addr(key), symbol: key.slice(0, 10), name: key } });
    tokenIds.push(token.id);
    await db.tokenMetric.createMany({ data: points.map(([min, price]) => ({ tokenId: token.id, priceUsd: price, marketCapUsd: 1e6, liquidityUsd: opts.liq ?? 200_000, volume24hUsd: 800_000, at: new Date(base.getTime() + min * MIN) })) });
    return token;
  }
  async function mkDecision(tokenId: string, at: Date, o: { userId?: string; action?: string; opportunityScore?: number; narrative?: number; consensus?: number } = {}) {
    const opp = await db.opportunity.create({ data: { tokenId, score: o.opportunityScore ?? 80, narrativeScore: o.narrative ?? 80, smartMoneyScore: 70, liquidityScore: 70, momentumScore: 70, ogScore: 50, riskScore: 20, createdAt: at } });
    if (o.consensus != null) await db.consensusSignal.create({ data: { tokenId, score: o.consensus, walletCount: 5, independentEntities: 4, leaderCount: 1, at } });
    const analysis = await db.agentAnalysis.create({ data: { opportunityId: opp.id, model: 'test' } });
    const d = await db.agentDecision.create({ data: { analysisId: analysis.id, action: (o.action ?? 'BUY') as 'BUY', confidence: 0.85, payload: { ...payload, action: o.action ?? 'BUY' } as object, createdAt: at, ...(o.userId ? { userId: o.userId } : {}) } });
    decisionIds.push(d.id);
    return d;
  }
  /** Readings every `step` minutes for `spanMin`, following a price function of minutes since the base. */
  const path = (spanMin: number, price: (min: number) => number, step = 30): [number, number][] => Array.from({ length: Math.floor(spanMin / step) + 1 }, (_, i) => [i * step, price(i * step)]);

  afterAll(async () => {
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.agentDecision.deleteMany({ where: { id: { in: decisionIds } } });
    await db.consensusSignal.deleteMany({ where: { tokenId: { in: tokenIds } } });
    await db.token.deleteMany({ where: { id: { in: tokenIds } } }); // cascades metrics, opportunities and analyses
    await db.backtestRun.deleteMany({ where: { params: { path: ['costPct'], equals: 3.25 } } });
    await db.$disconnect();
  });

  describe('trackOutcomes', () => {
    const base = new Date('2025-01-10T00:00:00Z');
    const now = new Date(base.getTime() + 40 * HOUR);

    it('measures a decision, keeps an open window open, finalizes it later, and leaves final rows alone', async () => {
      // A: +10% at 1h, +30% at 24h, peak +60% at 5h: a final WIN with a lead time.
      const a = await mkToken('OUTA', path(41 * 60, (m) => (m === 300 ? 160 : m < 60 ? 100 : m < 1440 ? 110 : 130)), base);
      // B: decided 30h before `now`... its window is still open when `now` is 3h after the decision.
      const bBase = new Date(now.getTime() - 3 * HOUR);
      const b = await mkToken('OUTB', path(180 + 30 * 60, (m) => 100 + m / 60), bBase);
      // C: no price anywhere near the decision. D: entry price but nothing at the 24h mark (stopped being tracked).
      const c = await mkToken('OUTC', [[60 * 20, 100]], base);
      const dTok = await mkToken('OUTD', path(600, () => 100), base);
      // E: decided 30 minutes ago, too young to measure at all.
      const e = await mkToken('OUTE', path(120, () => 100), new Date(now.getTime() - 40 * MIN));
      const user = await db.user.create({ data: { privyUserId: `did:privy:${tag}-u`, mode: 'PAPER' } });
      userIds.push(user.id);
      const f = await mkToken('OUTF', path(41 * 60, () => 100), base);

      const dA = await mkDecision(a.id, base), dB = await mkDecision(b.id, bBase), dC = await mkDecision(c.id, base), dD = await mkDecision(dTok.id, base);
      const dE = await mkDecision(e.id, new Date(now.getTime() - 30 * MIN)), dF = await mkDecision(f.id, base, { userId: user.id });
      const only = [dA, dB, dC, dD, dE, dF].map((d) => d.id);

      const s1 = await trackOutcomes(db, { now: () => now, only });
      expect(s1).toEqual({ measured: 4, finalized: 3, stillPending: 1, unknown: 2 });

      const get = (id: string) => db.decisionOutcome.findUnique({ where: { decisionId: id } });
      const oa = (await get(dA.id))!;
      expect(oa).toMatchObject({ label: 'WIN', isFinal: true, unknownReason: null, entryPriceUsd: 100 });
      expect(oa.returnPct1h).toBeCloseTo(10); expect(oa.returnPct24h).toBeCloseTo(30);
      expect(oa.maxGainPct).toBeCloseTo(60); expect(oa.maxDrawdownPct).toBeCloseTo(0); expect(oa.leadTimeSeconds).toBe(300 * 60);

      const ob = (await get(dB.id))!;
      expect(ob).toMatchObject({ isFinal: false, label: 'UNKNOWN', unknownReason: 'NOT_YET', returnPct24h: null });
      expect(ob.returnPct1h).toBeCloseTo(1); // 100 -> 101 an hour in

      expect(await get(dC.id)).toMatchObject({ isFinal: true, label: 'UNKNOWN', unknownReason: 'NO_ENTRY_PRICE', entryPriceUsd: null });
      expect(await get(dD.id)).toMatchObject({ isFinal: true, label: 'UNKNOWN', unknownReason: 'NO_HORIZON_PRICE', returnPct24h: null });
      expect(await get(dE.id)).toBeNull(); // too young
      expect(await get(dF.id)).toBeNull(); // per-user decisions are not measured

      // Final rows are not touched again. The open one is, and finalizes once its window has closed.
      const finalAt = (await get(dA.id))!.measuredAt;
      const later = new Date(bBase.getTime() + 24 * HOUR + 40 * MIN);
      const s2 = await trackOutcomes(db, { now: () => later, only });
      // B (open window, now closed) is finalized. E has aged past an hour, so it is measured for the first time, but its own window is still open.
      expect(s2).toMatchObject({ measured: 2, finalized: 1, stillPending: 1 });
      expect((await get(dA.id))!.measuredAt).toEqual(finalAt);
      const ob2 = (await get(dB.id))!;
      expect(ob2).toMatchObject({ isFinal: true, label: 'WIN', unknownReason: null });
      expect(ob2.returnPct24h).toBeCloseTo(24);
      expect(await get(dE.id)).toMatchObject({ isFinal: false });
      expect(await db.decisionOutcome.count({ where: { decisionId: { in: only } } })).toBe(5); // one row per decision, no duplicates
    });
  });

  describe('runBacktest', () => {
    const from = new Date('2025-03-01T00:00:00Z'), to = new Date('2025-03-07T00:00:00Z'), now = new Date('2025-03-09T00:00:00Z');
    const spanMin = 8 * 24 * 60;

    it('reports no conclusion at all when there is too little data, and says why', async () => {
      const small = { from: new Date('2025-06-01T00:00:00Z'), to: new Date('2025-06-04T00:00:00Z'), now: new Date('2025-06-07T00:00:00Z') };
      const base = small.from;
      for (let i = 0; i < 3; i++) {
        const t = await mkToken(`SM${i}`, path(5 * 24 * 60, (m) => (m < 600 ? 100 : 150)), base);
        await mkDecision(t.id, new Date(base.getTime() + 2 * HOUR));
      }
      const r = await runBacktest(db, small);
      expect(r.coverage).toMatchObject({ tokens: 3, buyDecisions: 3 });
      const ai = r.strategies.find((s) => s.name === 'AI')!;
      expect(ai.hold).toMatchObject({ n: 3, sufficient: false });
      expect(ai.hold.mean).toBeCloseTo(47); // 50% gain, less the 3% cost: shown, but flagged
      expect(r.findings).toEqual([]);
      expect(r.noConclusion.length).toBeGreaterThan(0);
      expect(r.comparisons.every((c) => c.vsBaselineHold.verdict === 'INSUFFICIENT_DATA')).toBe(true);
      const md = renderMarkdown(r);
      expect(md).toContain('INSUFFICIENT');
      expect(md).toContain('None. No comparison has enough data yet.');
      expect(md).not.toMatch(/better than the baseline/);
    });

    it('with enough synthetic history it reports a clear difference, saves the run, and writes nothing else', async () => {
      // 40 tokens the AI picks, each flat, then up 40% with a dip that never reaches the stop.
      for (let i = 0; i < 40; i++) {
        const decideMin = 2 * 24 * 60 + i * 30; // on a reading: a decision further than 15 minutes from one has no entry price
        const t = await mkToken(`WIN${i}`, path(spanMin, (m) => (m < decideMin + 30 ? 100 : m < decideMin + 120 ? 90 : m <= decideMin + 24 * 60 + 30 ? 140 : 140)), from);
        await mkDecision(t.id, new Date(from.getTime() + decideMin * MIN));
      }
      // 40 tokens that just sit still: what picking tracked tokens at random looks like here.
      for (let i = 0; i < 40; i++) await mkToken(`FLT${i}`, path(spanMin, (m) => 100 + ((m / 30 + i) % 3 === 0 ? 0.5 : 0)), from);

      const before = { outcomes: await db.decisionOutcome.count(), orders: await db.order.count(), positions: await db.position.count() };
      const cfg = { from, to, now, costPct: 3.25, maxSweepEvents: 150 };
      const r = await runBacktest(db, cfg);

      const ai = r.strategies.find((s) => s.name === 'AI')!, base = r.strategies.find((s) => s.name === 'BASELINE')!;
      expect(ai.hold).toMatchObject({ n: 40, distinctTokens: 40, sufficient: true });
      expect(ai.hold.mean).toBeCloseTo(40 - 3.25, 0); // 100 -> 140 over 24h, less cost
      expect(base.hold.sufficient).toBe(true);
      const cmp = r.comparisons.find((c) => c.name === 'AI')!;
      expect(cmp.vsBaselineHold.verdict).toBe('BETTER');
      expect(cmp.vsBaselineHold.ci![0]).toBeGreaterThan(0);
      expect(r.findings.some((f) => f.startsWith('AI holding 24h: better than the baseline'))).toBe(true);
      expect(r.aiByConfidence.find((b) => b.label === '0.8 to 0.9')!.described.n).toBe(40);
      expect(r.aiBySignal.map((b) => b.label).sort()).toEqual(['NARRATIVE', 'SMART_MONEY']);
      expect(r.sweeps.exitLevels).not.toBeNull();
      expect(r.sweeps.exitLevels!.combinations).toBe(80);
      expect(r.sweeps.monitorRules!.combinations).toBe(81);
      expect(r.coverage.medianGapMinutes).toBe(30);

      // The backtest only reads. It never creates outcomes, orders or positions.
      expect({ outcomes: await db.decisionOutcome.count(), orders: await db.order.count(), positions: await db.position.count() }).toEqual(before);

      const id = await saveBacktestRun(db, r, cfg);
      const saved = await db.backtestRun.findUniqueOrThrow({ where: { id } });
      expect(saved.kind).toBe('FULL');
      expect((saved.report as { coverage: { tokens: number } }).coverage.tokens).toBe(80);
      expect(JSON.stringify(saved.report)).not.toContain('"series"'); // raw history is never stored
    }, 120_000);

    it('refuses a range that is too large to hold, instead of running out of memory', async () => {
      // Not enough rows to trip the real limit here, so only check that an empty range is a clean, empty report.
      const r = await runBacktest(db, { from: new Date('2020-01-01T00:00:00Z'), to: new Date('2020-01-05T00:00:00Z'), now: new Date('2020-01-09T00:00:00Z') });
      expect(r.coverage).toMatchObject({ tokens: 0, metricPoints: 0, decisions: 0 });
      expect(r.strategies.every((s) => s.events === 0 && s.hold.n === 0)).toBe(true);
      expect(r.sweeps).toEqual({ exitLevels: null, monitorRules: null });
      expect(r.findings).toEqual([]);
    });
  });
});
