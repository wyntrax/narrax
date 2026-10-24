import { describe, expect, it } from 'vitest';
import { EARLY_RULES, evaluateEarly, evaluateEarlyBoth, type EarlyInputs } from './index';

const base: EarlyInputs = {
  marketCapUsd: 45_000, liquidityUsd: 12_000, volume24hUsd: 60_000, holders: 400, holdersThen: 300, top10Pct: 28, devHoldingPct: 2,
  smartWalletHolders: 2, tokenAgeMinutes: 3 * 24 * 60, relation: 'OG', ogScore: 80, narrativeScore: 70, narrativeStage: 'EMERGING',
  narrativeManipulationRisk: 20, divergence: 'POSITIVE', priceGrowth1hPct: 8, riskFlags: [],
};

describe('early radar', () => {
  it('keeps the $100K ceiling: at or above it nothing is ranked', () => {
    expect(evaluateEarly('trencher', { ...base, marketCapUsd: 99_999, liquidityUsd: 12_000 }).eligible).toBe(true);
    for (const cap of [EARLY_RULES.maxMarketCapUsd, 250_000]) {
      const r = evaluateEarly('trencher', { ...base, marketCapUsd: cap, liquidityUsd: 30_000 });
      expect(r).toMatchObject({ eligible: false, score: 0, tier: 'EXCLUDED' });
      expect(r.reasons).toContain('ABOVE_MARKET_CAP_CEILING');
    }
  });
  it('excludes dust caps, honeypots, active authorities and suspicious copies', () => {
    expect(evaluateEarly('trencher', { ...base, marketCapUsd: 500, liquidityUsd: 4_000 }).reasons).toContain('BELOW_MARKET_CAP_FLOOR');
    for (const flag of ['HONEYPOT', 'MINT_AUTHORITY_ACTIVE', 'FREEZE_AUTHORITY_ACTIVE']) expect(evaluateEarly('trencher', { ...base, riskFlags: [flag] }).reasons).toContain(flag);
    expect(evaluateEarly('trencher', { ...base, relation: 'SUSPICIOUS' }).reasons).toContain('SUSPICIOUS_COPY');
  });
  it('fails closed on unknown holders, concentration, age and non-finite market data', () => {
    expect(evaluateEarly('trencher', { ...base, holders: null }).reasons).toContain('HOLDERS_UNKNOWN');
    expect(evaluateEarly('trencher', { ...base, top10Pct: null }).reasons).toContain('CONCENTRATION_UNKNOWN');
    expect(evaluateEarly('trencher', { ...base, tokenAgeMinutes: null }).reasons).toContain('AGE_UNKNOWN');
    expect(evaluateEarly('trencher', { ...base, marketCapUsd: NaN }).reasons).toEqual(['MARKET_DATA_MISSING']);
  });
  it('holder profile is stricter than trencher on age, holders, concentration and dev share', () => {
    const young = { ...base, tokenAgeMinutes: 90, holders: 80, top10Pct: 55, devHoldingPct: 9, liquidityUsd: 6_000 };
    expect(evaluateEarly('trencher', young).eligible).toBe(true);
    const h = evaluateEarly('holder', young);
    expect(h.eligible).toBe(false);
    expect(h.reasons).toEqual(expect.arrayContaining(['TOO_YOUNG_FOR_HOLDER_PROFILE', 'TOO_FEW_HOLDERS', 'TOP_HOLDERS_TOO_CONCENTRATED', 'DEV_HOLDING_TOO_HIGH', 'LIQUIDITY_TOO_LOW']));
    // Unknown dev share is flagged, and holder is capped below STRONG, because free sources never report it.
    const unknownDev = evaluateEarly('holder', { ...base, devHoldingPct: null });
    expect(unknownDev.eligible).toBe(true);
    expect(unknownDev.flags).toContain('DEV_HOLDING_UNKNOWN');
    expect(unknownDev.score).toBeLessThanOrEqual(EARLY_RULES.holderUnknownDevCap);
    expect(unknownDev.tier).not.toBe('STRONG');
    expect(evaluateEarly('trencher', { ...base, devHoldingPct: null }).flags).toContain('DEV_HOLDING_UNKNOWN');
  });
  it('a healthy small token scores well for both profiles', () => {
    const both = evaluateEarlyBoth(base);
    expect(both.trencher.eligible && both.holder.eligible).toBe(true);
    expect(both.trencher.score).toBeGreaterThanOrEqual(EARLY_RULES.tiers.watch);
    expect(both.holder.score).toBeGreaterThanOrEqual(EARLY_RULES.tiers.watch);
  });
  it('weights sum to 100 per profile', () => {
    for (const p of ['trencher', 'holder'] as const) expect(Object.values<number>(EARLY_RULES.weights[p]).reduce((a, b) => a + b, 0)).toBe(100);
  });
  it('a saturated narrative and a decayed one rank below an emerging one', () => {
    const e = evaluateEarly('trencher', base).score;
    expect(evaluateEarly('trencher', { ...base, narrativeStage: 'SATURATED' }).score).toBeLessThan(e);
    expect(evaluateEarly('trencher', { ...base, narrativeStage: 'DECAYING' }).score).toBeLessThan(e);
  });
  it('caps flagged tokens: wash volume, manipulated narrative and price that ran ahead', () => {
    const strong = { ...base, narrativeScore: 100, narrativeManipulationRisk: 0, divergence: 'STRONG_POSITIVE' as const, priceGrowth1hPct: 40, smartWalletHolders: 5, holdersThen: 100, holders: 1000 };
    expect(evaluateEarly('trencher', strong).score).toBeGreaterThan(70);
    expect(evaluateEarly('trencher', { ...strong, volume24hUsd: strong.marketCapUsd * 40 })).toMatchObject({ flags: expect.arrayContaining(['POSSIBLE_WASH_VOLUME']) });
    expect(evaluateEarly('trencher', { ...strong, volume24hUsd: strong.marketCapUsd * 40 }).score).toBeLessThanOrEqual(60);
    expect(evaluateEarly('trencher', { ...strong, narrativeManipulationRisk: 70 }).score).toBeLessThanOrEqual(55);
    expect(evaluateEarly('trencher', { ...strong, divergence: 'NEGATIVE_SATURATED' }).score).toBeLessThanOrEqual(60);
  });
  it('unknown narrative organic score is neutral and flagged, not treated as clean', () => {
    const r = evaluateEarly('trencher', { ...base, narrativeManipulationRisk: null });
    expect(r.flags).toContain('NARRATIVE_ORGANIC_UNKNOWN');
    expect(r.components.organic).toBe(50);
  });
  it('real holder growth beats unknown growth', () => {
    expect(evaluateEarly('holder', { ...base, holdersThen: 200 }).components.community).toBeGreaterThan(evaluateEarly('holder', { ...base, holdersThen: null }).components.community);
  });
  it('a token found through social chatter has an unverified origin: neutral, flagged, capped for holders', () => {
    const r = evaluateEarlyBoth({ ...base, relation: 'UNKNOWN', ogScore: null, narrativeScore: 100, narrativeManipulationRisk: 0, divergence: 'STRONG_POSITIVE' });
    expect(r.trencher.flags).toContain('ORIGIN_UNVERIFIED');
    expect(r.holder.score).toBeLessThanOrEqual(65);
  });
  it('a ticker-only match is capped, because a copycat can share the symbol', () => {
    const strong = { ...base, narrativeScore: 100, narrativeManipulationRisk: 0, divergence: 'STRONG_POSITIVE' as const, priceGrowth1hPct: 40, smartWalletHolders: 5, holders: 1000, holdersThen: 100 };
    const r = evaluateEarly('trencher', { ...strong, symbolOnlyMatch: true });
    expect(r.flags).toContain('TICKER_MATCH_ONLY');
    expect(r.score).toBeLessThanOrEqual(60);
    expect(evaluateEarly('trencher', strong).score).toBeGreaterThan(70);
  });
});
