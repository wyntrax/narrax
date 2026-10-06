import { z } from 'zod';
import { extractJson, type LlmProvider } from '@narra/ai';
import { AGENT_LIMITS, FALLBACK } from './constants';
import { buildStepMessage, SYSTEM_PROMPT, type StepInput } from './prompt';
import type { AgentPorts, ProposalView } from './ports';
import { sanitizeAssistantText, sanitizeUserText } from './sanitize';
import { findTool, type AgentContext } from './tools';

const StepSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('tool_call'), tool: z.string().max(64), args: z.record(z.unknown()).default({}) }).strict(),
  z.object({ type: z.literal('final'), message: z.string().max(8000) }).strict(),
]);

export type StopReason = 'final' | 'max_steps' | 'bad_output' | 'llm_error';

export interface AgentRunInput {
  llm: LlmProvider;
  model: string;
  temperature: number;
  maxTokens: number;
  ports: AgentPorts;
  /** From the signed-in session, never from the model. */
  ctx: AgentContext;
  userMessage: string;
  history: { role: 'user' | 'assistant'; text: string }[];
}

export interface AgentRunResult {
  text: string;
  proposals: ProposalView[];
  toolsUsed: string[];
  /** Tool calls the model asked for that were refused (unknown tool or bad arguments). */
  refusedCalls: number;
  stopReason: StopReason;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Runs one user message to an answer. The model can ask for tools; the code decides what runs.
 * - Only tools in the registry run. Arguments must pass the tool's strict schema, which has no user id field.
 * - At most maxToolCalls tools run per message. Bad output is retried a couple of times, then the turn ends with a fixed message.
 * - Tool results are passed back as data under "facts" and "untrusted", and only for this turn. They are never stored or replayed.
 * - The final text is sanitized before it is returned.
 * A model that has been talked into anything still cannot do more than the registry allows, and the registry holds nothing that trades.
 */
export async function runAgent(i: AgentRunInput): Promise<AgentRunResult> {
  const out: AgentRunResult = { text: '', proposals: [], toolsUsed: [], refusedCalls: 0, stopReason: 'bad_output', inputTokens: 0, outputTokens: 0 };
  const results: StepInput['toolResults'] = [];
  const userMessage = sanitizeUserText(i.userMessage), history = i.history.slice(-AGENT_LIMITS.historyMessages).map((h) => ({ role: h.role, text: h.text.slice(0, AGENT_LIMITS.maxUserMessageChars) }));
  let toolCalls = 0, bad = 0;

  for (let guard = 0; guard < AGENT_LIMITS.maxToolCalls + AGENT_LIMITS.maxBadOutputs + 2; guard++) {
    const stepsLeft = AGENT_LIMITS.maxToolCalls - toolCalls;
    let raw: string;
    try {
      const r = await i.llm.complete({ model: i.model, system: SYSTEM_PROMPT, user: buildStepMessage({ userMessage, history, toolResults: results, stepsLeft }), temperature: i.temperature, maxTokens: i.maxTokens });
      raw = r.text; out.inputTokens += r.inputTokens; out.outputTokens += r.outputTokens;
    } catch {
      return { ...out, text: FALLBACK.llmError, stopReason: 'llm_error' };
    }
    const step = StepSchema.safeParse(extractJson(raw));
    if (!step.success) {
      if (++bad >= AGENT_LIMITS.maxBadOutputs) return { ...out, text: FALLBACK.badOutput, stopReason: 'bad_output' };
      continue;
    }
    if (step.data.type === 'final') {
      const text = sanitizeAssistantText(step.data.message);
      return { ...out, text: text || FALLBACK.empty, stopReason: 'final' };
    }
    if (stepsLeft <= 0) return { ...out, text: FALLBACK.maxSteps, stopReason: 'max_steps' };
    toolCalls++;

    const name = step.data.tool, tool = findTool(name), label = name.replace(/[^A-Za-z0-9_]/g, '').slice(0, 40) || 'invalid';
    if (!tool) { out.refusedCalls++; results.push({ tool: label, ok: false, error: 'unknown_tool' }); continue; }
    const args = tool.schema.safeParse(step.data.args);
    if (!args.success) { out.refusedCalls++; results.push({ tool: tool.name, ok: false, error: `invalid_arguments: ${[...new Set(args.error.issues.map((x) => x.path.join('.') || x.code))].join(', ').slice(0, 120)}` }); continue; }

    out.toolsUsed.push(tool.name);
    try {
      const r = await tool.run(i.ports, i.ctx, args.data);
      if (r.error) { results.push({ tool: tool.name, ok: false, error: r.error, facts: r.facts }); continue; }
      if (r.proposal) out.proposals.push(r.proposal);
      const entry = { tool: tool.name, ok: true, facts: r.facts, ...(r.untrusted?.length ? { untrusted: r.untrusted } : {}) };
      results.push(JSON.stringify(entry).length > AGENT_LIMITS.maxToolResultChars ? { tool: tool.name, ok: false, error: 'result_too_large' } : entry);
    } catch {
      results.push({ tool: tool.name, ok: false, error: 'tool_failed' }); // the error text can hold query details, so the model never sees it
    }
  }
  return { ...out, text: FALLBACK.maxSteps, stopReason: 'max_steps' };
}
