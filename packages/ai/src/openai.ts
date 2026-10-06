import { z } from 'zod';
import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from './types';

const Response_ = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
  usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }).optional(),
});

export interface OpenAiCompatibleOptions {
  baseUrl?: string;
  /** Server-side only. Never returned to a browser or logged. */
  apiKey: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/**
 * Chat-completions client for any OpenAI-compatible endpoint. The model names are configuration, not code.
 * Request and response shapes follow the common chat-completions format. Confirm them against your provider.
 */
export class OpenAiCompatibleProvider implements LlmProvider {
  constructor(private readonly opts: OpenAiCompatibleOptions) {}

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 60_000);
    let res: Response;
    try {
      res = await (this.opts.fetch ?? fetch)(`${this.opts.baseUrl ?? 'https://api.openai.com/v1'}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.opts.apiKey}` },
        signal: ctrl.signal,
        body: JSON.stringify({
          model: req.model, temperature: req.temperature, max_tokens: req.maxTokens,
          response_format: { type: 'json_object' },
          ...(req.reasoningLevel ? { reasoning_effort: req.reasoningLevel } : {}),
          messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }],
        }),
      });
    } catch (e) {
      throw new LlmError(`Model request failed: ${(e as Error).name}`);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new LlmError(`Model request returned HTTP ${res.status}`); // the body is not echoed, it may contain request data
    const parsed = Response_.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new LlmError('Model response had an unexpected shape');
    return { text: parsed.data.choices[0]!.message.content ?? '', inputTokens: parsed.data.usage?.prompt_tokens ?? 0, outputTokens: parsed.data.usage?.completion_tokens ?? 0 };
  }
}
