import { z } from 'zod';
import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from './types';

const Response_ = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
  usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }).optional(),
});

/**
 * How much the request carries beyond the model and the messages.
 * - `full`: also response_format (JSON mode) and reasoning_effort. What this client always sent before.
 * - `standard`: also temperature and max_tokens. Every chat-completions router accepts these.
 * - `bare`: only `model` and `messages`, exactly the request in the provider's own curl example.
 * A router that rejects a field answers HTTP 400 or 422. The client then retries once as `bare` and remembers
 * that for that model, so a stricter router costs one extra call per model, not one per request.
 */
export type RequestStyle = 'full' | 'standard' | 'bare';

export interface OpenAiCompatibleOptions {
  /** For example https://api.vikey.ai/v1. A trailing slash or a pasted /chat/completions is tolerated. */
  baseUrl?: string;
  /** Server-side only. Never returned to a browser or logged. */
  apiKey: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  requestStyle?: RequestStyle;
}

const DEFAULT_BASE = 'https://api.openai.com/v1';
/** Fixed text only. The provider's own error body is never echoed because it can contain request data. */
const HINTS: Record<number, string> = {
  400: 'the model id or a request field was rejected',
  401: 'check AI_PROVIDER_API_KEY',
  403: 'check AI_PROVIDER_API_KEY and that the key can use this model',
  404: 'check AI_BASE_URL (it should end in /v1) and the model id',
  429: 'rate limited or out of credit',
};

export function chatCompletionsUrl(baseUrl?: string): string {
  const base = (baseUrl?.trim() || DEFAULT_BASE).replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  return `${base}/chat/completions`;
}

/**
 * Chat-completions client for any OpenAI-compatible endpoint. The model names are configuration, not code.
 * One request: POST {base}/chat/completions with `Authorization: Bearer <key>` and a JSON body holding the model and messages.
 */
export class OpenAiCompatibleProvider implements LlmProvider {
  private readonly bareModels = new Set<string>();
  constructor(private readonly opts: OpenAiCompatibleOptions) {}

  private body(req: LlmRequest, style: RequestStyle): Record<string, unknown> {
    const messages = [{ role: 'system', content: req.system }, { role: 'user', content: req.user }];
    if (style === 'bare') return { model: req.model, messages };
    return {
      model: req.model, temperature: req.temperature, max_tokens: req.maxTokens,
      ...(style === 'full' ? { response_format: { type: 'json_object' } } : {}),
      ...(style === 'full' && req.reasoningLevel ? { reasoning_effort: req.reasoningLevel } : {}),
      messages,
    };
  }

  private async post(body: Record<string, unknown>): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 60_000);
    try {
      return await (this.opts.fetch ?? fetch)(chatCompletionsUrl(this.opts.baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.opts.apiKey}` },
        signal: ctrl.signal,
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new LlmError(`Model request failed: ${(e as Error).name}`);
    } finally {
      clearTimeout(timer);
    }
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const style: RequestStyle = this.bareModels.has(req.model) ? 'bare' : (this.opts.requestStyle ?? 'full');
    let res = await this.post(this.body(req, style));
    if ((res.status === 400 || res.status === 422) && style !== 'bare') {
      const retry = await this.post(this.body(req, 'bare'));
      if (retry.ok) this.bareModels.add(req.model);
      res = retry;
    }
    if (!res.ok) throw new LlmError(`Model request returned HTTP ${res.status}${HINTS[res.status] ? ` (${HINTS[res.status]})` : ''}`);
    const parsed = Response_.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new LlmError('Model response had an unexpected shape');
    return { text: parsed.data.choices[0]!.message.content ?? '', inputTokens: parsed.data.usage?.prompt_tokens ?? 0, outputTokens: parsed.data.usage?.completion_tokens ?? 0 };
  }
}
