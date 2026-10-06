import type { ZodType } from 'zod';
import { AgentDecisionSchema, FastAgentOutputSchema, type AgentDecision, type FastAgentOutput, type UntrustedField } from '@narra/shared';
import { MIN_HOLDERS, MIN_LIQUIDITY_USD } from '@narra/token-intel';
import type { AiConfig } from './config';
import { extractJson } from './parse';
import { SYSTEM_PROMPT, buildUserMessage, type OpportunityFacts, type PositionReviewFacts, type Stage } from './prompts';
import { ArgumentSchema, JudgeSchema, PositionReviewSchema, RiskAgentSchema, type ArgumentOutput, type JudgeOutput, type PositionReviewOutput, type RiskOutput } from './schemas';
import type { LlmProvider, Usage } from './types';

export interface AnalysisInput {
  facts: OpportunityFacts;
  /** Token names, symbols and narrative text. Reaches the model only under the "untrusted" key of the screening and bull/bear/risk prompts. */
  untrusted: UntrustedField[];
}

export interface AnalysisResult {
  decision: AgentDecision;
  fast: FastAgentOutput | null;
  bull: ArgumentOutput | null;
  bear: ArgumentOutput | null;
  risk: RiskOutput | null;
  judge: JudgeOutput | null;
  /** Deterministic rules that changed or limited the model's answer. Empty when the model's answer stood as given. */
  guardrails: string[];
  usage: Usage[];
  /** True when the expensive reasoning models were used. */
  deep: boolean;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

interface Call<T> { value: T | null; error?: string }

async function runAgent<T>(
  llm: LlmProvider, cfg: AiConfig, usage: Usage[],
  a: { stage: Stage; model: string; reasoning?: boolean; build: (retryNote?: string) => string; schema: ZodType<T> },
): Promise<Call<T>> {
  let note: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await llm.complete({ model: a.model, system: SYSTEM_PROMPT, user: a.build(note), temperature: cfg.temperature, maxTokens: cfg.maxTokensPerCall, ...(a.reasoning ? { reasoningLevel: cfg.reasoningLevel } : {}) });
    } catch {
      return { value: null, error: 'PROVIDER_ERROR' }; // a provider outage is not retried here, and it never becomes a trade
    }
    usage.push({ stage: a.stage, model: a.model, inputTokens: res.inputTokens, outputTokens: res.outputTokens });
    const parsed = a.schema.safeParse(extractJson(res.text));
    if (parsed.success) return { value: parsed.data };
    // One retry, telling the model which fields were wrong. The raw reply is not echoed back.
    const paths = parsed.success ? [] : [...new Set(parsed.error.issues.map((i) => i.path.join('.') || 'root'))].slice(0, 6);
    note = `Your previous reply was not valid. Problem fields: ${paths.join(', ')}. Reply with only the JSON object in the requested shape.`;
  }
  return { value: null, error: 'INVALID_OUTPUT' };
}

function plainDecision(cfg: AiConfig, action: AgentDecision['action'], reasonCodes: string[], summary: string, confidence: number): AgentDecision {
  return {
    action, confidence: clamp(confidence, 0, 1), reasonCodes, positiveSignals: [], negativeSignals: [], risks: [], suggestedPositionSizePct: 0,
    entry: { maxSlippageBps: cfg.maxSlippageBps, maxPriceImpactPct: cfg.maxPriceImpactPct },
    exit: { stopLossPct: null, takeProfitPct: null, trailingStopPct: null }, invalidationConditions: [], summary,
  };
}

const downgrade = (d: AgentDecision, code: string): AgentDecision => ({ ...d, action: 'WATCH', confidence: Math.min(d.confidence, 0.5), suggestedPositionSizePct: 0, reasonCodes: [...d.reasonCodes, code] });

/**
 * Deterministic checks on the model's decision. The model proposes, these rules limit. A BUY needs every one of
 * them to hold, and the Risk Governor still has the final say after this.
 */
export function applyGuardrails(d: AgentDecision, facts: OpportunityFacts, cfg: AiConfig, deep: boolean): { decision: AgentDecision; notes: string[] } {
  const notes: string[] = [];
  let out = d;
  const demote = (code: string) => { out = downgrade(out, code); notes.push(code); };

  if (out.action === 'HOLD' || out.action === 'REDUCE' || out.action === 'SELL') {
    demote('NO_POSITION_CONTEXT'); // exits are decided for held positions by the position monitor, not here
  }
  if (out.action === 'BUY') {
    if (!deep) demote('NO_DEEP_ANALYSIS');
    else if (out.reasonCodes.includes('PROMPT_INJECTION_SUSPECTED')) demote('PROMPT_INJECTION_SUSPECTED');
    else if (facts.relation === 'SUSPICIOUS') demote('SUSPICIOUS_TOKEN');
    else if (facts.liquidityUsd == null || facts.holders == null || facts.liquidityUsd < MIN_LIQUIDITY_USD || facts.holders < MIN_HOLDERS) demote('BELOW_MARKET_FLOORS');
    else if (facts.opportunityScore < cfg.minOpportunityScoreForBuy) demote('OPPORTUNITY_SCORE_TOO_LOW');
    else if (out.confidence < cfg.confidenceThreshold) demote('BELOW_CONFIDENCE_THRESHOLD');
  }
  if (out.action === 'BUY') {
    const size = Math.min(out.suggestedPositionSizePct, cfg.maxSuggestedSizePct);
    const slip = Math.min(out.entry.maxSlippageBps, cfg.maxSlippageBps);
    const impact = Math.min(out.entry.maxPriceImpactPct, cfg.maxPriceImpactPct);
    if (size !== out.suggestedPositionSizePct) notes.push('SIZE_CAPPED');
    if (slip !== out.entry.maxSlippageBps || impact !== out.entry.maxPriceImpactPct) notes.push('ENTRY_LIMITS_TIGHTENED');
    let stop = out.exit.stopLossPct;
    if (stop == null) { stop = 25; notes.push('STOP_LOSS_DEFAULTED'); }
    out = { ...out, suggestedPositionSizePct: size, entry: { maxSlippageBps: slip, maxPriceImpactPct: impact }, exit: { ...out.exit, stopLossPct: stop } };
  } else {
    out = { ...out, suggestedPositionSizePct: 0 };
  }
  return { decision: out, notes };
}

/**
 * Fast screen, then (only if warranted) bull, bear and risk roles in parallel, then a decision agent that sees
 * only their structured output and our facts, then guardrails, then an optional judge on BUY.
 * Every failure path ends in WATCH or IGNORE. Nothing here can place a trade.
 */
export async function analyzeOpportunity(deps: { llm: LlmProvider; config: AiConfig }, input: AnalysisInput): Promise<AnalysisResult> {
  const { llm, config: cfg } = deps;
  const usage: Usage[] = [];
  const result = (decision: AgentDecision, extra: Partial<AnalysisResult> = {}, notes: string[] = []): AnalysisResult => ({
    decision, fast: null, bull: null, bear: null, risk: null, judge: null, guardrails: notes, usage, deep: false, ...extra,
  });

  const fastCall = await runAgent(llm, cfg, usage, {
    stage: 'fast', model: cfg.fastModel, schema: FastAgentOutputSchema,
    build: (retryNote) => buildUserMessage('fast', { facts: input.facts, untrusted: input.untrusted, retryNote }),
  });
  const fast = fastCall.value;
  if (!fast) return result(plainDecision(cfg, 'WATCH', ['FAST_SCREEN_FAILED'], 'The screening step did not return a usable answer, so this stays on watch.', 0));
  if (fast.classification === 'IGNORE') return result(plainDecision(cfg, 'IGNORE', fast.reasonCodes, fast.summary, 1 - fast.score / 100), { fast });
  if (fast.classification === 'WATCH') return result(plainDecision(cfg, 'WATCH', fast.reasonCodes, fast.summary, fast.score / 100), { fast });

  const role = (stage: 'bull' | 'bear' | 'risk') => runAgent<ArgumentOutput | RiskOutput>(llm, cfg, usage, {
    stage, model: cfg.reasoningModel, reasoning: true,
    schema: (stage === 'risk' ? RiskAgentSchema : ArgumentSchema) as ZodType<ArgumentOutput | RiskOutput>,
    build: (retryNote) => buildUserMessage(stage, { facts: input.facts, untrusted: input.untrusted, retryNote }),
  });
  const [bullCall, bearCall, riskCall] = await Promise.all([role('bull'), role('bear'), role('risk')]);
  const bull = bullCall.value as ArgumentOutput | null, bear = bearCall.value as ArgumentOutput | null, risk = riskCall.value as RiskOutput | null;
  const parts = { fast, bull, bear, risk, deep: true };
  if (!bull || !bear || !risk) return result(plainDecision(cfg, 'WATCH', ['DEEP_ANALYSIS_INCOMPLETE'], 'One of the review roles failed, so this stays on watch.', 0), parts);

  // The decision agent never sees the untrusted text. It gets our facts and the roles' structured arguments.
  const decisionCall = await runAgent(llm, cfg, usage, {
    stage: 'decision', model: cfg.reasoningModel, reasoning: true, schema: AgentDecisionSchema,
    build: (retryNote) => buildUserMessage('decision', { facts: input.facts, modelArguments: { bull, bear, risk }, retryNote }),
  });
  if (!decisionCall.value) return result(plainDecision(cfg, 'WATCH', ['MODEL_OUTPUT_INVALID'], 'The decision step did not return a valid answer, so this stays on watch.', 0), parts);

  const guarded = applyGuardrails(decisionCall.value, input.facts, cfg, true);
  let decision = guarded.decision;
  const notes = [...guarded.notes];
  let judge: JudgeOutput | null = null;

  if (decision.action === 'BUY' && cfg.judgeModel) {
    const jc = await runAgent(llm, cfg, usage, {
      stage: 'judge', model: cfg.judgeModel, reasoning: true, schema: JudgeSchema,
      build: (retryNote) => buildUserMessage('judge', { facts: input.facts, modelArguments: { bull, bear, risk }, proposedDecision: decision, retryNote }),
    });
    judge = jc.value;
    if (!judge) { decision = downgrade(decision, 'JUDGE_UNAVAILABLE'); notes.push('JUDGE_UNAVAILABLE'); }
    else if (!judge.agree) { decision = downgrade(decision, 'JUDGE_DISAGREED'); notes.push('JUDGE_DISAGREED'); }
    else if (judge.adjustedConfidence != null) {
      decision = { ...decision, confidence: Math.min(decision.confidence, judge.adjustedConfidence) };
      if (decision.confidence < cfg.confidenceThreshold) { decision = downgrade(decision, 'BELOW_CONFIDENCE_THRESHOLD'); notes.push('BELOW_CONFIDENCE_THRESHOLD'); }
    }
  }
  return result(decision, { ...parts, judge }, notes);
}

export interface PositionReviewResult { review: PositionReviewOutput | null; usage: Usage[]; error?: string }

/**
 * One reasoning-model look at an open position, after the deterministic rules have run. Token names and narrative text
 * reach it only under the "untrusted" key. A provider failure or an invalid answer returns review: null, and the
 * monitor then simply uses the rules. The answer cannot place a trade and can at most make an exit more cautious.
 */
export async function reviewPosition(deps: { llm: LlmProvider; config: AiConfig }, input: { facts: PositionReviewFacts; untrusted: UntrustedField[] }): Promise<PositionReviewResult> {
  const usage: Usage[] = [];
  const call = await runAgent(deps.llm, deps.config, usage, {
    stage: 'positionReview', model: deps.config.reasoningModel, reasoning: true, schema: PositionReviewSchema,
    build: (retryNote) => buildUserMessage('positionReview', { facts: input.facts, untrusted: input.untrusted, retryNote }),
  });
  return { review: call.value, usage, ...(call.error ? { error: call.error } : {}) };
}
