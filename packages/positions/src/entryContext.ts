import { z } from 'zod';

export const NARRATIVE_STAGES = ['SEED', 'EMERGING', 'ACCELERATING', 'MAINSTREAM', 'SATURATED', 'DECAYING', 'DEAD'] as const;
export type NarrativeStageName = (typeof NARRATIVE_STAGES)[number];

const pct = (max: number) => z.number().min(0).max(max).nullable();

/** Exit rules fixed when the position is opened. A null rule is simply not applied. */
export const ExitRulesSchema = z.object({ stopLossPct: pct(100), takeProfitPct: pct(10_000), trailingStopPct: pct(100) });
export type ExitRules = z.infer<typeof ExitRulesSchema>;

/**
 * What was true when the position was opened. Stored in Position.entryContext. The monitor compares today's facts with
 * these, so every field that can be unknown is nullable. Unknown is never stored as zero.
 */
export const EntryContextSchema = z.object({
  version: z.literal(1),
  capturedAt: z.string().datetime(),
  priceUsd: z.number().positive(),
  liquidityUsd: z.number().min(0),
  volume24hUsd: z.number().min(0),
  holders: z.number().int().min(0).nullable(),
  top10Pct: pct(100),
  narrative: z.object({ id: z.string(), score: z.number(), velocity: z.number(), stage: z.enum(NARRATIVE_STAGES) }).nullable(),
  smartMoney: z.object({ score: z.number(), walletCount: z.number().int().min(0), independentEntities: z.number().int().min(0) }).nullable(),
  exit: ExitRulesSchema,
});
export type EntryContext = z.infer<typeof EntryContextSchema>;

/** Older or hand-made rows may not match. Callers treat null as "no entry baseline" and say so, they do not guess. */
export function parseEntryContext(raw: unknown): EntryContext | null {
  const r = EntryContextSchema.safeParse(raw);
  return r.success ? r.data : null;
}
