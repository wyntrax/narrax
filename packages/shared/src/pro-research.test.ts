import { describe, expect, it } from 'vitest';
import { FEATURE_TIERS, featureAllowed } from './entitlements';
import { evaluatePersonalResearch, ResearchMonitorInputSchema, ResearchRulesSchema, type PersonalEvidence, type ResearchRules } from './pro-research';
const now = new Date('2026-10-25T12:00:00Z');
const rules: ResearchRules = { minLiquidityUsd: 200_000, minIndependentBuyers: 3, windowMinutes: 30, minNarrativeVelocity: 2, maxRiskScore: 30 };
const reading = (value: number) => ({ value, at: now.toISOString(), source: 'fixture', refs: ['evidence'] });
const evidence = (): PersonalEvidence => ({ liquidity: reading(250_000), buyers: reading(3), narrative: reading(2), risk: reading(20), blocked: false });
describe('personal research evidence policy', () => {
  it('requires all selected conditions and preserves their observation references', () => {
    const result = evaluatePersonalResearch(rules, evidence(), now);
    expect(result.status).toBe('MATCH'); expect(result.checks).toHaveLength(4);
    expect(result.checks.every(c => c.refs[0] === 'evidence')).toBe(true);
    expect(evaluatePersonalResearch(rules, { ...evidence(), risk: reading(31) }, now).status).toBe('NO_MATCH');
    expect(evaluatePersonalResearch(rules, { ...evidence(), blocked: true }, now).status).toBe('NO_MATCH');
  });
  it.each([null, { ...reading(3), at: new Date(+now + 1).toISOString() }, { ...reading(3), at: new Date(+now - 16 * 60_000).toISOString() }, reading(NaN)])('never counts absent, future, stale or invalid wallet evidence as a pass: %j', buyers => {
    const result = evaluatePersonalResearch(rules, { ...evidence(), buyers }, now);
    expect(result.status).toBe('UNKNOWN'); expect(result.checks.find(c => c.key === 'buyers')?.value).toBeNull();
  });
  it('does not require disabled conditions; an observed failure remains a failure alongside gaps', () => {
    expect(evaluatePersonalResearch({ ...rules, minIndependentBuyers: null }, { ...evidence(), buyers: null }, now).status).toBe('MATCH');
    expect(evaluatePersonalResearch(rules, { ...evidence(), buyers: null, liquidity: reading(1) }, now).status).toBe('NO_MATCH');
  });
  it.each([['risk', -1], ['risk', 101], ['buyers', 3.5], ['buyers', -1], ['liquidity', -1]] as const)('does not qualify out-of-domain %s evidence (%s)', (key, value) => {
    const result = evaluatePersonalResearch(rules, { ...evidence(), [key]: reading(value) }, now);
    expect(result.status).toBe('UNKNOWN');
    expect(result.checks.find(c => c.key === key)).toMatchObject({ status: 'UNKNOWN', value: null });
  });
  it('rejects empty rules, out-of-range windows, forged fields and invalid mints', () => {
    expect(ResearchRulesSchema.safeParse({ ...rules, minLiquidityUsd: null, minIndependentBuyers: null, minNarrativeVelocity: null, maxRiskScore: null }).success).toBe(false);
    expect(ResearchRulesSchema.safeParse({ ...rules, windowMinutes: 61 }).success).toBe(false);
    expect(ResearchMonitorInputSchema.safeParse({ name: 'Mine', thesis: '', mint: 'not-a-mint', narrativeSlug: null, rules, active: true, userId: 'someone' }).success).toBe(false);
  });
  it('keeps all Smart Money exploration in Early Access and reserves personal research for PRO', () => {
    for (const [key, tier] of Object.entries(FEATURE_TIERS)) {
      const personal = ['research.personal_radar', 'research.thesis_tracker', 'research.personal_briefing'].includes(key);
      expect(tier).toBe(personal ? 'PRO' : 'EARLY_ACCESS');
      expect(featureAllowed('EARLY_ACCESS', key)).toBe(!personal);
      expect(featureAllowed('PRO', key)).toBe(true);
      expect(featureAllowed('NONE', key)).toBe(false);
    }
  });
});
