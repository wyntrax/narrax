import {z} from 'zod';
import {TradeabilityQuoteSchema,TRADEABILITY_MAX_AGE_MS} from './tradeability';

const date=z.string().datetime({offset:true}),n=z.number().finite().nonnegative().nullable(),pct=z.number().finite().min(0).max(100).nullable();
export const LATEST_EVIDENCE_MAX_AGE_MS={market:15*60000,holders:60*60000,risk:60*60000,rugcheck:10*60000,tradeability:TRADEABILITY_MAX_AGE_MS} as const;
export const EvidenceStateSchema=z.enum(['FRESH','STALE','UNVERIFIED','MISSING','INVALID']);
export const HolderObservationSchema=z.object({mint:z.string(),source:z.string().min(1),sourceAt:date.nullable(),retrievedAt:date,holders:z.number().int().nonnegative(),top10Pct:pct,devHoldingPct:pct});
const recorded=<T extends z.ZodTypeAny>(data:T)=>z.object({state:EvidenceStateSchema,at:date.nullable(),source:z.string().nullable(),data:data.nullable()});
export const RugcheckObservationSchema=z.object({mint:z.string(),source:z.literal('rugcheck'),sourceAt:date,devHoldingPct:z.number().finite().min(0).max(100).nullable(),top10ExLpPct:z.number().finite().min(0).max(100).nullable(),lpBurnedPct:z.number().finite().min(0).max(100).nullable(),lpLocked:z.boolean().nullable(),riskFlags:z.array(z.string().min(1).max(80)).max(20)});
export const LatestEvidenceSchema=z.object({
 checkedAt:date,
 market:recorded(z.object({priceUsd:n,liquidityUsd:n,marketCapUsd:n})),
   holders:recorded(z.object({holders:z.number().int().nonnegative(),top10Pct:pct,devHoldingPct:pct})).extend({retrievedAt:date.nullable().optional()}),
 risk:recorded(z.object({flags:z.array(z.string())})),
 rugcheck:recorded(RugcheckObservationSchema),
 tradeability:recorded(TradeabilityQuoteSchema),
});
export type LatestEvidence=z.infer<typeof LatestEvidenceSchema>;
