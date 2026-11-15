import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@narra/database';
import { FrozenRadarSafetySchema } from '@narra/shared';
import { evaluateRadarSafety } from '@narra/token-intel';
import { recentPriceDynamics } from './earlyRadarTracking';
import { EARLY_SOCIAL_FLOOR, meetsEarlySocialFloor } from './socialTokens';

const NOW = new Date('2026-11-15T09:00:00Z');
const pt = (i: number) => ({
  externalId: `e${i}`,
  platform: 'x',
  creator: `c${i}`,
  creatorAgeDays: 30,
  engagement: 5,
  at: NOW,
  simhash: 'a',
  textHash: 'b',
});

describe('early social floor and price dynamics', () => {
  it('requires at least EARLY_SOCIAL_FLOOR accounts and posts for social alerts', () => {
    expect(EARLY_SOCIAL_FLOOR).toEqual({ minCreators: 5, minMentions: 8 });
    expect(meetsEarlySocialFloor({ creators: 4, points: Array.from({ length: 10 }, (_, i) => pt(i)) })).toBe(false);
    expect(meetsEarlySocialFloor({ creators: 5, points: Array.from({ length: 7 }, (_, i) => pt(i)) })).toBe(false);
    expect(meetsEarlySocialFloor({ creators: 5, points: Array.from({ length: 8 }, (_, i) => pt(i)) })).toBe(true);
  });

  it('computes 1h/3h growth and peak drawdown from TokenMetric rows', async () => {
    const db = {
      tokenMetric: {
        findFirst: async ({ where }: { where: { at: { lte: Date } } }) => {
          const agoHours = Math.round((+NOW - +where.at.lte) / 3_600_000);
          return agoHours === 1 ? { priceUsd: '0.002' } : { priceUsd: '0.004' };
        },
        aggregate: async () => ({ _max: { priceUsd: '0.005' } }),
      },
    } as unknown as Pick<PrismaClient, 'tokenMetric'>;

    const dyn = await recentPriceDynamics(db, 'tok-1', 0.001, NOW);
    expect(dyn.growth1h).toBeCloseTo(-50, 5);
    expect(dyn.growth3h).toBeCloseTo(-75, 5);
    expect(dyn.drawdownFromPeakPct).toBeCloseTo(80, 5);
  });

  it('validates new safety snapshots including drawdownFromPeakPct through FrozenRadarSafetySchema', () => {
    const snapshot = evaluateRadarSafety({
      tokenId: 't1',
      mint: 'Mint1111111111111111111111111111111111111111',
      profile: 'trencher',
      route: 'SOCIAL',
      matchKind: 'MINT',
      tier: 'WATCH',
      score: 65,
      metricId: 'm1',
      holderMetricId: 'h1',
      riskMetricId: 'r1',
      priceUsd: 0.001,
      marketCapUsd: 40_000,
      liquidityUsd: 12_000,
      volume24hUsd: 20_000,
      holders: 250,
      top10Pct: 45,
      top10ExLpPct: 20,
      devHoldingPct: 1,
      riskFlags: [],
      marketAt: new Date(+NOW - 60_000),
      holdersAt: new Date(+NOW - 60_000),
      riskAt: new Date(+NOW - 60_000),
      priceGrowth1hPct: 12,
      priceGrowth3hPct: 20,
      drawdownFromPeakPct: 60,
      narrativeManipulationRisk: 15,
      lpBurnedPct: 95,
      lpLocked: true,
      bundlePct: 5,
      sniperPct: 5,
      insiderPct: 2,
      sameSlotBuyers: 1,
      uniqueBuyers24h: 100,
      uniqueSellers24h: 80,
      priceImpactPct: 0.4,
      deployerPriorRugs: 0,
      deployerPriorTokens: 0,
      evidenceSource: 'rugcheck',
      evidenceAt: new Date(+NOW - 60_000),
    }, NOW);
    const parsed = FrozenRadarSafetySchema.safeParse(snapshot);
    expect(parsed.success).toBe(true);
    expect(snapshot.blockers).toContain('PRICE_DRAWDOWN');
  });
});
