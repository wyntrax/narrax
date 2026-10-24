import { describe, expect, it } from 'vitest';
import { buildApp } from './app';

const body = {
  decision: {
    action: 'BUY', confidence: 0.9, reasonCodes: ['SMART_MONEY'], positiveSignals: [], negativeSignals: [], risks: [],
    suggestedPositionSizePct: 1, entry: { maxSlippageBps: 100, maxPriceImpactPct: 1 },
    exit: { stopLossPct: 25, takeProfitPct: 50, trailingStopPct: null }, invalidationConditions: [], summary: 'ok',
  },
  context: {
    now: '2026-09-30T10:00:00Z', mode: 'SHADOW', aiAccessEnabled: false, agentPaused: false, idempotencyKey: 'key-0001-abcd',
    token: { mint: '7xKqExampleMintAddress1111111111111111111', blacklisted: false, liquidityUsd: 500000 },
    signals: { opportunityScore: 90, consensusScore: 80 }, quote: { priceImpactPct: 0.3, expectedSlippageBps: 30 },
    portfolio: { totalValueSol: 20, walletBalanceSol: 10, openPositions: 0, hasPositionInToken: false, tokenExposureSol: 0, allocatedTodaySol: 0, realizedPnlTodaySol: 0, drawdownPct: 0 },
    history: { seenIdempotencyKeys: [], lastTradeAtForToken: null, lastSameOrderAt: null },
  },
};

describe('api', () => {
  it('reports health with the configured brand', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.json()).toEqual({ status: 'ok', brand: 'NARRAX' });
  });
  it('runs the risk governor on a valid decision', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/v1/risk/evaluate', payload: body });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ approved: true, route: 'LOG_ONLY' });
  });
  it('rejects malformed model output before it reaches the governor', async () => {
    const app = await buildApp();
    const bad = { ...body, decision: { ...body.decision, confidence: 7, action: 'SEND_ALL_FUNDS' } };
    const res = await app.inject({ method: 'POST', url: '/v1/risk/evaluate', payload: bad });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('INVALID_INPUT');
  });
});

describe('helius webhook', () => {
  const swap = { signature: 'sig'.padEnd(64, '1'), timestamp: 1_790_000_000, feePayer: 'Wal1111111111111111111111111111111111111111',
    events: { swap: { nativeInput: { account: 'x', amount: '3000000000' }, tokenOutputs: [{ mint: 'Tok1111111111111111111111111111111111111111', rawTokenAmount: { tokenAmount: '5', decimals: 0 } }] } } };
  const make = async (tracked: boolean) => {
    const enqueued: unknown[] = [];
    const app = await buildApp({ webhooks: { secret: 'whsec-12345', enqueue: async (e) => { enqueued.push(e); }, isTracked: async () => tracked } });
    return { app, enqueued };
  };
  it('rejects requests without the shared secret', async () => {
    const { app, enqueued } = await make(true);
    const res = await app.inject({ method: 'POST', url: '/webhooks/helius', payload: [swap], headers: { authorization: 'wrong' } });
    expect(res.statusCode).toBe(401);
    expect(enqueued).toHaveLength(0);
  });
  it('queues swaps only for tracked wallets', async () => {
    const yes = await make(true);
    const r1 = await yes.app.inject({ method: 'POST', url: '/webhooks/helius', payload: [swap], headers: { authorization: 'whsec-12345' } });
    expect(r1.json()).toEqual({ received: 1, queued: 1, skipped: 0 });
    const no = await make(false);
    const r2 = await no.app.inject({ method: 'POST', url: '/webhooks/helius', payload: [swap, { junk: 1 }], headers: { authorization: 'whsec-12345' } });
    expect(r2.json()).toEqual({ received: 1, queued: 0, skipped: 1 });
    expect(no.enqueued).toHaveLength(0);
  });
});
