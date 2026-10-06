import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@narra/database';
import type { ExecutionJob, SwapEvent } from '@narra/queue';
import { PROFILES } from '@narra/risk';
import { MissingInputError, limitsFor, makeExecutionStore, makeWalletEventStore, type ChainPorts } from './prismaStores';

const MINT = '7xKqExampleMintAddress1111111111111111111';
const NOW = new Date('2026-09-30T10:00:00Z');
const D = (n: number) => ({ toString: () => String(n) });

const EVENT: SwapEvent = { signature: 'sig'.padEnd(64, '1'), wallet: 'W'.padEnd(40, '1'), mint: MINT, side: 'BUY', amountSol: 2, tokenAmount: 1000, at: NOW.toISOString() };

describe('wallet event store', () => {
  const mk = (over: Record<string, unknown> = {}) => {
    const create = vi.fn(async () => ({}));
    const db = {
      trackedWallet: { count: vi.fn(async () => 1), findUnique: vi.fn(async () => ({ id: 'w1', active: true })) },
      token: { upsert: vi.fn(async () => ({ id: 't1' })) },
      walletTrade: { create },
      walletProfile: { findFirst: vi.fn(async () => ({ score: 88 })) },
      ...over,
    } as unknown as PrismaClient;
    return { db, create };
  };
  it('stores a tracked wallet trade and creates the token row if needed', async () => {
    const { db, create } = mk();
    expect(await makeWalletEventStore(db).saveWalletTrade(EVENT)).toBe('created');
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ walletId: 'w1', tokenId: 't1', side: 'BUY', amountSol: 2, tokenAmount: 1000, signature: EVENT.signature }) });
  });
  it('ignores untracked wallets', async () => {
    const { db, create } = mk({ trackedWallet: { findUnique: vi.fn(async () => null) } });
    expect(await makeWalletEventStore(db).saveWalletTrade(EVENT)).toBe('untracked');
    expect(create).not.toHaveBeenCalled();
  });
  it('ignores a deactivated wallet, and treats a missing active flag as untracked', async () => {
    for (const row of [{ id: 'w1', active: false }, { id: 'w1' }]) {
      const { db, create } = mk({ trackedWallet: { findUnique: vi.fn(async () => row) } });
      expect(await makeWalletEventStore(db).saveWalletTrade(EVENT)).toBe('untracked');
      expect(create).not.toHaveBeenCalled();
    }
  });
  it('treats a unique-signature violation as a duplicate and rethrows anything else', async () => {
    const dup = mk({ walletTrade: { create: vi.fn(async () => { throw Object.assign(new Error('x'), { code: 'P2002' }); }) } });
    expect(await makeWalletEventStore(dup.db).saveWalletTrade(EVENT)).toBe('duplicate');
    const boom = mk({ walletTrade: { create: vi.fn(async () => { throw new Error('db down'); }) } });
    await expect(makeWalletEventStore(boom.db).saveWalletTrade(EVENT)).rejects.toThrow('db down');
  });
  it('reads the wallet score and tracked status', async () => {
    const { db } = mk();
    const s = makeWalletEventStore(db);
    expect(await s.getWalletScore('x')).toBe(88);
    expect(await s.isTracked('x')).toBe(true);
    expect(await makeWalletEventStore(mk({ walletProfile: { findFirst: vi.fn(async () => null) } }).db).getWalletScore('x')).toBeNull();
  });
});

const JOB = (action: 'BUY' | 'SELL' = 'BUY'): ExecutionJob => ({
  userId: 'u1', decisionId: 'd1', idempotencyKey: 'order-0001-abcd', mint: MINT,
  decision: { action, confidence: 0.9, reasonCodes: [], positiveSignals: [], negativeSignals: [], risks: [], suggestedPositionSizePct: 1,
    entry: { maxSlippageBps: 100, maxPriceImpactPct: 1 }, exit: { stopLossPct: null, takeProfitPct: null, trailingStopPct: null }, invalidationConditions: [], summary: '' },
});

const ports = (over: Partial<ChainPorts> = {}): ChainPorts => ({
  getSolBalance: vi.fn(async () => 10), getPortfolioValueSol: vi.fn(async () => 20), getTokenBaseUnits: vi.fn(async () => '1000000'), ...over,
});

function execDb(over: Record<string, unknown> = {}) {
  const upsert = vi.fn(async () => ({}));
  const audit = vi.fn(async () => ({}));
  // B9: the store now also reads the admin's system settings. No rows means the code defaults and no pause.
  const systemSetting = { findMany: vi.fn(async () => []) };
  const db = {
    systemSetting,
    user: { findUnique: vi.fn(async () => ({
      id: 'u1', mode: 'AUTO',
      permission: { aiTradingEnabled: true, agentPaused: false, revokedAt: null, delegatedUntil: new Date('2026-10-30T00:00:00Z') },
      riskProfile: { preset: 'BALANCED', maxPerTradeSol: D(0.25), maxDailyAllocationSol: D(1), maxTokenExposurePct: 15, maxOpenPositions: 5, maxDailyLossPct: 8, minConfidence: 0.75 },
      wallets: [{ address: 'TradingWallet' }],
    })) },
    token: { findUnique: vi.fn(async () => ({ id: 't1', blacklisted: false, metrics: [{ liquidityUsd: D(600000) }], opportunities: [{ score: 91 }], consensus: [{ score: 84 }] })) },
    position: { count: vi.fn(async () => 2), findFirst: vi.fn(async () => null), aggregate: vi.fn(async () => ({ _sum: { sizeSol: D(0.5) } })) },
    order: {
      aggregate: vi.fn(async () => ({ _sum: { sizeSol: D(0.3) } })),
      findMany: vi.fn(async () => [{ idempotencyKey: 'older-key-0001' }]),
      findFirst: vi.fn(async () => null),
    },
    trade: { aggregate: vi.fn(async () => ({ _sum: { realizedPnlSol: D(-0.4) } })), findFirst: vi.fn(async () => ({ executedAt: new Date('2026-09-30T09:00:00Z') })) },
    portfolioSnapshot: { aggregate: vi.fn(async () => ({ _max: { totalValueSol: D(25) } })) },
    riskDecision: { upsert },
    auditLog: { create: audit },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    ...over,
  } as unknown as PrismaClient;
  return { db, upsert, audit };
}

describe('execution store', () => {
  it('assembles the Governor context from the database and providers', async () => {
    const { db } = execDb();
    const p = ports();
    const s = await makeExecutionStore(db, p, () => NOW).loadPreTradeState(JOB());
    expect(s.context).toMatchObject({
      mode: 'AUTO', aiAccessEnabled: true, agentPaused: false, idempotencyKey: 'order-0001-abcd',
      token: { blacklisted: false, liquidityUsd: 600000 }, signals: { opportunityScore: 91, consensusScore: 84 },
      portfolio: { totalValueSol: 20, walletBalanceSol: 10, openPositions: 2, hasPositionInToken: false, tokenExposureSol: 0.5, allocatedTodaySol: 0.3, realizedPnlTodaySol: -0.4 },
      history: { seenIdempotencyKeys: ['older-key-0001'], lastTradeAtForToken: new Date('2026-09-30T09:00:00Z'), lastSameOrderAt: null },
    });
    expect(s.context.portfolio.drawdownPct).toBeCloseTo(20); // peak 25, now 20
    expect(s.limits.maxPerTradeSol).toBe(0.25);
    expect(p.getTokenBaseUnits).not.toHaveBeenCalled(); // BUY does not need the position amount
    expect(s.positionBaseUnits).toBeNull();
  });
  it('loads the held amount for exits', async () => {
    const { db } = execDb();
    const s = await makeExecutionStore(db, ports(), () => NOW).loadPreTradeState(JOB('SELL'));
    expect(s.positionBaseUnits).toBe('1000000');
  });
  it('turns AI access off when it is revoked, expired or never granted', async () => {
    const user = (permission: unknown) => ({ user: { findUnique: vi.fn(async () => ({ id: 'u1', mode: 'AUTO', permission, riskProfile: null, wallets: [{ address: 'w' }] })) } });
    const ok = { aiTradingEnabled: true, agentPaused: false, revokedAt: null, delegatedUntil: null };
    for (const perm of [{ ...ok, revokedAt: new Date('2026-09-01') }, { ...ok, delegatedUntil: new Date('2026-09-01') }, { ...ok, aiTradingEnabled: false }, null]) {
      const s = await makeExecutionStore(execDb(user(perm)).db, ports(), () => NOW).loadPreTradeState(JOB());
      expect(s.context.aiAccessEnabled).toBe(false);
    }
    const paused = await makeExecutionStore(execDb(user({ ...ok, agentPaused: true })).db, ports(), () => NOW).loadPreTradeState(JOB());
    expect(paused.context.agentPaused).toBe(true);
  });
  it('fails closed when an input is missing instead of defaulting it', async () => {
    const noUser = execDb({ user: { findUnique: vi.fn(async () => null) } });
    await expect(makeExecutionStore(noUser.db, ports(), () => NOW).loadPreTradeState(JOB())).rejects.toThrow(MissingInputError);
    const noSignals = execDb({ token: { findUnique: vi.fn(async () => ({ id: 't1', blacklisted: false, metrics: [{ liquidityUsd: D(1) }], opportunities: [], consensus: [] })) } });
    await expect(makeExecutionStore(noSignals.db, ports(), () => NOW).loadPreTradeState(JOB())).rejects.toThrow('missing');
    const failingPort = execDb();
    await expect(makeExecutionStore(failingPort.db, ports({ getSolBalance: async () => { throw new Error('rpc down'); } }), () => NOW).loadPreTradeState(JOB())).rejects.toThrow('rpc down');
  });
  it('records the risk decision and an audit entry together', async () => {
    const { db, upsert, audit } = execDb();
    const result = { approved: false, route: 'REJECT' as const, sizeSol: 0, exitFraction: 0, maxSlippageBps: 100, maxPriceImpactPct: 1, violations: [{ code: 'AGENT_PAUSED', message: 'x' }], adjustments: [] };
    await makeExecutionStore(db, ports()).recordRisk({ job: JOB(), result, quote: null, status: 'rejected' });
    // B4 change: the risk decision is now one row per user and order (keyed by the idempotency key), not one per decision,
    // because many users can act on the same decision and must not overwrite each other.
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { idempotencyKey: 'order-0001-abcd' } }));
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ userId: 'u1', decisionId: 'd1' }) }));
    expect(audit).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: 'u1', action: 'execution.rejected' }) });
    expect((db.$transaction as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0]).toHaveLength(2);
  });
});

describe('limitsFor', () => {
  it('uses the strictest preset when the user has no saved profile', () => expect(limitsFor(null)).toEqual(PROFILES.CONSERVATIVE));
  it('lets saved values override the preset', () => {
    const l = limitsFor({ preset: 'AGGRESSIVE', maxPerTradeSol: D(0.3), maxDailyAllocationSol: D(1), maxTokenExposurePct: 12, maxOpenPositions: 4, maxDailyLossPct: 6, minConfidence: 0.8 });
    expect(l).toMatchObject({ maxPerTradeSol: 0.3, maxOpenPositions: 4, minConfidence: 0.8, maxSlippageBps: PROFILES.AGGRESSIVE.maxSlippageBps });
  });
});
