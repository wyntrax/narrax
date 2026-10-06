import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrisma } from '@narra/database';
import { ExecutionJobSchema, type ExecutionJob } from '@narra/queue';
import { GLOBAL_LIMITS } from '@narra/risk';
import { WSOL_MINT, type Quote } from '@narra/solana';
import { PAPER_FEE_SOL, PAPER_START_BALANCE_SOL, buildExitDecision, exitKey } from '@narra/trading';
import { fanOutEntries, fanOutExits } from './fanOut';
import { expirePendingConfirmations, runExecution } from './outcomes';
import { makeExecutionStore, type ChainPorts } from './prismaStores';
import { makePaperPorts } from './paperLedger';
import { writePortfolioSnapshots } from './snapshots';
import type { ExecutionDeps } from './execution';

const url = process.env.DATABASE_URL ?? 'postgresql://narra:narra@localhost:5432/narra';
async function dbUp() {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 800 });
  try { await c.connect(); await c.query('select 1 from "PositionExit" limit 1'); return true; } catch { return false; } finally { await c.end().catch(() => {}); }
}
const up = await dbUp();

describe.skipIf(!up)('B4: fan-out, paper trading and confirmations on a real Postgres', () => {
  const db = createPrisma(url);
  const tag = `b4${Date.now()}`;
  const MIN = 60_000;
  const T0 = new Date('2026-10-03T12:00:00Z');
  let clock = T0;
  const at = (mins: number) => new Date(clock.getTime() + mins * MIN);
  const advance = (mins: number) => { clock = at(mins); };
  const addr = (s: string) => `${s}${tag}`.padEnd(40, '1');
  const userIds: string[] = [];
  let seq = 0;
  let tick = 0; // keeps metric timestamps unique per token, so "latest" is never a tie

  // A fake Jupiter. Buys return BUY_RATE token units per lamport; sells return SELL_RATE lamports per token unit.
  const rate = { buy: 1000n, sell: 400n, impact: 0.5 };
  const quotes: Quote[] = [];
  const jupiter: ExecutionDeps['jupiter'] = {
    async getQuote({ inputMint, outputMint, amount }) {
      const buy = inputMint === WSOL_MINT;
      const q: Quote = { inputMint, outputMint, inAmount: amount.toString(), outAmount: (buy ? amount * rate.buy : amount * rate.sell).toString(), priceImpactPct: rate.impact, slippageBps: 100, fetchedAt: clock, raw: {} };
      quotes.push(q);
      return q;
    },
  };
  const noChain: ChainPorts = {
    getSolBalance: async () => { throw new Error('no chain in tests'); }, getPortfolioValueSol: async () => { throw new Error('no chain in tests'); }, getTokenBaseUnits: async () => { throw new Error('no chain in tests'); },
  };
  const deps = (): ExecutionDeps => ({ jupiter, ...makeExecutionStore(db, noChain, () => clock), now: () => clock });
  const exec = (job: ExecutionJob) => runExecution(db, ExecutionJobSchema.parse(job), deps());
  const queue = () => { const jobs: ExecutionJob[] = []; return { jobs, enqueue: async (j: ExecutionJob) => { jobs.push(j); } }; };

  const mkUser = async (o: { mode?: 'SHADOW' | 'PAPER' | 'SEMI_AUTO' | 'AUTO'; perm?: Partial<{ aiTradingEnabled: boolean; agentPaused: boolean; revokedAt: Date | null }> | null; profile?: { maxPerTradeSol: number } } = {}) => {
    const user = await db.user.create({ data: { privyUserId: `did:privy:${tag}-${++seq}`, mode: o.mode ?? 'PAPER' } });
    userIds.push(user.id);
    if (o.perm !== null) await db.tradingPermission.create({ data: { userId: user.id, aiTradingEnabled: true, ...o.perm } });
    if (o.profile) await db.riskProfile.create({ data: { userId: user.id, preset: 'CUSTOM', maxPerTradeSol: o.profile.maxPerTradeSol, maxDailyAllocationSol: 1, maxTokenExposurePct: 15, maxOpenPositions: 5, maxDailyLossPct: 8, minConfidence: 0.75 } });
    return user.id;
  };
  const metric = (tokenId: string, price: number, mins: number) => db.tokenMetric.create({ data: { tokenId, priceUsd: price, marketCapUsd: 1e6, liquidityUsd: 600_000, volume24hUsd: 900_000, at: new Date(at(mins).getTime() + ++tick) } });
  const mkToken = async (key: string, o: { price?: number; metricMins?: number } = {}) => {
    const token = await db.token.create({ data: { mint: addr(key), symbol: `S${key}`.slice(0, 12), name: `${key} token` } });
    await metric(token.id, o.price ?? 1, o.metricMins ?? -1);
    await db.consensusSignal.create({ data: { tokenId: token.id, score: 80, walletCount: 5, independentEntities: 4, leaderCount: 2 } });
    const opp = await db.opportunity.create({ data: { tokenId: token.id, score: 90, narrativeScore: 80, smartMoneyScore: 80, liquidityScore: 80, momentumScore: 80, ogScore: 80, riskScore: 20 } });
    const analysis = await db.agentAnalysis.create({ data: { opportunityId: opp.id, model: 'test' } });
    return { token, analysisId: analysis.id };
  };
  const payload = (over: Record<string, unknown> = {}) => ({
    action: 'BUY', confidence: 0.9, reasonCodes: ['SMART_MONEY'], positiveSignals: [], negativeSignals: [], risks: [], suggestedPositionSizePct: 2,
    entry: { maxSlippageBps: 100, maxPriceImpactPct: 1.5 }, exit: { stopLossPct: 30, takeProfitPct: 100, trailingStopPct: null }, invalidationConditions: [], summary: 'test', ...over,
  });
  const mkDecision = (analysisId: string, o: { ageMins?: number; payload?: Record<string, unknown> } = {}) =>
    db.agentDecision.create({ data: { analysisId, action: 'BUY', confidence: 0.9, payload: payload(o.payload) as object, createdAt: new Date(at(-(o.ageMins ?? 1)).getTime() + ++tick) } });
  const entryJob = (userId: string, decisionId: string, mint: string, key: string): ExecutionJob => ({ userId, decisionId, idempotencyKey: key, mint, decision: payload() as ExecutionJob['decision'] });
  const run = (userId: string, decisionId: string) => fanOutEntries(db, { chain: null, enqueue: async () => {}, now: () => clock, only: { userIds: [userId], decisionIds: [decisionId] } });
  const runWith = (q: ReturnType<typeof queue>, userId: string, decisionId: string) => fanOutEntries(db, { chain: null, enqueue: q.enqueue, now: () => clock, only: { userIds: [userId], decisionIds: [decisionId] } });
  const counts = async (userId: string) => ({
    orders: await db.order.count({ where: { userId } }), trades: await db.trade.count({ where: { userId } }),
    positions: await db.position.count({ where: { userId } }), open: await db.position.count({ where: { userId, status: 'OPEN' } }),
  });
  /** Opens a paper position for a user through the real path: fan-out job, Governor, fresh quote, paper fill. */
  const openPosition = async (userId: string, key: string, price = 1) => {
    const { token, analysisId } = await mkToken(key, { price });
    const decision = await mkDecision(analysisId);
    const q = queue();
    await runWith(q, userId, decision.id);
    expect(q.jobs).toHaveLength(1);
    const outcome = await exec(q.jobs[0]!);
    expect(outcome.status).toBe('simulated');
    const position = await db.position.findFirstOrThrow({ where: { userId, tokenId: token.id } });
    return { token, decision, position, job: q.jobs[0]! };
  };
  const evaluation = (positionId: string, action: 'REDUCE' | 'SELL', codes: string[], mins = -1, fractionPct = 50) =>
    db.positionEvaluation.create({ data: { positionId, action, fractionPct, signals: codes.map((code) => ({ code, level: action, detail: 'x' })), unavailable: [], blind: false, createdAt: new Date(at(mins).getTime() + ++tick) } });

  beforeAll(() => { /* rows are created per test with a unique tag */ });
  afterAll(async () => {
    await db.user.deleteMany({ where: { id: { in: userIds } } }); // cascades permissions, profiles, orders, trades, positions, exits, confirmations, snapshots
    await db.agentDecision.deleteMany({ where: { analysis: { opportunity: { token: { mint: { contains: tag } } } } } });
    await db.token.deleteMany({ where: { mint: { contains: tag } } }); // cascades metrics, signals, opportunities, analyses
    await db.$disconnect();
  });

  describe('entry fan-out and the paper entry', () => {
    it('turns a fresh BUY decision into one paper order, trade and position, with the exit rules captured', async () => {
      const userId = await mkUser();
      const { token, analysisId } = await mkToken('ENT', { price: 2 });
      const decision = await mkDecision(analysisId);
      const q = queue();
      const s = await runWith(q, userId, decision.id);
      expect(s.enqueued).toBe(1);
      expect(q.jobs[0]).toMatchObject({ userId, decisionId: decision.id, idempotencyKey: `entry:${decision.id}:${userId}` });

      quotes.length = 0;
      const outcome = await exec(q.jobs[0]!);
      expect(outcome.status).toBe('simulated');
      const quote = quotes[0]!;

      const order = await db.order.findFirstOrThrow({ where: { userId } });
      expect(order).toMatchObject({ side: 'BUY', mode: 'AI_PAPER', status: 'CONFIRMED', simulated: true, idempotencyKey: q.jobs[0]!.idempotencyKey });
      const position = await db.position.findFirstOrThrow({ where: { userId } });
      expect(position).toMatchObject({ status: 'OPEN', mode: 'PAPER', simulated: true, openKey: `${userId}:${token.id}`, reduceCount: 0 });
      expect(position.baseUnits?.toFixed(0)).toBe(quote.outAmount); // units come from the quote
      expect(Number(position.sizeSol)).toBeCloseTo(Number(order.sizeSol), 9);
      expect(Number(position.entryPriceUsd)).toBeCloseTo(2 * (1 + rate.impact / 100), 9); // market price worsened by impact
      expect(position.entryContext).toMatchObject({ version: 1, exit: { stopLossPct: 30, takeProfitPct: 100 } });
      const trade = await db.trade.findFirstOrThrow({ where: { userId } });
      expect(trade).toMatchObject({ side: 'BUY', simulated: true, mode: 'AI_PAPER', signature: `paper:${order.id}`, positionId: position.id });
      expect(Number(trade.feeSol)).toBeCloseTo(PAPER_FEE_SOL, 9);
      expect(Number(trade.realizedPnlSol)).toBeCloseTo(-PAPER_FEE_SOL, 9);
      expect(Number(trade.slippageBps)).toBeCloseTo(rate.impact * 100, 6);
      expect(await db.riskDecision.count({ where: { idempotencyKey: q.jobs[0]!.idempotencyKey, userId } })).toBe(1);
      // The paper ledger now shows the spend.
      expect(await makePaperPorts(db).balanceSol(userId)).toBeCloseTo(PAPER_START_BALANCE_SOL - Number(order.sizeSol) - PAPER_FEE_SOL, 9);
    });

    it('is idempotent: the same decision and user twice makes one job, one order and one position', async () => {
      const userId = await mkUser();
      const { token, analysisId } = await mkToken('IDE');
      const decision = await mkDecision(analysisId);
      const q = queue();
      await runWith(q, userId, decision.id);
      await runWith(q, userId, decision.id); // before the first job ran: the queue's job id is what dedupes this
      const first = q.jobs[0]!;
      await exec(first);
      expect(await counts(userId)).toEqual({ orders: 1, trades: 1, positions: 1, open: 1 });

      const again = queue();
      const s = await runWith(again, userId, decision.id); // after: the database knows
      expect(again.jobs).toHaveLength(0);
      expect(s.enqueued).toBe(0);
      expect(s.skipped.position_exists ?? 0).toBe(1);

      const replay = await exec(first); // a replayed job: the Governor sees the key
      expect(replay.status).toBe('rejected');
      expect(await counts(userId)).toEqual({ orders: 1, trades: 1, positions: 1, open: 1 });
      // Even with the Governor out of the way, the unique indexes hold the line.
      await expect(db.position.create({ data: { userId, tokenId: token.id, mode: 'PAPER', simulated: true, entryPriceUsd: 1, sizeSol: 0.1, entryContext: {}, openKey: `${userId}:${token.id}` } })).rejects.toMatchObject({ code: 'P2002' });
    });

    it('different users get different jobs from one decision, and neither overwrites the other', async () => {
      const a = await mkUser();
      const b = await mkUser();
      const { analysisId, token } = await mkToken('TWO');
      const decision = await mkDecision(analysisId);
      const q = queue();
      await fanOutEntries(db, { chain: null, enqueue: q.enqueue, now: () => clock, only: { userIds: [a, b], decisionIds: [decision.id] } });
      expect(q.jobs.map((j) => j.userId).sort()).toEqual([a, b].sort());
      for (const j of q.jobs) await exec(j);
      expect(await db.riskDecision.count({ where: { decisionId: decision.id } })).toBe(2);
      expect(await db.position.count({ where: { tokenId: token.id, status: 'OPEN' } })).toBe(2);
    });

    it('ignores a stale decision', async () => {
      const userId = await mkUser();
      const { analysisId } = await mkToken('STL');
      const decision = await mkDecision(analysisId, { ageMins: 11 });
      const q = queue();
      const s = await runWith(q, userId, decision.id);
      expect(q.jobs).toHaveLength(0);
      expect(s.enqueued).toBe(0);
    });

    it('makes no job when the price is missing or stale', async () => {
      const userId = await mkUser();
      const { analysisId } = await mkToken('OLD', { metricMins: -20 });
      const decision = await mkDecision(analysisId);
      const q = queue();
      const s = await runWith(q, userId, decision.id);
      expect(q.jobs).toHaveLength(0);
      expect(s.skipped.no_fresh_price).toBe(1);
    });

    it('makes no job when the balance is unavailable', async () => {
      const userId = await mkUser({ mode: 'AUTO' }); // no trading wallet and no RPC
      const { analysisId } = await mkToken('BAL');
      const decision = await mkDecision(analysisId);
      const q = queue();
      const s = await runWith(q, userId, decision.id);
      expect(q.jobs).toHaveLength(0);
      expect(s.skipped.balance_unavailable).toBe(1);
    });

    it('makes no job for a paused agent, revoked AI access, or AI access that was never turned on', async () => {
      const paused = await mkUser({ perm: { agentPaused: true } });
      const revoked = await mkUser({ perm: { aiTradingEnabled: false, revokedAt: new Date(T0.getTime() - MIN) } });
      const never = await mkUser({ perm: null });
      const { analysisId } = await mkToken('PRM');
      const decision = await mkDecision(analysisId);
      const q = queue();
      const s = await fanOutEntries(db, { chain: null, enqueue: q.enqueue, now: () => clock, only: { userIds: [paused, revoked, never], decisionIds: [decision.id] } });
      expect(q.jobs).toHaveLength(0);
      expect(s.skipped).toMatchObject({ agent_paused: 1, ai_access_revoked: 1, ai_access_off: 1 });
    });

    it('a job queued before AI access was revoked cannot still open a paper position', async () => {
      const userId = await mkUser();
      const { analysisId, token } = await mkToken('RVK');
      const decision = await mkDecision(analysisId);
      const q = queue();
      await runWith(q, userId, decision.id);
      await db.tradingPermission.update({ where: { userId }, data: { aiTradingEnabled: false, revokedAt: clock } });
      const outcome = await exec(q.jobs[0]!);
      expect(outcome.status).toBe('rejected');
      expect(outcome.result.violations.map((v) => v.code)).toContain('AI_ACCESS_DISABLED');
      expect(await db.position.count({ where: { userId, tokenId: token.id } })).toBe(0);
    });

    it('SHADOW users get a logged outcome and nothing else', async () => {
      const userId = await mkUser({ mode: 'SHADOW', perm: null });
      const { analysisId } = await mkToken('SHD');
      const decision = await mkDecision(analysisId);
      const q = queue();
      await runWith(q, userId, decision.id);
      expect(q.jobs).toHaveLength(1);
      const outcome = await exec(q.jobs[0]!);
      expect(outcome.status).toBe('logged');
      expect(await counts(userId)).toEqual({ orders: 0, trades: 0, positions: 0, open: 0 });
      expect(await db.riskDecision.count({ where: { userId, route: 'LOG_ONLY', approved: true } })).toBe(1);
      expect(await db.auditLog.count({ where: { userId, action: 'execution.logged' } })).toBe(1);
      // A second fan-out sees the logged key and does not log it again.
      const again = queue();
      const s = await runWith(again, userId, decision.id);
      expect(again.jobs).toHaveLength(0);
      expect(s.skipped.already_handled).toBe(1);
    });

    it('a stricter user limit shrinks the size; the user cannot exceed the system limit', async () => {
      const strict = await mkUser({ profile: { maxPerTradeSol: 0.05 } });
      const { analysisId } = await mkToken('STR');
      const decision = await mkDecision(analysisId, { payload: { suggestedPositionSizePct: 50 } });
      const q = queue();
      await runWith(q, strict, decision.id);
      await exec(q.jobs[0]!);
      expect(Number((await db.order.findFirstOrThrow({ where: { userId: strict } })).sizeSol)).toBeLessThanOrEqual(0.05 + 1e-9);

      const loose = await mkUser({ profile: { maxPerTradeSol: 50 } }); // stored directly, bypassing the API's check
      const q2 = queue();
      await runWith(q2, loose, decision.id);
      await exec(q2.jobs[0]!);
      expect(Number((await db.order.findFirstOrThrow({ where: { userId: loose } })).sizeSol)).toBeLessThanOrEqual(GLOBAL_LIMITS.maxPerTradeSol);
    });

    it('opens nothing when the entry context cannot be captured (price too old at fill time)', async () => {
      const userId = await mkUser();
      const { analysisId, token } = await mkToken('CTX', { metricMins: -20 });
      const decision = await mkDecision(analysisId);
      const outcome = await exec(entryJob(userId, decision.id, token.mint, `entry:${decision.id}:${userId}`)); // bypasses the fan-out's price check
      expect(outcome.status).toBe('simulated'); // the Governor was satisfied...
      expect(await counts(userId)).toEqual({ orders: 0, trades: 0, positions: 0, open: 0 }); // ...but nothing was written
      expect(await db.auditLog.count({ where: { userId, action: 'paper.entry_skipped' } })).toBe(1);
    });

    it('holds one open position per token per user, even for a second decision', async () => {
      const userId = await mkUser();
      const { token, analysisId } = await openPosition(userId, 'ONE').then((r) => ({ token: r.token, analysisId: r.decision.analysisId }));
      const second = await mkDecision(analysisId);
      const q = queue();
      const s = await runWith(q, userId, second.id);
      expect(q.jobs).toHaveLength(0);
      expect(s.skipped.position_exists).toBe(1);
      clock = at(10);
      await metric(token.id, 1, -1);
      await exec(entryJob(userId, second.id, token.mint, `entry:${second.id}:${userId}`)); // forced past the fan-out
      expect(await counts(userId)).toEqual({ orders: 1, trades: 1, positions: 1, open: 1 });
      expect(await db.auditLog.count({ where: { userId, action: 'paper.entry_skipped' } })).toBe(1);
    });
  });

  describe('exits', () => {
    it('a take-profit REDUCE sells part once, tracks it, and does not repeat; a SELL then closes the rest', async () => {
      const userId = await mkUser();
      const { token, position } = await openPosition(userId, 'EXT');
      const startUnits = BigInt(position.baseUnits!.toFixed(0));
      const startCost = Number(position.sizeSol);

      advance(10);
      await metric(token.id, 2, -1);
      const ev1 = await evaluation(position.id, 'REDUCE', ['TAKE_PROFIT'], -1, 50);
      const q = queue();
      expect((await fanOutExits(db, { enqueue: q.enqueue, now: () => clock, only: { positionIds: [position.id] } })).enqueued).toBe(1);
      expect(q.jobs[0]).toMatchObject({ evaluationId: ev1.id, positionId: position.id, idempotencyKey: exitKey(ev1.id, 1), decision: { action: 'REDUCE', suggestedPositionSizePct: 50 } });
      expect(q.jobs[0]!.decisionId).toBeUndefined();

      quotes.length = 0;
      expect((await exec(q.jobs[0]!)).status).toBe('simulated');
      const sold = BigInt(quotes[0]!.inAmount);
      expect(sold).toBe(startUnits / 2n);
      const after = await db.position.findUniqueOrThrow({ where: { id: position.id } });
      expect(after).toMatchObject({ status: 'OPEN', reduceCount: 1, reducedForCodes: ['TAKE_PROFIT'], openKey: `${userId}:${token.id}` });
      expect(BigInt(after.baseUnits!.toFixed(0))).toBe(startUnits - sold);
      const costSold = (startCost * Number(sold)) / Number(startUnits);
      expect(Number(after.sizeSol)).toBeCloseTo(startCost - costSold, 8);
      const sell = await db.trade.findFirstOrThrow({ where: { userId, side: 'SELL' } });
      const proceeds = Number(BigInt(quotes[0]!.outAmount)) / 1e9;
      expect(Number(sell.realizedPnlSol)).toBeCloseTo(proceeds - costSold - PAPER_FEE_SOL, 8);
      expect(sell).toMatchObject({ simulated: true, mode: 'AI_PAPER', positionId: position.id });
      expect((await db.positionExit.findUniqueOrThrow({ where: { evaluationId: ev1.id } })).outcome).toBe('filled');

      // The same evaluation is not acted on again, and a new evaluation with the same code does not reduce again.
      advance(10);
      const again = queue();
      const s1 = await fanOutExits(db, { enqueue: again.enqueue, now: () => clock, only: { positionIds: [position.id] } });
      expect(again.jobs).toHaveLength(0); // the evaluation that already reduced is not acted on again
      expect(s1.skipped.already_reduced).toBe(1);
      await evaluation(position.id, 'REDUCE', ['TAKE_PROFIT'], -1, 50);
      const same = queue();
      const s2 = await fanOutExits(db, { enqueue: same.enqueue, now: () => clock, only: { positionIds: [position.id] } });
      expect(same.jobs).toHaveLength(0);
      expect(s2.skipped.already_reduced).toBe(1);

      // A SELL always acts and closes the position.
      await metric(token.id, 0.5, -1);
      const ev3 = await evaluation(position.id, 'SELL', ['STOP_LOSS'], -1, 100);
      const sellQ = queue();
      await fanOutExits(db, { enqueue: sellQ.enqueue, now: () => clock, only: { positionIds: [position.id] } });
      expect(sellQ.jobs[0]).toMatchObject({ evaluationId: ev3.id, decision: { action: 'SELL', suggestedPositionSizePct: 100 } });
      expect((await exec(sellQ.jobs[0]!)).status).toBe('simulated');
      const closed = await db.position.findUniqueOrThrow({ where: { id: position.id } });
      expect(closed).toMatchObject({ status: 'CLOSED', openKey: null });
      expect(closed.closedAt).not.toBeNull();
      expect(Number(closed.baseUnits)).toBe(0);
      // Realized PnL over the round trip equals the change in paper cash.
      const trades = await db.trade.findMany({ where: { userId } });
      const realized = trades.reduce((a, t) => a + Number(t.realizedPnlSol), 0);
      expect(realized).toBeCloseTo((await makePaperPorts(db).balanceSol(userId)) - PAPER_START_BALANCE_SOL, 8);
    });

    it('exits are not blocked by the daily-loss limit, while a buy is', async () => {
      const userId = await mkUser();
      const { token, position } = await openPosition(userId, 'LOS');
      // Book a loss far past any daily-loss limit.
      const loser = await db.order.create({ data: { userId, tokenId: token.id, idempotencyKey: `loss-${tag}-${userId}`, side: 'SELL', mode: 'AI_PAPER', status: 'CONFIRMED', sizeSol: 0, simulated: true, createdAt: at(-30) } });
      await db.trade.create({ data: { userId, orderId: loser.id, side: 'SELL', mode: 'AI_PAPER', reason: 'seed', expectedPriceUsd: 1, actualPriceUsd: 1, slippageBps: 0, realizedPnlSol: -9, simulated: true, signature: `paper:seed-${tag}-${userId}`, executedAt: at(-29) } });

      advance(10);
      await metric(token.id, 0.4, -1);
      const { analysisId } = await mkToken('LOB');
      const buyDecision = await mkDecision(analysisId);
      const buyQ = queue();
      await runWith(buyQ, userId, buyDecision.id);
      const buy = await exec(buyQ.jobs[0]!);
      expect(buy.status).toBe('rejected');
      expect(buy.result.violations.map((v) => v.code)).toContain('DAILY_LOSS_LIMIT');

      const ev = await evaluation(position.id, 'SELL', ['STOP_LOSS'], -1, 100);
      const q = queue();
      await fanOutExits(db, { enqueue: q.enqueue, now: () => clock, only: { positionIds: [position.id] } });
      expect(q.jobs).toHaveLength(1);
      expect((await exec(q.jobs[0]!)).status).toBe('simulated');
      expect((await db.position.findUniqueOrThrow({ where: { id: position.id } })).status).toBe('CLOSED');
      expect(ev.id).toBe(q.jobs[0]!.evaluationId);
    });

    it('a rejected exit is retried after the cooldown, and never while it is queued', async () => {
      const userId = await mkUser();
      const { token, position } = await openPosition(userId, 'RTY');
      advance(10);
      await metric(token.id, 0.5, -1);
      const ev = await evaluation(position.id, 'SELL', ['STOP_LOSS'], -1, 100);
      const q1 = queue();
      await fanOutExits(db, { enqueue: q1.enqueue, now: () => clock, only: { positionIds: [position.id] } });
      expect(q1.jobs).toHaveLength(1);
      // Still queued: a second run must not make another job, however long it has been.
      advance(30);
      const q2 = queue();
      await fanOutExits(db, { enqueue: q2.enqueue, now: () => clock, only: { positionIds: [position.id] } });
      expect(q2.jobs).toHaveLength(0);
      // The first attempt ends rejected (price impact too high), which frees it for a retry.
      rate.impact = 9;
      await metric(token.id, 0.5, -1);
      expect((await exec(q1.jobs[0]!)).status).toBe('rejected');
      rate.impact = 0.5;
      expect((await db.positionExit.findUniqueOrThrow({ where: { evaluationId: ev.id } })).outcome).toBe('rejected');
      advance(6);
      await metric(token.id, 0.5, -1);
      const q3 = queue();
      await fanOutExits(db, { enqueue: q3.enqueue, now: () => clock, only: { positionIds: [position.id] } });
      expect(q3.jobs[0]?.idempotencyKey).toBe(exitKey(ev.id, 2));
      expect((await exec(q3.jobs[0]!)).status).toBe('simulated');
    });
  });

  describe('portfolio snapshots', () => {
    it('writes a paper snapshot valued at current prices, and skips a user whose held token has no fresh price', async () => {
      const userId = await mkUser();
      const { token, position } = await openPosition(userId, 'SNP', 1);
      advance(5);
      await metric(token.id, 2, -1); // price doubled since the entry (entry fill was a touch above 1)
      const s = await writePortfolioSnapshots(db, { chain: null, now: () => clock });
      expect(s.paper).toBeGreaterThanOrEqual(1);
      const snap = await db.portfolioSnapshot.findFirstOrThrow({ where: { userId }, orderBy: { at: 'desc' } });
      const cash = await makePaperPorts(db).balanceSol(userId);
      const expected = cash + Number(position.sizeSol) * (2 / Number(position.entryPriceUsd));
      expect(snap.simulated).toBe(true);
      expect(Number(snap.totalValueSol)).toBeCloseTo(expected, 8);

      advance(30); // the price is now too old to value the position
      const before = await db.portfolioSnapshot.count({ where: { userId } });
      const s2 = await writePortfolioSnapshots(db, { chain: null, now: () => clock });
      expect(s2.skipped).toBeGreaterThanOrEqual(1);
      expect(await db.portfolioSnapshot.count({ where: { userId } })).toBe(before);
    });
  });

  describe('semi-auto pending confirmations', () => {
    // SEMI_AUTO users have a real wallet in production, and no chain exists here. So the state loader runs for real against a
    // paper user's rows and only the mode the Governor routes by is switched. Everything after the Governor is the real code.
    const semiAutoDeps = (): ExecutionDeps => {
      const base = deps();
      return { ...base, loadPreTradeState: async (job) => { const st = await base.loadPreTradeState(job); return { ...st, context: { ...st.context, mode: 'SEMI_AUTO' as const, aiAccessEnabled: true } }; } };
    };

    it('an entry in SEMI_AUTO becomes a pending confirmation with a 5 minute expiry, an alert, and no order or position', async () => {
      const userId = await mkUser();
      const { token, analysisId } = await mkToken('SMI');
      const decision = await mkDecision(analysisId);
      const job = entryJob(userId, decision.id, token.mint, `entry:${decision.id}:${userId}`);
      const outcome = await runExecution(db, ExecutionJobSchema.parse(job), semiAutoDeps());
      expect(outcome.status).toBe('awaiting_confirmation');
      expect(await counts(userId)).toEqual({ orders: 0, trades: 0, positions: 0, open: 0 });
      const row = await db.pendingConfirmation.findFirstOrThrow({ where: { userId } });
      expect(row).toMatchObject({ kind: 'ENTRY', status: 'PENDING', idempotencyKey: job.idempotencyKey, mint: token.mint, decisionId: decision.id });
      expect(row.expiresAt.getTime() - clock.getTime()).toBe(5 * MIN);
      expect(Number(row.sizeSol)).toBeGreaterThan(0);
      expect(row.quote).toMatchObject({ priceImpactPct: rate.impact });
      expect(await db.alert.count({ where: { userId, kind: 'CONFIRMATION_REQUIRED', priority: 'IMPORTANT' } })).toBe(1);
      // Running the same job again does not make a second confirmation.
      await runExecution(db, ExecutionJobSchema.parse(job), semiAutoDeps()).catch(() => {});
      expect(await db.pendingConfirmation.count({ where: { userId } })).toBe(1);
    });

    it('an exit in SEMI_AUTO needs confirmation too, as a CRITICAL alert, and sells nothing yet', async () => {
      const userId = await mkUser();
      const { token, position } = await openPosition(userId, 'SMX');
      advance(10);
      await metric(token.id, 0.5, -1);
      const ev = await evaluation(position.id, 'SELL', ['STOP_LOSS'], -1, 100);
      const q = queue();
      await fanOutExits(db, { enqueue: q.enqueue, now: () => clock, only: { positionIds: [position.id] } });
      const outcome = await runExecution(db, q.jobs[0]!, semiAutoDeps());
      expect(outcome.status).toBe('awaiting_confirmation');
      const row = await db.pendingConfirmation.findFirstOrThrow({ where: { userId, kind: 'EXIT' } });
      expect(row).toMatchObject({ status: 'PENDING', evaluationId: ev.id, positionId: position.id });
      expect(await db.alert.count({ where: { userId, kind: 'CONFIRMATION_REQUIRED', priority: 'CRITICAL' } })).toBe(1);
      expect((await db.positionExit.findUniqueOrThrow({ where: { evaluationId: ev.id } })).outcome).toBe('awaiting_confirmation');
      expect((await db.position.findUniqueOrThrow({ where: { id: position.id } })).status).toBe('OPEN');
      expect(await db.trade.count({ where: { userId, side: 'SELL' } })).toBe(0);
    });

    it('expiry: stale pending confirmations are marked expired, and a waiting exit is freed for retry', async () => {
      const userId = await mkUser();
      const { position } = await openPosition(userId, 'EXP');
      const ev = await evaluation(position.id, 'SELL', ['STOP_LOSS'], -1, 100);
      await db.positionExit.create({ data: { positionId: position.id, evaluationId: ev.id, action: 'SELL', fractionPct: 100, signalCodes: ['STOP_LOSS'], outcome: 'awaiting_confirmation', lastAttemptAt: at(-10) } });
      const c = await db.pendingConfirmation.create({ data: { userId, idempotencyKey: `exit:${ev.id}:1`, kind: 'EXIT', mint: addr('EXP'), evaluationId: ev.id, job: {}, sizeSol: 0.1, quote: {}, expiresAt: at(-1) } });
      const fresh = await db.pendingConfirmation.create({ data: { userId, idempotencyKey: `exit:${ev.id}:2`, kind: 'EXIT', mint: addr('EXP'), job: {}, sizeSol: 0.1, quote: {}, expiresAt: at(4) } });
      expect(await expirePendingConfirmations(db, clock)).toBeGreaterThanOrEqual(1);
      expect((await db.pendingConfirmation.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('EXPIRED');
      expect((await db.pendingConfirmation.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe('PENDING');
      expect((await db.positionExit.findUniqueOrThrow({ where: { evaluationId: ev.id } })).outcome).toBe('expired');
    });
  });
});
