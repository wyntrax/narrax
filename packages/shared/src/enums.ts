import { z } from 'zod';

export const TradingMode = z.enum(['PAPER', 'SHADOW', 'SEMI_AUTO', 'AUTO']);
export type TradingMode = z.infer<typeof TradingMode>;

export const DecisionAction = z.enum(['BUY', 'WATCH', 'HOLD', 'REDUCE', 'SELL', 'IGNORE']);
export type DecisionAction = z.infer<typeof DecisionAction>;

export const NarrativeStage = z.enum([
  'SEED', 'EMERGING', 'ACCELERATING', 'MAINSTREAM', 'SATURATED', 'DECAYING', 'DEAD',
]);
export type NarrativeStage = z.infer<typeof NarrativeStage>;

export const FastClassification = z.enum(['IGNORE', 'WATCH', 'ANALYZE', 'URGENT_ANALYZE']);
export type FastClassification = z.infer<typeof FastClassification>;

export const AlertPriority = z.enum(['INFO', 'WATCH', 'IMPORTANT', 'CRITICAL']);
export type AlertPriority = z.infer<typeof AlertPriority>;
