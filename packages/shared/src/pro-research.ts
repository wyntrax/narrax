import { z } from 'zod';
import { isSolanaAddress } from './solana-address';
import { sanitizeUntrusted } from './untrusted';

/** Operational limits, not validated predictive thresholds. */
export const PRO_RESEARCH_LIMITS = { monitorsPerKind: 20, tokensPerScan: 100, tradesPerToken: 1000,
  intervalMs: 5 * 60_000, marketAgeMs: 15 * 60_000, holderAgeMs: 60 * 60_000, narrativeAgeMs: 60 * 60_000, riskAgeMs: 60 * 60_000,
  minEntityNetSol: 0.5, alertCooldownMs: 6 * 3_600_000, historyDays: 30 } as const;
const text = (max: number) => z.string().trim().min(1).max(max).transform(s => sanitizeUntrusted(s, max).trim()).refine(s => s.length > 0);
export const ResearchRulesSchema = z.object({
  minLiquidityUsd: z.number().finite().min(0).max(1e12).nullable(),
  minIndependentBuyers: z.number().int().min(1).max(100).nullable(),
  windowMinutes: z.number().int().min(5).max(60),
  minNarrativeVelocity: z.number().finite().min(0).max(1e6).nullable(),
  maxRiskScore: z.number().finite().min(0).max(100).nullable(),
  // Advanced PRO multi-factor conditions (optional for backwards compatibility with saved monitors)
  minNetFlowSol: z.number().finite().min(0.01).max(1e6).nullable().optional(),
  minMarketCapUsd: z.number().finite().min(0).max(1e12).nullable().optional(),
  maxMarketCapUsd: z.number().finite().min(1).max(1e12).nullable().optional(),
  minHolders: z.number().int().min(1).max(1e9).nullable().optional(),
  maxTop10Pct: z.number().finite().min(0.1).max(100).nullable().optional(),
  minPriceChange1hPct: z.number().finite().min(-99.9).max(1e6).nullable().optional(),
}).strict()
  .refine(r => [
    r.minLiquidityUsd, r.minIndependentBuyers, r.minNarrativeVelocity, r.maxRiskScore,
    r.minNetFlowSol ?? null, r.minMarketCapUsd ?? null, r.maxMarketCapUsd ?? null,
    r.minHolders ?? null, r.maxTop10Pct ?? null, r.minPriceChange1hPct ?? null,
  ].some(v => v !== null), 'Choose at least one condition')
  .refine(r => !(r.minMarketCapUsd != null && r.maxMarketCapUsd != null && r.minMarketCapUsd > r.maxMarketCapUsd), 'Minimum market cap cannot exceed maximum market cap');
export const ResearchMonitorInputSchema = z.object({
  name: text(80), thesis: z.string().trim().max(1000).transform(s => sanitizeUntrusted(s, 1000)),
  mint: z.string().refine(isSolanaAddress).nullable(), narrativeSlug: z.string().trim().min(1).max(128).nullable(),
  rules: ResearchRulesSchema, active: z.boolean(),
}).strict();
export type ResearchRules = z.infer<typeof ResearchRulesSchema>;
export const ResearchCheckKeySchema = z.enum([
  'liquidity', 'buyers', 'netFlowSol', 'marketCapMin', 'marketCapMax',
  'holders', 'top10Pct', 'momentum1h', 'narrative', 'risk', 'token',
]);
export type ResearchCheckKey = z.infer<typeof ResearchCheckKeySchema>;
export const ResearchCheckSchema = z.object({ key: ResearchCheckKeySchema,
  status: z.enum(['PASS', 'FAIL', 'UNKNOWN']), value: z.number().finite().nullable(), threshold: z.number().finite().nullable(),
  at: z.string().datetime().nullable(), source: z.string().nullable(), refs: z.array(z.string()), reason: z.string() });
export const ResearchSnapshotSchema = z.object({
  symbol: z.string().nullable().optional(),
  tokenName: z.string().nullable().optional(),
  priceUsd: z.number().finite().positive().nullable().optional(),
  marketCapUsd: z.number().finite().positive().nullable().optional(),
  liquidityUsd: z.number().finite().nonnegative().nullable().optional(),
  netFlowSol: z.number().finite().nullable().optional(),
});
export type ResearchSnapshot = z.infer<typeof ResearchSnapshotSchema>;
export const ResearchEvaluationSchema = z.object({
  status: z.enum(['MATCH', 'NO_MATCH', 'UNKNOWN']),
  checks: z.array(ResearchCheckSchema),
  previousStatus: z.enum(['MATCH', 'NO_MATCH', 'UNKNOWN']).nullable().optional(),
  snapshot: ResearchSnapshotSchema.optional(),
});
export type ResearchEvaluation = z.infer<typeof ResearchEvaluationSchema>;
export type ResearchReading = { value: number; at: string; source: string; refs: string[] } | null;
export interface PersonalEvidence {
  liquidity: ResearchReading;
  buyers: ResearchReading;
  narrative: ResearchReading;
  risk: ResearchReading;
  blocked: boolean;
  netFlowSol?: ResearchReading;
  marketCap?: ResearchReading;
  holders?: ResearchReading;
  top10Pct?: ResearchReading;
  momentum1h?: ResearchReading;
  snapshot?: ResearchSnapshot;
}
/** All selected conditions must pass. Missing, non-finite, future and stale readings never become zero. */
export function evaluatePersonalResearch(rules: ResearchRules, evidence: PersonalEvidence, now: Date): ResearchEvaluation {
  const checks: ResearchEvaluation['checks'] = [];
  if (evidence.blocked) checks.push({ key: 'token', status: 'FAIL', value: null, threshold: null, at: null, source: null, refs: [], reason: 'TOKEN_UNAVAILABLE' });
  const walletAge = Math.min(rules.windowMinutes * 60_000, PRO_RESEARCH_LIMITS.marketAgeMs);
  const definitions: readonly [ResearchCheckKey, number | null, ResearchReading, number, boolean][] = [
    ['liquidity', rules.minLiquidityUsd, evidence.liquidity, PRO_RESEARCH_LIMITS.marketAgeMs, false],
    ['buyers', rules.minIndependentBuyers, evidence.buyers, walletAge, false],
    ['netFlowSol', rules.minNetFlowSol ?? null, evidence.netFlowSol ?? null, walletAge, false],
    ['marketCapMin', rules.minMarketCapUsd ?? null, evidence.marketCap ?? null, PRO_RESEARCH_LIMITS.marketAgeMs, false],
    ['marketCapMax', rules.maxMarketCapUsd ?? null, evidence.marketCap ?? null, PRO_RESEARCH_LIMITS.marketAgeMs, true],
    ['holders', rules.minHolders ?? null, evidence.holders ?? null, PRO_RESEARCH_LIMITS.holderAgeMs, false],
    ['top10Pct', rules.maxTop10Pct ?? null, evidence.top10Pct ?? null, PRO_RESEARCH_LIMITS.holderAgeMs, true],
    ['momentum1h', rules.minPriceChange1hPct ?? null, evidence.momentum1h ?? null, PRO_RESEARCH_LIMITS.marketAgeMs, false],
    ['narrative', rules.minNarrativeVelocity, evidence.narrative, PRO_RESEARCH_LIMITS.narrativeAgeMs, false],
    ['risk', rules.maxRiskScore, evidence.risk, PRO_RESEARCH_LIMITS.riskAgeMs, true],
  ];
  for (const [key, threshold, reading, age, maximum] of definitions) {
    if (threshold === null) continue;
    const at = reading ? Date.parse(reading.at) : NaN;
    const validValue = !!reading && Number.isFinite(reading.value)
      && (key !== 'risk' || (reading.value >= 0 && reading.value <= 100))
      && (key !== 'top10Pct' || (reading.value >= 0 && reading.value <= 100))
      && (key !== 'buyers' || (Number.isInteger(reading.value) && reading.value >= 0))
      && (key !== 'holders' || (Number.isInteger(reading.value) && reading.value >= 0))
      && ((key !== 'liquidity' && key !== 'marketCapMin' && key !== 'marketCapMax') || reading.value >= 0);
    const fresh = validValue && Number.isFinite(at) && at <= +now && +now - at <= age;
    const status = !fresh ? 'UNKNOWN' : (maximum ? reading.value <= threshold : reading.value >= threshold) ? 'PASS' : 'FAIL';
    checks.push({ key, status, value: fresh ? reading!.value : null, threshold, at: reading?.at ?? null,
      source: reading?.source ?? null, refs: reading?.refs ?? [], reason: !fresh ? 'MISSING_OR_STALE' : status === 'PASS' ? 'CONDITION_MET' : 'CONDITION_NOT_MET' });
  }
  return {
    status: checks.some(c => c.status === 'FAIL') ? 'NO_MATCH' : !checks.length || checks.some(c => c.status === 'UNKNOWN') ? 'UNKNOWN' : 'MATCH',
    checks,
    ...(evidence.snapshot ? { snapshot: evidence.snapshot } : {}),
  };
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
