import { describe, expect, it } from 'vitest';
import {testTradeability} from '../../../scripts/test-tradeability';
import {
  RADAR_SAFETY_POLICY,
  evaluateRadarSafety,
  radarSafetyBlockedSettingKey,
  radarSafetyLabel,
  radarSafetyModeFromEnv,
  radarSafetySettingKey,
  type RadarSafetyFacts,
} from './radarSafety';

const NOW = new Date('2026-10-22T12:00:00Z');
const ago = (minutes: number) => new Date(+NOW - minutes * 60_000);

const base: RadarSafetyFacts = {
  tokenId: 'token-1',
  mint: 'mint-1',
  profile: 'trencher',
  route: 'NARRATIVE',
  matchKind: 'NAME',
  tier: 'WATCH',
  score: 60,
  metricId: 'metric-1',
  holderMetricId: 'holders-1',
  riskMetricId: 'risk-1',
  priceUsd: 0.001,
  marketCapUsd: 50_000,
  liquidityUsd: 15_000,
  volume24hUsd: 30_000,
  holders: 500,
  top10Pct: 30,
  top10ExLpPct: 25,
  devHoldingPct: 2,
  riskFlags: [],
  marketAt: ago(5),
  holdersAt: ago(20),
  riskAt: ago(15),
  priceGrowth1hPct: 10,
  priceGrowth3hPct: 25,
  narrativeManipulationRisk: 20,
  lpBurnedPct: 100,
  lpLocked: null,
  bundlePct: 1,
  sniperPct: 1,
  insiderPct: 1,
  uniqueBuyers24h: 100,
  uniqueSellers24h: 80,
  priceImpactPct: 1,
  tradeabilityAt: NOW,
  tradeability: testTradeability('mint-1',NOW),
  deployerPriorRugs: 0,
};

describe('radar safety gate', () => {
  it('passes only when every critical safety fact is present and acceptable', () => {
    const r = evaluateRadarSafety(base, NOW);
    expect(r.status).toBe('PASS');
    expect(r.wouldBlock).toBe(false);
    expect(r.blockers).toEqual([]);
    expect(r.unknowns).toEqual([]);
    expect(r.warnings).toContain('AUTHORITY_NOT_PROVEN');
    expect(r.facts).toMatchObject({ tokenId: 'token-1', metricId: 'metric-1', holderMetricId: 'holders-1', riskMetricId: 'risk-1' });
  });

  it('blocks concentration, active controls, dev supply, LP, bundle, organic manipulation, wash and impact', () => {
    const cases: Array<[Partial<RadarSafetyFacts>, string]> = [
      [{ top10Pct: RADAR_SAFETY_POLICY.maxTop10Pct }, 'TOP10_CONCENTRATION'],
      [{ top10ExLpPct: RADAR_SAFETY_POLICY.maxTop10ExLpPct }, 'TOP10_EX_LP'],
      [{ devHoldingPct: 11 }, 'DEV_HOLDING'],
      [{ riskFlags: ['MINT_AUTHORITY_ACTIVE'] }, 'MINT_AUTHORITY_ACTIVE'],
      [{ riskFlags: ['HONEYPOT'] }, 'HONEYPOT'],
      [{ riskFlags: ['RUGGED'] }, 'RUGGED'],
      [{ lpLocked: false }, 'LP_CONTROL'],
      [{ lpBurnedPct: 79, lpLocked: null }, 'LP_CONTROL'],
      [{ bundlePct: 10, sniperPct: 8, insiderPct: 5 }, 'BUNDLE_SNIPER_INSIDER'],
      [{ narrativeManipulationRisk: 60 }, 'ORGANIC_EVIDENCE'],
      [{ volume24hUsd: 50_000 * 31, uniqueBuyers24h: 10 }, 'WASH_VOLUME'],
      [{ priceImpactPct: 3.1,tradeability:testTradeability(base.mint,NOW,3.1) }, 'TRADEABILITY'],
      [{ deployerPriorRugs: 1 }, 'DEPLOYER_HISTORY'],
    ];
    for (const [over, code] of cases) {
      const r = evaluateRadarSafety({ ...base, ...over }, NOW);
      expect(r.status, code).toBe('BLOCK');
      expect(r.blockers, code).toContain(code);
    }
  });

  it('uses the profile-specific dev cap', () => {
    expect(evaluateRadarSafety({ ...base, profile: 'holder', devHoldingPct: 6 }, NOW).blockers).toContain('DEV_HOLDING');
    expect(evaluateRadarSafety({ ...base, profile: 'trencher', devHoldingPct: 6 }, NOW).blockers).not.toContain('DEV_HOLDING');
    expect(evaluateRadarSafety({ ...base, profile: 'trencher', devHoldingPct: 11 }, NOW).blockers).toContain('DEV_HOLDING');
  });

  it('fails closed when critical evidence is missing or stale', () => {
    const cases: Array<[Partial<RadarSafetyFacts>, string]> = [
      [{ devHoldingPct: null }, 'DEV_HOLDING'],
      [{ top10ExLpPct: null }, 'TOP10_EX_LP'],
      [{ lpBurnedPct: null, lpLocked: null }, 'LP_CONTROL'],
      [{ bundlePct: null }, 'BUNDLE_SNIPER_INSIDER'],
      [{ narrativeManipulationRisk: null }, 'ORGANIC_EVIDENCE'],
      [{ riskAt: null }, 'RISK_EVIDENCE'],
      [{ riskAt: new Date(+NOW - 61 * 60_000) }, 'RISK_EVIDENCE'],
      [{ riskAt: new Date(+NOW + 1) }, 'RISK_EVIDENCE'],
      [{ marketAt: new Date(+NOW - 16 * 60_000) }, 'MARKET_EVIDENCE'],
      [{ holdersAt: new Date(+NOW - 61 * 60_000) }, 'HOLDER_EVIDENCE'],
      [{ priceImpactPct: null }, 'TRADEABILITY'],
      [{ volume24hUsd: 50_000 * 31, uniqueBuyers24h: null }, 'WASH_VOLUME'],
    ];
    for (const [over, code] of cases) {
      const r = evaluateRadarSafety({ ...base, ...over }, NOW);
      expect(r.status, code).toBe('UNKNOWN');
      expect(r.unknowns, code).toContain(code);
    }
  });

  it('does not let a warning block a call, but keeps it in the snapshot', () => {
    const r = evaluateRadarSafety({ ...base, priceGrowth1hPct: 75, volume24hUsd: 50_000 * 31, uniqueBuyers24h: 100 }, NOW);
    expect(r.status).toBe('PASS');
    expect(r.warnings).toEqual(expect.arrayContaining(['PRICE_ALREADY_EXTENDED', 'WASH_TURNOVER_HIGH']));
  });

  it('gives a confirmed blocker precedence over missing evidence', () => {
    const r = evaluateRadarSafety({ ...base, top10Pct: 40, devHoldingPct: null }, NOW);
    expect(r.status).toBe('BLOCK');
    expect(r.blockers).toContain('TOP10_CONCENTRATION');
    expect(r.unknowns).toContain('DEV_HOLDING');
    expect(r.wouldBlock).toBe(true);
  });

  it('treats an invalid or absent mode as shadow', () => {
    expect(radarSafetyModeFromEnv({})).toBe('shadow');
    expect(radarSafetyModeFromEnv({ RADAR_SAFETY_MODE: 'typo' })).toBe('shadow');
    expect(radarSafetyModeFromEnv({ RADAR_SAFETY_MODE: 'ENFORCE' })).toBe('enforce');
    expect(radarSafetyModeFromEnv({ RADAR_SAFETY_MODE: 'off' })).toBe('off');
  });

  it('rechecks optional source freshness at publication', () => {
    for (const evidenceAt of [null, ago(11), new Date(+NOW + 1)]) {
      const result = evaluateRadarSafety({ ...base, evidenceSource: 'rugcheck', evidenceAt }, NOW);
      expect(result.status).toBe('UNKNOWN');
      expect(result.unknowns).toContain('SOURCE_EVIDENCE');
    }
    expect(evaluateRadarSafety({ ...base, evidenceSource: 'rugcheck', evidenceAt: ago(1) }, NOW).status).toBe('PASS');
  });

  it('requires fresh, matching quote provenance at publication, including after a lock wait',()=>{
    for(const at of [null,ago(11),new Date(+NOW+1),new Date(NaN)]){
      const r=evaluateRadarSafety({...base,tradeabilityAt:at,tradeability:at&&Number.isFinite(+at)?testTradeability(base.mint,at):null},NOW);
      expect(r.status).toBe('UNKNOWN');expect(r.unknowns).toContain('TRADEABILITY');
    }
    for(const tradeability of [null,testTradeability('wrong-mint',NOW),testTradeability(base.mint,NOW,0.5)]){
      expect(evaluateRadarSafety({...base,tradeability},NOW).unknowns).toContain('TRADEABILITY');
    }
    const quoteAt=ago(10);
    const f={...base,tradeabilityAt:quoteAt,tradeability:testTradeability(base.mint,quoteAt)};
    expect(evaluateRadarSafety(f,NOW).status).toBe('PASS');
    expect(evaluateRadarSafety(f,new Date(+NOW+1)).unknowns).toContain('TRADEABILITY');
  });

  it('builds stable setting keys and a non-alarming label', () => {
    expect(radarSafetySettingKey('alert-1')).toBe('research.radarSafety.alert-1');
    expect(radarSafetyBlockedSettingKey('token-1', 'holder')).toBe('research.radarSafetyBlocked.token-1.holder');
    expect(radarSafetyLabel(evaluateRadarSafety(base, NOW))).toBe('Safety evidence: PASS. Top-10 excluding known pool/locker accounts 25.0%. Warnings: AUTHORITY_NOT_PROVEN.');
    expect(radarSafetyLabel(evaluateRadarSafety({ ...base, devHoldingPct: null }, NOW))).toMatch(/UNKNOWN \(DEV_HOLDING\)/);
  });
});
