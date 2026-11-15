import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@narra/database';
import type { LlmProvider } from '@narra/ai';
import { TRADEABILITY_USDC_MINT } from '@narra/shared';
import { collectFacts, runAiAnalysis } from './aiAnalysis';

const now = new Date('2040-01-01T00:00:00Z');
const mint = 'TokenMint11111111111111111111111111111111111';

describe('collectFacts', () => {
  it('includes cached Phase 1-4 safety, launch, drawdown, and tradeability evidence', async () => {
    const db = {
      opportunity: {
        findUnique: async () => ({
          id: 'opp-1',
          tokenId: 'tok-1',
          narrativeId: 'nar-1',
          score: 74,
          narrativeScore: 82,
          smartMoneyScore: 0,
          liquidityScore: 68,
          momentumScore: 65,
          ogScore: 80,
          riskScore: 22,
          attentionGrowth: 150,
          priceGrowth: 20,
          token: {
            id: 'tok-1',
            mint,
            symbol: 'NARRA',
            name: 'Narra Token',
            createdOnChainAt: new Date(now.getTime() - 120 * 60_000),
            metrics: [{ priceUsd: '1.5', liquidityUsd: '250000', at: now }],
            holders: [{ holders: 420, top10Pct: 62, devHoldingPct: 2.5 }],
            consensus: [],
          },
          narrative: {
            name: 'AI Agents',
            summary: 'AI agent narrative',
            stage: 'ACCELERATING',
            score: 82,
            velocity: 150,
            acceleration: 15,
            organicScore: 85,
            saturationRisk: 18,
          },
        }),
      },
      narrativeTokenRelation: {
        findUnique: async () => ({ relation: 'OG', ogScore: 80, confidence: 0.9 }),
      },
      tokenMetric: {
        findFirst: async () => ({ priceUsd: '1.2' }),
        aggregate: async () => ({ _max: { priceUsd: '2.0' } }),
      },
      systemSetting: {
        findMany: async () => [
          {
            key: `research.radarSafetyEvidence.${mint}`,
            value: {
              mint, source: 'rugcheck', sourceAt: now.toISOString(), devHoldingPct: 2.5,
              top10ExLpPct: 19, lpBurnedPct: 100, lpLocked: true, insiderPct: 3, riskFlags: [],
            },
          },
          {
            key: `research.launchEvidence.${mint}`,
            value: {
              mint, status: 'CLEAN', bundlePct: 4, sniperPct: 2, insiderPct: 1, sameSlotBuyers: 1,
              firstBuyers: 12, firstBuyersPct: 9, historyComplete: true, deployer: 'Deployer111',
              deployerSource: 'MINT_AUTHORITY', deployerPriorTokens: 1, deployerPriorRugs: 0,
              source: 'helius-rpc', observedAt: now.toISOString(), detail: 'ok',
            },
          },
          {
            key: `research.radarTradeability.${mint}`,
            value: {
              version: 1, mint, source: 'jupiter', sourceAt: now.toISOString(), direction: 'BUY',
              inputMint: TRADEABILITY_USDC_MINT, inAmount: '50000000', outAmount: '1000000',
              otherAmountThreshold: '995000', slippageBps: 50, routeCount: 1, ticketUsdc: 50, priceImpactPct: 0.42,
            },
          },
        ],
      },
    } as unknown as PrismaClient;

    const collected = (await collectFacts(db, 'opp-1'))!;
    expect(collected.facts.top10ExLpPct).toBe(19);
    expect(collected.facts.drawdownFromPeakPct).toBeCloseTo(25, 2);
    expect(collected.facts.launchEvidence).toMatchObject({ status: 'CLEAN', bundlePct: 4, sniperPct: 2, deployerPriorRugs: 0 });
    expect(collected.facts.tradeability).toMatchObject({ priceImpactPct: 0.42, ticketUsd: 50, source: 'jupiter' });
  });
});

describe('runAiAnalysis candidate filtering & freshness sorting', () => {
  it('excludes dead-quote tokens in scheduled runs and analyzes fresh-quoted opportunities first', async () => {
    const findMany = vi.fn(async (_args?: unknown) => [
      { id: 'opp-stale', tokenId: 'tok-stale', token: { metrics: [{ at: new Date(now.getTime() - 40 * 60_000) }] } },
      { id: 'opp-fresh', tokenId: 'tok-fresh', token: { metrics: [{ at: new Date(now.getTime() - 2 * 60_000) }] } },
    ]);
    const analyzedIds: string[] = [];
    const db = {
      systemSetting: {
        findUnique: async () => null,
        findMany: async () => [],
      },
      agentAnalysis: {
        aggregate: async () => ({ _sum: { inputTokens: 0, outputTokens: 0 } }),
        count: async () => 0,
        create: async () => ({}),
      },
      positionEvaluation: {
        aggregate: async () => ({ _sum: { aiTokens: 0 } }),
      },
      opportunity: {
        findMany,
        findUnique: async ({ where }: { where: { id: string } }) => {
          analyzedIds.push(where.id);
          return {
            id: where.id,
            tokenId: `tok-${where.id}`,
            narrativeId: null,
            score: 70,
            narrativeScore: 75,
            smartMoneyScore: 0,
            liquidityScore: 70,
            momentumScore: 60,
            ogScore: 70,
            riskScore: 20,
            attentionGrowth: 50,
            priceGrowth: 10,
            token: {
              id: `tok-${where.id}`,
              mint,
              symbol: 'TKN',
              name: 'Token',
              createdOnChainAt: now,
              metrics: [{ priceUsd: '1.0', liquidityUsd: '100000', at: now }],
              holders: [{ holders: 200, top10Pct: 25, devHoldingPct: 2 }],
              consensus: [],
            },
            narrative: null,
          };
        },
      },
      tokenMetric: {
        findFirst: async () => ({ priceUsd: '1.0' }),
        aggregate: async () => ({ _max: { priceUsd: '1.0' } }),
      },
    } as unknown as PrismaClient;

    const llm: LlmProvider = {
      complete: async () => ({
        text: JSON.stringify({ classification: 'WATCH', score: 65, reasonCodes: ['OK'], summary: 'watch' }),
        inputTokens: 10,
        outputTokens: 5,
      }),
    };

    const res = await runAiAnalysis(db, { llm }, now, { limit: 1 });
    expect(res.analyzed).toBe(1);
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        token: { blacklisted: false, marketQuoteFailures: { lt: 2 }, metrics: { some: { priceUsd: { gt: 0 } } } },
      },
    });
    expect(analyzedIds).toEqual(['opp-fresh']);
  });
});
