import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrisma } from '@narra/database';
import { ExecutionJobSchema, type ExecutionJob } from '@narra/queue';
import { GLOBAL_LIMITS, SYSTEM_LIMITS_KEY } from '@narra/risk';
import { WSOL_MINT, type Quote } from '@narra/solana';
import { fanOutEntries } from './fanOut';
import { runExecution } from './outcomes';
import { makeExecutionStore, type ChainPorts } from './prismaStores';
import { TRADING_PAUSE_KEY } from './systemConfig';
import type { ExecutionDeps } from './execution';

const url = process.env.DATABASE_URL ?? 'postgresql://narra:narra@localhost:5432/narra';
async function dbUp() {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 800 });
  try { await c.connect(); await c.query('select "blacklistReason" from "Token" limit 1'); return true; } catch { return false; } finally { await c.end().catch(() => {}); }
}
const up = await dbUp();

describe.skipIf(!up)('B9: system limits, the global pause and the blacklist reach the Governor (real Postgres)', () => {
  const db = createPrisma(url);
  const tag = `b9${Date.now()}`;
  const MIN = 60_000;
  const clock = new Date('2026-10-05T12:00:00Z');
  const at = (m: number) => new Date(clock.getTime() + m * MIN);
  const userIds: string[] = [];
  let seq = 0, tick = 0;
  let saved: { limits: unknown; pause: unknown } = { limits: undefined, pause: undefined };
  const addr = (s: string) => `${s}${tag}`.padEnd(40, '1').replace(/0/g, 'x');

  const jupiter: ExecutionDeps['jupiter'] = {
    async getQuote({ inputMint, outputMint, amount }): Promise<Quote> {
      const buy = inputMint === WSOL_MINT;
      return { inputMint, outputMint, inAmount: amount.toString(), outAmount: (buy ? amount * 1000n : amount * 400n).toString(), priceImpactPct: 0.5, slippageBps: 100, fetchedAt: clock, raw: {} };
    },
  };
  const noChain: ChainPorts = { getSolBalance: async () => { throw new Error('none'); }, getPortfolioValueSol: async () => { throw new Error('none'); }, getTokenBaseUnits: async () => { throw new Error('none'); } };
  const exec = (job: ExecutionJob) => runExecution(db, ExecutionJobSchema.parse(job), { jupiter, ...makeExecutionStore(db, noChain, () => clock), now: () => clock });
  const setting = (key: string, value: object) => db.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  const clear = () => db.systemSetting.deleteMany({ where: { key: { in: [SYSTEM_LIMITS_KEY, TRADING_PAUSE_KEY] } } });

  const mkUser = async (profile?: { maxPerTradeSol: number }) => {
    const u = await db.user.create({ data: { privyUserId: `did:privy:${tag}-${++seq}`, mode: 'PAPER' } });
    userIds.push(u.id);
    await db.tradingPermission.create({ data: { userId: u.id, aiTradingEnabled: true } });
    if (profile) await db.riskProfile.create({ data: { userId: u.id, preset: 'CUSTOM', maxPerTradeSol: profile.maxPerTradeSol, maxDailyAllocationSol: 5, maxTokenExposurePct: 30, maxOpenPositions: 10, maxDailyLossPct: 15, minConfidence: 0.6 } });
    return u.id;
  };
  const mkToken = async (key: string) => {
    const token = await db.token.create({ data: { mint: addr(key), symbol: key.slice(0, 8), name: key } });
    await db.tokenMetric.create({ data: { tokenId: token.id, priceUsd: 1, marketCapUsd: 1e6, liquidityUsd: 600_000, volume24hUsd: 900_000, at: new Date(at(-1).getTime() + ++tick) } });
    await db.consensusSignal.create({ data: { tokenId: token.id, score: 80, walletCount: 5, independentEntities: 4, leaderCount: 2 } });
    const opp = await db.opportunity.create({ data: { tokenId: token.id, score: 90, narrativeScore: 80, smartMoneyScore: 80, liquidityScore: 80, momentumScore: 80, ogScore: 80, riskScore: 20 } });
    const analysis = await db.agentAnalysis.create({ data: { opportunityId: opp.id, model: 'test' } });
    return { token, analysisId: analysis.id };
  };
  const payload = (over: Record<string, unknown> = {}) => ({ action: 'BUY', confidence: 0.9, reasonCodes: ['SMART_MONEY'], positiveSignals: [], negativeSignals: [], risks: [], suggestedPositionSizePct: 50, entry: { maxSlippageBps: 100, maxPriceImpactPct: 1.5 }, exit: { stopLossPct: 30, takeProfitPct: 100, trailingStopPct: null }, invalidationConditions: [], summary: 's', ...over });
  const mkDecision = (analysisId: string) => db.agentDecision.create({ data: { analysisId, action: 'BUY', confidence: 0.9, payload: payload() as object, createdAt: new Date(at(-1).getTime() + ++tick) } });
  const jobFor = (userId: string, decisionId: string, mint: string): ExecutionJob => ({ userId, decisionId, idempotencyKey: `entry:${decisionId}:${userId}`, mint, decision: payload() as ExecutionJob['decision'] });
  const queue = () => { const jobs: ExecutionJob[] = []; return { jobs, enqueue: async (j: ExecutionJob) => { jobs.push(j); } }; };
  const fan = (q: ReturnType<typeof queue>, userId: string, decisionId: string) => fanOutEntries(db, { chain: null, enqueue: q.enqueue, now: () => clock, only: { userIds: [userId], decisionIds: [decisionId] } });

  const setup = (async () => {
    const [l, p] = await Promise.all([db.systemSetting.findUnique({ where: { key: SYSTEM_LIMITS_KEY } }), db.systemSetting.findUnique({ where: { key: TRADING_PAUSE_KEY } })]);
    saved = { limits: l?.value, pause: p?.value };
    await clear();
  })();

  afterAll(async () => {
    await clear();
    if (saved.limits !== undefined) await setting(SYSTEM_LIMITS_KEY, saved.limits as object);
    if (saved.pause !== undefined) await setting(TRADING_PAUSE_KEY, saved.pause as object);
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.agentDecision.deleteMany({ where: { analysis: { opportunity: { token: { mint: { contains: tag } } } } } });
    await db.token.deleteMany({ where: { mint: { contains: tag } } });
    await db.$disconnect();
  });

  it('the global pause stops new entries before any quote is spent, and a job queued before the pause is rejected by the Governor', async () => {
    await setup; await clear();
    const userId = await mkUser();
    const { analysisId, token } = await mkToken('PAUSE');
    const decision = await mkDecision(analysisId);
    const queued = queue();
    await fan(queued, userId, decision.id); // before the pause: a job is made
    expect(queued.jobs).toHaveLength(1);

    await setting(TRADING_PAUSE_KEY, { paused: true, reason: 'test', at: clock.toISOString(), by: 'admin' });
    const none = queue();
    const s = await fan(none, userId, decision.id);
    expect(none.jobs).toHaveLength(0);
    expect(s.skipped.system_paused).toBe(1);

    const outcome = await exec(queued.jobs[0]!); // already queued: the Governor still stops it
    expect(outcome.status).toBe('rejected');
    expect(outcome.result.violations.map((v) => v.code)).toContain('SYSTEM_PAUSED');
    expect(await db.position.count({ where: { userId, tokenId: token.id } })).toBe(0);
    expect(await db.order.count({ where: { userId } })).toBe(0);

    await clear();
    expect((await exec(queued.jobs[0]!)).status).toBe('simulated'); // resumed: the same job now fills
    expect(await db.position.count({ where: { userId, tokenId: token.id, status: 'OPEN' } })).toBe(1);
  });

  it('exits are not stopped by the pause', async () => {
    await setup; await clear();
    const userId = await mkUser();
    const { analysisId, token } = await mkToken('EXITP');
    const decision = await mkDecision(analysisId);
    expect((await exec(jobFor(userId, decision.id, token.mint))).status).toBe('simulated');
    const position = await db.position.findFirstOrThrow({ where: { userId, tokenId: token.id } });
    await setting(TRADING_PAUSE_KEY, { paused: true, reason: 'test', at: clock.toISOString(), by: 'admin' });
    const sell: ExecutionJob = { userId, evaluationId: `ev-${tag}`, positionId: position.id, idempotencyKey: `exit:ev-${tag}:1`, mint: token.mint, decision: { ...(payload() as ExecutionJob['decision']), action: 'SELL', suggestedPositionSizePct: 100 } };
    expect((await exec(sell)).status).toBe('simulated');
    expect((await db.position.findUniqueOrThrow({ where: { id: position.id } })).status).toBe('CLOSED');
    await clear();
  });

  it('admin-lowered system limits shrink orders for everyone, including a user whose own limit is looser, and a reset restores them', async () => {
    await setup; await clear();
    const loose = await mkUser({ maxPerTradeSol: 1 });
    const a = await mkToken('LIM1'), b = await mkToken('LIM2');
    const d1 = await mkDecision(a.analysisId), d2 = await mkDecision(b.analysisId);

    await setting(SYSTEM_LIMITS_KEY, { maxPerTradeSol: 0.03 });
    expect((await exec(jobFor(loose, d1.id, a.token.mint))).status).toBe('simulated');
    expect(Number((await db.order.findFirstOrThrow({ where: { userId: loose, tokenId: a.token.id } })).sizeSol)).toBeLessThanOrEqual(0.03 + 1e-9);

    await clear();
    expect((await exec(jobFor(loose, d2.id, b.token.mint))).status).toBe('simulated');
    expect(Number((await db.order.findFirstOrThrow({ where: { userId: loose, tokenId: b.token.id } })).sizeSol)).toBeGreaterThan(0.03);
  });

  it('a tampered stored limit cannot loosen the Governor', async () => {
    await setup; await clear();
    const userId = await mkUser({ maxPerTradeSol: 50 });
    const { analysisId, token } = await mkToken('TAMP');
    const decision = await mkDecision(analysisId);
    await setting(SYSTEM_LIMITS_KEY, { maxPerTradeSol: 500, minConfidence: 0.01 });
    expect((await exec(jobFor(userId, decision.id, token.mint))).status).toBe('simulated');
    expect(Number((await db.order.findFirstOrThrow({ where: { userId } })).sizeSol)).toBeLessThanOrEqual(GLOBAL_LIMITS.maxPerTradeSol + 1e-9);
    await clear();
  });

  it('a blacklisted token gets no new jobs and any queued entry is rejected; un-blacklisting restores it', async () => {
    await setup; await clear();
    const userId = await mkUser();
    const { analysisId, token } = await mkToken('BLK');
    const decision = await mkDecision(analysisId);
    await db.token.update({ where: { id: token.id }, data: { blacklisted: true, blacklistReason: 'test', blacklistedAt: clock } });
    const q = queue();
    const s = await fan(q, userId, decision.id);
    expect(q.jobs).toHaveLength(0);
    expect(s.skipped.blacklisted_token).toBe(1);
    const forced = await exec(jobFor(userId, decision.id, token.mint));
    expect(forced.status).toBe('rejected');
    expect(forced.result.violations.map((v) => v.code)).toContain('TOKEN_BLACKLISTED');
    expect(await db.position.count({ where: { userId, tokenId: token.id } })).toBe(0);

    await db.token.update({ where: { id: token.id }, data: { blacklisted: false, blacklistReason: null, blacklistedAt: null } });
    // The first user's key was already handled (the rejected job above), so the fan-out rightly skips it. A different user is not.
    const other = await mkUser();
    const q2 = queue();
    await fan(q2, other, decision.id);
    expect(q2.jobs).toHaveLength(1);
  });
});
