import { z } from 'zod';
import { isSolanaAddress } from './solana-address';
import { sanitizeUntrusted } from './untrusted';

/** Operational limits, not validated predictive thresholds. */
export const PRO_RESEARCH_LIMITS = { monitorsPerKind: 20, tokensPerScan: 100, tradesPerToken: 1000,
  intervalMs: 5 * 60_000, marketAgeMs: 15 * 60_000, narrativeAgeMs: 60 * 60_000, riskAgeMs: 60 * 60_000,
  minEntityNetSol: 0.5, alertCooldownMs: 6 * 3_600_000, historyDays: 30 } as const;
const text = (max: number) => z.string().trim().min(1).max(max).transform(s => sanitizeUntrusted(s, max).trim()).refine(s => s.length > 0);
export const ResearchRulesSchema = z.object({
  minLiquidityUsd: z.number().finite().min(0).max(1e12).nullable(),
  minIndependentBuyers: z.number().int().min(1).max(100).nullable(),
  windowMinutes: z.number().int().min(5).max(60),
  minNarrativeVelocity: z.number().finite().min(0).max(1e6).nullable(),
  maxRiskScore: z.number().finite().min(0).max(100).nullable(),
}).strict().refine(r => [r.minLiquidityUsd, r.minIndependentBuyers, r.minNarrativeVelocity, r.maxRiskScore].some(v => v !== null), 'Choose at least one condition');
export const ResearchMonitorInputSchema = z.object({
  name: text(80), thesis: z.string().trim().max(1000).transform(s => sanitizeUntrusted(s, 1000)),
  mint: z.string().refine(isSolanaAddress).nullable(), narrativeSlug: z.string().trim().min(1).max(128).nullable(),
  rules: ResearchRulesSchema, active: z.boolean(),
}).strict();
export type ResearchRules = z.infer<typeof ResearchRulesSchema>;
export const ResearchCheckSchema = z.object({ key: z.enum(['liquidity', 'buyers', 'narrative', 'risk', 'token']),
  status: z.enum(['PASS', 'FAIL', 'UNKNOWN']), value: z.number().finite().nullable(), threshold: z.number().finite().nullable(),
  at: z.string().datetime().nullable(), source: z.string().nullable(), refs: z.array(z.string()), reason: z.string() });
export const ResearchEvaluationSchema = z.object({ status: z.enum(['MATCH', 'NO_MATCH', 'UNKNOWN']), checks: z.array(ResearchCheckSchema), previousStatus: z.enum(['MATCH', 'NO_MATCH', 'UNKNOWN']).nullable().optional() });
export type ResearchEvaluation = z.infer<typeof ResearchEvaluationSchema>;
export type ResearchReading = { value: number; at: string; source: string; refs: string[] } | null;
export interface PersonalEvidence { liquidity: ResearchReading; buyers: ResearchReading; narrative: ResearchReading; risk: ResearchReading; blocked: boolean }
/** All selected conditions must pass. Missing, non-finite, future and stale readings never become zero. */
export function evaluatePersonalResearch(rules: ResearchRules, evidence: PersonalEvidence, now: Date): ResearchEvaluation {
  const checks: ResearchEvaluation['checks'] = [];
  if (evidence.blocked) checks.push({ key: 'token', status: 'FAIL', value: null, threshold: null, at: null, source: null, refs: [], reason: 'TOKEN_UNAVAILABLE' });
  const definitions = [
    ['liquidity', rules.minLiquidityUsd, PRO_RESEARCH_LIMITS.marketAgeMs, false],
    ['buyers', rules.minIndependentBuyers, Math.min(rules.windowMinutes * 60_000, PRO_RESEARCH_LIMITS.marketAgeMs), false],
    ['narrative', rules.minNarrativeVelocity, PRO_RESEARCH_LIMITS.narrativeAgeMs, false],
    ['risk', rules.maxRiskScore, PRO_RESEARCH_LIMITS.riskAgeMs, true],
  ] as const;
  for (const [key, threshold, age, maximum] of definitions) {
    if (threshold === null) continue;
    const reading = evidence[key], at = reading ? Date.parse(reading.at) : NaN;
    const fresh = !!reading && Number.isFinite(reading.value) && Number.isFinite(at) && at <= +now && +now - at <= age;
    const status = !fresh ? 'UNKNOWN' : (maximum ? reading.value <= threshold : reading.value >= threshold) ? 'PASS' : 'FAIL';
    checks.push({ key, status, value: fresh ? reading!.value : null, threshold, at: reading?.at ?? null,
      source: reading?.source ?? null, refs: reading?.refs ?? [], reason: !fresh ? 'MISSING_OR_STALE' : status === 'PASS' ? 'CONDITION_MET' : 'CONDITION_NOT_MET' });
  }
  return { status: checks.some(c => c.status === 'FAIL') ? 'NO_MATCH' : !checks.length || checks.some(c => c.status === 'UNKNOWN') ? 'UNKNOWN' : 'MATCH', checks };
}
export const ResearchRunSchema = z.object({ at: z.string().datetime(), considered: z.number().int(), matched: z.number().int(), unknown: z.number().int(), capped: z.boolean() });
export const ResearchObservationSchema = z.object({ id: z.string(), mint: z.string(), at: z.string().datetime(), evaluation: ResearchEvaluationSchema });
export const ResearchMonitorSchema = ResearchMonitorInputSchema.extend({ id: z.string(), kind: z.enum(['RADAR', 'THESIS']), updatedAt: z.string().datetime(), lastRun: ResearchRunSchema.nullable(), observations: z.array(ResearchObservationSchema) }).strip();
export const ResearchMonitorsSchema = z.object({ items: z.array(ResearchMonitorSchema) });
export const PersonalBriefSchema = z.object({ day: z.string(), generatedAt: z.string().datetime(), since: z.string().datetime(),
  radarMatches: z.number().int(), thesisChanges: z.number().int(), unknown: z.number().int(), capped: z.boolean(),
  items: z.array(z.object({ monitorId: z.string(), name: z.string(), kind: z.enum(['RADAR', 'THESIS']), mint: z.string(), at: z.string().datetime(), previousStatus: z.enum(['MATCH', 'NO_MATCH', 'UNKNOWN']).nullable(), evaluation: ResearchEvaluationSchema })),
});
export const PersonalBriefsSchema = z.object({ items: z.array(PersonalBriefSchema) });
