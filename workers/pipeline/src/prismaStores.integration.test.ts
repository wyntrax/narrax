import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrisma } from '@narra/database';
import type { ExecutionJob, SwapEvent } from '@narra/queue';
import { makeExecutionStore, makeWalletEventStore, type ChainPorts } from './prismaStores';

const url = process.env.DATABASE_URL ?? 'postgresql://narra:narra@localhost:5432/narra';
async function dbUp() {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 800 });
  try { await c.connect(); await c.query('select 1 from "User" limit 1'); return true; } catch { return false; } finally { await c.end().catch(() => {}); }
}
const up = await dbUp();

describe.skipIf(!up)('prisma stores on a real Postgres', () => {
  const db = createPrisma(url);
  const tag = `t${Date.now()}`;
  const MINT = `Mint${tag}`.padEnd(40, '1');
  const WALLET = `Wal${tag}`.padEnd(40, '1');
  const NOW = new Date('2026-09-30T10:00:00Z');
  const ports: ChainPorts = { getSolBalance: async () => 10, getPortfolioValueSol: async () => 20, getTokenBaseUnits: async () => '1000000' };
  let userId = '';
  let decisionId = '';

  beforeAll(async () => {
    const user = await db.user.create({
      data: {
        privyUserId: `privy-${tag}`, mode: 'AUTO',
        wallets: { create: [{ address: `Trading${tag}`, kind: 'TRADING' }] },
        permission: { create: { aiTradingEnabled: true } },
        riskProfile: { create: { preset: 'BALANCED' } },
      },
    });
    userId = user.id;
    await db.trackedWallet.create({ data: { address: WALLET, profile: { create: { score: 88, leaderScore: 70 } } } });
    const token = await db.token.create({
      data: {
        mint: MINT, symbol: 'T', name: 'T',
        metrics: { create: { priceUsd: 0.01, marketCapUsd: 2_000_000, liquidityUsd: 600_000, volume24hUsd: 1_000_000 } },
        consensus: { create: { score: 84, walletCount: 3, independentEntities: 3, leaderCount: 1, netFlowUsd: 1000 } },
      },
    });
    const opp = await db.opportunity.create({ data: { tokenId: token.id, score: 91, narrativeScore: 90, smartMoneyScore: 90, liquidityScore: 80, momentumScore: 70, ogScore: 80, riskScore: 30 } });
    const analysis = await db.agentAnalysis.create({ data: { opportunityId: opp.id, model: 'test' } });
    const decision = await db.agentDecision.create({ data: { analysisId: analysis.id, userId, action: 'BUY', confidence: 0.9, payload: {} } });
    decisionId = decision.id;
    await db.portfolioSnapshot.create({ data: { userId, totalValueSol: 25, at: new Date('2026-09-20T00:00:00Z') } });
  });
  afterAll(async () => { await db.$disconnect(); });

  const event = (sig: string): SwapEvent => ({ signature: sig.padEnd(64, '0'), wallet: WALLET, mint: MINT, side: 'BUY', amountSol: 2, tokenAmount: 500, at: NOW.toISOString() });

  it('stores wallet trades, detects duplicates, and ignores untracked wallets', async () => {
    const s = makeWalletEventStore(db);
    const e = event(`sig${tag}`);
    expect(await s.isTracked(WALLET)).toBe(true);
    expect(await s.saveWalletTrade(e)).toBe('created');
    expect(await s.saveWalletTrade(e)).toBe('duplicate'); // real unique-constraint error through the pg adapter
    expect(await s.saveWalletTrade({ ...event(`other${tag}`), wallet: 'Unknown'.padEnd(40, '1') })).toBe('untracked');
    expect(await s.getWalletScore(WALLET)).toBe(88);
    expect(await s.getWalletScore('Nobody'.padEnd(40, '1'))).toBeNull();
  });

  const job = (): ExecutionJob => ({
    userId, decisionId, idempotencyKey: `order-${tag}`, mint: MINT,
    decision: { action: 'BUY', confidence: 0.9, reasonCodes: [], positiveSignals: [], negativeSignals: [], risks: [], suggestedPositionSizePct: 1,
      entry: { maxSlippageBps: 100, maxPriceImpactPct: 1 }, exit: { stopLossPct: null, takeProfitPct: null, trailingStopPct: null }, invalidationConditions: [], summary: '' },
  });

  it('loads the pre-trade state from real rows', async () => {
    const s = await makeExecutionStore(db, ports, () => NOW).loadPreTradeState(job());
    expect(s.context).toMatchObject({
      mode: 'AUTO', aiAccessEnabled: true, agentPaused: false,
      token: { blacklisted: false, liquidityUsd: 600000 }, signals: { opportunityScore: 91, consensusScore: 84 },
      portfolio: { totalValueSol: 20, walletBalanceSol: 10, openPositions: 0, hasPositionInToken: false, allocatedTodaySol: 0 },
    });
    expect(s.context.portfolio.drawdownPct).toBeCloseTo(20);
    expect(s.limits.maxPerTradeSol).toBe(0.25);
  });

  it('records a risk decision once per decision and writes an audit entry', async () => {
    const store = makeExecutionStore(db, ports, () => NOW);
    const result = { approved: false, route: 'REJECT' as const, sizeSol: 0, exitFraction: 0, maxSlippageBps: 100, maxPriceImpactPct: 1, violations: [{ code: 'AGENT_PAUSED', message: 'x' }], adjustments: [] };
    await store.recordRisk({ job: job(), result, quote: null, status: 'rejected' });
    await store.recordRisk({ job: job(), result: { ...result, approved: true, route: 'LOG_ONLY', violations: [] }, quote: null, status: 'logged' });
    const rows = await db.riskDecision.findMany({ where: { decisionId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.route).toBe('LOG_ONLY');
    expect(await db.auditLog.count({ where: { userId } })).toBe(2);
  });

  it('sees today\'s orders and trades in the limits', async () => {
    const token = await db.token.findUniqueOrThrow({ where: { mint: MINT } });
    const order = await db.order.create({ data: { userId, tokenId: token.id, idempotencyKey: `prev-${tag}`, side: 'BUY', mode: 'AI_AUTO', status: 'CONFIRMED', sizeSol: 0.4, createdAt: new Date(NOW.getTime() - 1800_000) } });
    await db.trade.create({ data: { userId, orderId: order.id, side: 'BUY', mode: 'AI_AUTO', reason: 'x', expectedPriceUsd: 1, actualPriceUsd: 1, slippageBps: 5, realizedPnlSol: -0.6, signature: `tx${tag}`, executedAt: new Date(NOW.getTime() - 1700_000) } });
    const s = await makeExecutionStore(db, ports, () => NOW).loadPreTradeState(job());
    expect(s.context.portfolio.allocatedTodaySol).toBeCloseTo(0.4);
    expect(s.context.portfolio.realizedPnlTodaySol).toBeCloseTo(-0.6);
    expect(s.context.history.seenIdempotencyKeys).toContain(`prev-${tag}`);
    expect(s.context.history.lastTradeAtForToken).toEqual(new Date(NOW.getTime() - 1700_000));
    expect(s.context.history.lastSameOrderAt).toEqual(new Date(NOW.getTime() - 1800_000));
  });
});
