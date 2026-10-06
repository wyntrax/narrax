import { z } from 'zod';

export const AiConfigSchema = z.object({
  fastModel: z.string().min(1).max(80),
  reasoningModel: z.string().min(1).max(80),
  /** Optional second opinion on BUY decisions. When set and it cannot answer, a BUY is blocked. */
  judgeModel: z.string().min(1).max(80).nullable(),
  temperature: z.number().min(0).max(1),
  reasoningLevel: z.enum(['low', 'medium', 'high']),
  /** A BUY below this confidence is downgraded to WATCH. */
  confidenceThreshold: z.number().min(0.5).max(0.99),
  /** Tokens (input plus output) the AI may use per UTC day. */
  tokenBudget: z.number().int().min(0).max(100_000_000),
  maxTokensPerCall: z.number().int().min(200).max(8000),
  /** Tokens the chat agent may use per UTC day across all users. Separate from tokenBudget, so chat can never starve the analysis pipeline. */
  chatTokenBudget: z.number().int().min(0).max(100_000_000),
  /** Tokens the chat agent may use per user per UTC day. */
  chatTokensPerUserPerDay: z.number().int().min(0).max(10_000_000),
  minOpportunityScoreForBuy: z.number().min(0).max(100),
  maxSuggestedSizePct: z.number().min(0).max(100),
  maxSlippageBps: z.number().int().min(0).max(1000),
  maxPriceImpactPct: z.number().min(0).max(10),
});
export type AiConfig = z.infer<typeof AiConfigSchema>;

/** Model names follow the spec's fast and deep roles and are placeholders. Set the real ones in the admin settings. */
export const DEFAULT_AI_CONFIG: AiConfig = {
  fastModel: 'gpt-6-luna', reasoningModel: 'gpt-6-sol', judgeModel: null, temperature: 0.2, reasoningLevel: 'medium',
  confidenceThreshold: 0.75, tokenBudget: 2_000_000, maxTokensPerCall: 1500, chatTokenBudget: 500_000, chatTokensPerUserPerDay: 50_000, minOpportunityScoreForBuy: 60,
  maxSuggestedSizePct: 5, maxSlippageBps: 150, maxPriceImpactPct: 2,
};
