import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@narra/database';
import { PROFILES } from '@narra/risk';
import { WSOL_MINT, type Quote, type QuoteRequest } from '@narra/solana';

const loadPreTradeStateMock = vi.fn();

vi.mock('@narra/worker-pipeline', () => ({
  makeExecutionStore: () => ({ loadPreTradeState: loadPreTradeStateMock }),
  makePaperPorts: () => ({ balanceSol: async () => 10 }),
  captureEntryContext: async () => ({ version: 1 }),
}));

vi.mock('./account', () => ({
  makeAuthenticate: () => async (req: { userId?: string }) => {
    req.userId = 'user-1';
  },
}));

vi.mock('./marketEvidence', () => ({
  marketTokenImages: async () => new Map<string, string | null>(),
}));

import { registerPaperTradeRoutes } from './paper-trades';

describe('registerPaperTradeRoutes manual paper trading', () => {
  const now = new Date('2032-02-01T12:00:00Z');
  const mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

  const makePreState = (liquidityUsd = 120_000) => ({
    context: {
      now,
      mode: 'PAPER' as const,
      aiAccessEnabled: true,
      agentPaused: false,
      systemPaused: false,
      idempotencyKey: 'paper-preview:1',
      token: { mint, blacklisted: false, liquidityUsd },
      signals: { opportunityScore: 0, consensusScore: 0 },
      quote: { priceImpactPct: 0, expectedSlippageBps: 0 },
      portfolio: {
        totalValueSol: 10,
        walletBalanceSol: 10,
        openPositions: 0,
        hasPositionInToken: false,
        tokenExposureSol: 0,
        allocatedTodaySol: 0,
        realizedPnlTodaySol: 0,
        drawdownPct: 0,
      },
      history: { seenIdempotencyKeys: [], lastTradeAtForToken: null, lastSameOrderAt: null },
    },
    limits: PROFILES.BALANCED,
    systemLimits: undefined,
    positionBaseUnits: null,
  });

  function makeDb(opts: {
    holders?: number;
    isHoneypot?: boolean;
    decision?: { id: string; action: string; confidence: number; createdAt: Date; payload: unknown } | null;
  } = {}) {
    return {
      user: { findUnique: vi.fn(async () => ({ id: 'user-1', mode: 'PAPER', permission: { aiTradingEnabled: true } })) },
      token: { findUnique: vi.fn(async () => ({ id: 'tok-1', mint, symbol: 'MEME', name: 'Meme Token' })) },
      agentDecision: { findFirst: vi.fn(async () => opts.decision ?? null) },
      tokenMetric: { findFirst: vi.fn(async () => ({ id: 'm-1', priceUsd: '0.02', liquidityUsd: '120000', at: now })) },
      position: { findFirst: vi.fn(async () => null) },
      tokenHolderMetric: { findFirst: vi.fn(async () => ({ holders: opts.holders ?? 120, at: now })) },
      tokenRiskMetric: {
        findFirst: vi.fn(async () => (opts.isHoneypot ? { riskScore: 100, flags: ['HONEYPOT'], at: now } : null)),
      },
      auditLog: {
        create: vi.fn(async ({ data }: { data: { detail: unknown } }) => ({ id: 'preview-1', detail: data.detail })),
      },
    } as unknown as PrismaClient;
  }

  const quotes = {
    getQuote: vi.fn(async (req: QuoteRequest): Promise<Quote> => ({
      inputMint: req.inputMint,
      outputMint: req.outputMint,
      inAmount: req.amount.toString(),
      outAmount: (req.amount * 1000n).toString(),
      otherAmountThreshold: (req.amount * 990n).toString(),
      priceImpactPct: 0.2,
      slippageBps: req.slippageBps,
      fetchedAt: now,
      raw: {},
    })),
  };

  beforeEach(() => {
    loadPreTradeStateMock.mockReset();
    loadPreTradeStateMock.mockResolvedValue(makePreState());
    quotes.getQuote.mockClear();
  });

  it('previews manual paper BUY without AI BUY decision or Smart Money consensus using fresh market/holder inputs', async () => {
    const app = Fastify();
    const db = makeDb({ decision: null });
    registerPaperTradeRoutes(app, { db, verifier: { verify: async () => ({ privyUserId: 'u1' }) }, now: () => now, quotes });

    const res = await app.inject({ method: 'POST', url: '/v1/paper-trades/preview', payload: { side: 'BUY', mint, sizeSol: 0.1 } });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ side: 'BUY', mint, sizeSol: 0.1, simulated: true });
    expect(loadPreTradeStateMock).toHaveBeenCalledWith(expect.objectContaining({ mint }), { requireSignals: false });
    expect(quotes.getQuote).toHaveBeenCalledWith(expect.objectContaining({ inputMint: WSOL_MINT, outputMint: mint }));
  });

  it('still blocks honeypots and low-holder tokens on manual paper BUY', async () => {
    const app = Fastify();
    registerPaperTradeRoutes(app, { db: makeDb({ isHoneypot: true }), verifier: { verify: async () => ({ privyUserId: 'u1' }) }, now: () => now, quotes });
    const unsafe = await app.inject({ method: 'POST', url: '/v1/paper-trades/preview', payload: { side: 'BUY', mint, sizeSol: 0.1 } });
    expect(unsafe.statusCode).toBe(409);
    expect(unsafe.json().error).toBe('PAPER_TOKEN_UNSAFE');

    const app2 = Fastify();
    registerPaperTradeRoutes(app2, { db: makeDb({ holders: 12 }), verifier: { verify: async () => ({ privyUserId: 'u1' }) }, now: () => now, quotes });
    const lowHolders = await app2.inject({ method: 'POST', url: '/v1/paper-trades/preview', payload: { side: 'BUY', mint, sizeSol: 0.1 } });
    expect(lowHolders.statusCode).toBe(409);
    expect(lowHolders.json().error).toBe('HOLDERS_TOO_LOW');
    expect(quotes.getQuote).not.toHaveBeenCalled();
  });

  it('allows manual paper BUY when holder snapshot is missing or stale and auto-fetches live market quote when price is stale', async () => {
    const staleAt = new Date(now.getTime() - 48 * 3_600_000);
    let metricRow = { id: 'm-old', priceUsd: '0.01', liquidityUsd: '120000', at: staleAt };
    const db = {
      user: { findUnique: vi.fn(async () => ({ id: 'user-1', mode: 'PAPER', permission: { aiTradingEnabled: true } })) },
      token: {
        findUnique: vi.fn(async () => ({ id: 'tok-1', mint, symbol: 'MEME', name: 'Meme Token', blacklisted: false, createdOnChainAt: null })),
        update: vi.fn(async () => ({ id: 'tok-1', mint, symbol: 'MEME', name: 'Meme Token' })),
      },
      agentDecision: { findFirst: vi.fn(async () => null) },
      tokenMetric: {
        findFirst: vi.fn(async () => metricRow),
        create: vi.fn(async ({ data }: { data: { priceUsd: number; liquidityUsd: number; at: Date } }) => {
          metricRow = { id: 'm-fresh', priceUsd: String(data.priceUsd), liquidityUsd: String(data.liquidityUsd), at: data.at };
          return metricRow;
        }),
      },
      position: { findFirst: vi.fn(async () => null) },
      tokenHolderMetric: { findFirst: vi.fn(async () => null) },
      tokenRiskMetric: { findFirst: vi.fn(async () => null) },
      auditLog: { create: vi.fn(async ({ data }: { data: { detail: unknown } }) => ({ id: 'preview-2', detail: data.detail })) },
    } as unknown as PrismaClient;
    const marketQuotes = {
      name: 'dexscreener',
      getSnapshots: vi.fn(async () => new Map([[mint, {
        mint, symbol: 'MEME', name: 'Meme Token', priceUsd: 0.025, marketCapUsd: 250_000, marketCapIsFdv: false,
        liquidityUsd: 120_000, volume24hUsd: 80_000, priceChange1hPct: 5, pairAddress: 'Pair111111111111111111111111111111111111111', dexId: 'raydium', pairCreatedAt: null,
      }]])),
    };
    const app = Fastify();
    registerPaperTradeRoutes(app, { db, verifier: { verify: async () => ({ privyUserId: 'u1' }) }, now: () => now, quotes, marketQuotes });

    const res = await app.inject({ method: 'POST', url: '/v1/paper-trades/preview', payload: { side: 'BUY', mint, sizeSol: 0.1 } });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ side: 'BUY', mint, sizeSol: 0.1, simulated: true });
    expect(marketQuotes.getSnapshots).toHaveBeenCalledWith([mint]);
  });
});
