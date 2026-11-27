import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@narra/database';
import { synthesizeSignalOpportunities } from './signalOpportunities';

const NOW = new Date('2026-11-27T00:00:00Z');

describe('synthesizeSignalOpportunities', () => {
  it('creates Opportunity rows from qualified Smart Money Flow and Early Radar tokens while skipping thin liquidity and mega-caps', async () => {
    const created: Record<string, unknown>[] = [];
    const db = {
      walletResearchSignal: {
        findMany: vi.fn(async () => [
          { tokenId: 'tok-flow', walletCount: 4, independentEntities: 3, netFlowSol: '12.5' },
          { tokenId: 'tok-mega', walletCount: 5, independentEntities: 4, netFlowSol: '25' },
        ]),
      },
      earlyRadarOutcome: {
        findMany: vi.fn(async () => [
          { tokenId: 'tok-radar', score: 78 },
          { tokenId: 'tok-thin', score: 72 },
        ]),
      },
      token: {
        findMany: vi.fn(async () => [
          {
            id: 'tok-flow',
            mint: 'FlowMint11111111111111111111111111111111111',
            symbol: 'FLOW',
            createdOnChainAt: new Date(NOW.getTime() - 4 * 3_600_000),
            metrics: [{ priceUsd: '0.02', liquidityUsd: '120000', marketCapUsd: '800000', at: new Date(NOW.getTime() - 2 * 60_000) }],
            holders: [{ holders: 450, top10Pct: 24, devHoldingPct: 2 }],
            consensus: [],
            narratives: [],
          },
          {
            id: 'tok-mega',
            mint: 'MegaMint11111111111111111111111111111111111',
            symbol: 'PUMP',
            createdOnChainAt: new Date(NOW.getTime() - 30 * 86_400_000),
            metrics: [{ priceUsd: '0.005', liquidityUsd: '18000000', marketCapUsd: '500000000', at: new Date(NOW.getTime() - 2 * 60_000) }],
            holders: [{ holders: 400_000, top10Pct: 18, devHoldingPct: 0 }],
            consensus: [],
            narratives: [],
          },
          {
            id: 'tok-radar',
            mint: 'RadarMint1111111111111111111111111111111111',
            symbol: 'RADAR',
            createdOnChainAt: new Date(NOW.getTime() - 2 * 3_600_000),
            metrics: [{ priceUsd: '0.004', liquidityUsd: '45000', marketCapUsd: '250000', at: new Date(NOW.getTime() - 3 * 60_000) }],
            holders: [{ holders: 220, top10Pct: 29, devHoldingPct: 3 }],
            consensus: [],
            narratives: [],
          },
          {
            id: 'tok-thin',
            mint: 'ThinMint11111111111111111111111111111111111',
            symbol: 'THIN',
            createdOnChainAt: new Date(NOW.getTime() - 2 * 3_600_000),
            metrics: [{ priceUsd: '0.001', liquidityUsd: '8000', marketCapUsd: '35000', at: new Date(NOW.getTime() - 3 * 60_000) }],
            holders: [{ holders: 120, top10Pct: 30, devHoldingPct: 2 }],
            consensus: [],
            narratives: [],
          },
        ]),
      },
      tokenMetric: {
        findFirst: vi.fn(async () => ({ priceUsd: '0.015' })),
        aggregate: vi.fn(async () => ({ _max: { priceUsd: '0.022' } })),
      },
      systemSetting: {
        findMany: vi.fn(async () => []),
      },
      opportunity: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return { id: `opp-${created.length}`, ...data };
        }),
      },
    } as unknown as PrismaClient;

    const res = await synthesizeSignalOpportunities(db, NOW);
    expect(res).toMatchObject({
      flowCandidates: 2,
      radarCandidates: 2,
      opportunitiesWritten: 2,
      skippedMegaCap: 1,
      skippedLowLiquidity: 1,
    });
    expect(created.map(c => c.tokenId)).toEqual(['tok-flow', 'tok-radar']);
    expect(Number(created[0]!.score)).toBeGreaterThanOrEqual(50);
    expect(Number(created[1]!.score)).toBeGreaterThanOrEqual(50);
  });

  it('deduplicates when an Opportunity already exists within 60m with a similar score', async () => {
    const db = {
      walletResearchSignal: { findMany: vi.fn(async () => [{ tokenId: 'tok-1', walletCount: 3, independentEntities: 2, netFlowSol: '8' }]) },
      earlyRadarOutcome: { findMany: vi.fn(async () => []) },
      token: {
        findMany: vi.fn(async () => [{
          id: 'tok-1',
          mint: 'FlowMint11111111111111111111111111111111111',
          symbol: 'FLOW',
          createdOnChainAt: new Date(NOW.getTime() - 4 * 3_600_000),
          metrics: [{ priceUsd: '0.02', liquidityUsd: '120000', marketCapUsd: '800000', at: new Date(NOW.getTime() - 2 * 60_000) }],
          holders: [{ holders: 450, top10Pct: 24, devHoldingPct: 2 }],
          consensus: [],
          narratives: [],
        }]),
      },
      tokenMetric: { findFirst: vi.fn(async () => null), aggregate: vi.fn(async () => ({ _max: { priceUsd: null } })) },
      systemSetting: { findMany: vi.fn(async () => []) },
      opportunity: {
        findFirst: vi.fn(async () => ({ score: 63, createdAt: new Date(NOW.getTime() - 20 * 60_000) })),
        create: vi.fn(),
      },
    } as unknown as PrismaClient;

    const res = await synthesizeSignalOpportunities(db, NOW);
    expect(res.opportunitiesWritten).toBe(0);
    expect(res.skippedDuplicate).toBe(1);
    expect(db.opportunity.create).not.toHaveBeenCalled();
  });
});
