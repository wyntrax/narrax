import { describe, expect, it } from 'vitest';
import { defaultAiConfig, DEFAULT_AI_CONFIG } from './config';
import { aiProviderFromEnv, DEFAULT_AI_BASE_URL } from './fromEnv';
import { chatCompletionsUrl, OpenAiCompatibleProvider } from './openai';
import { LlmError, type LlmRequest } from './types';

const req: LlmRequest = { model: 'vikey-model-1', system: 'sys', user: 'Hello!', temperature: 0.2, maxTokens: 500, reasoningLevel: 'medium' };
const ok = () => new Response(JSON.stringify({ choices: [{ message: { content: '{"type":"final","message":"hi"}' } }], usage: { prompt_tokens: 7, completion_tokens: 3 } }));

/** A fetch that records every request and answers with the next scripted response. */
function scripted(...answers: (() => Response)[]) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) });
    return (answers[Math.min(calls.length - 1, answers.length - 1)] ?? ok)();
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe('the Vikey chat-completions flow', () => {
  it('defaults to https://api.vikey.ai/v1 and sends Bearer auth, the model and the messages', async () => {
    const { f, calls } = scripted(ok);
    const r = await aiProviderFromEnv({ AI_PROVIDER_API_KEY: 'vk-secret' }, f)!.complete(req);
    expect(r).toEqual({ text: '{"type":"final","message":"hi"}', inputTokens: 7, outputTokens: 3 });
    expect(DEFAULT_AI_BASE_URL).toBe('https://api.vikey.ai/v1');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.vikey.ai/v1/chat/completions');
    expect(calls[0]!.headers.authorization).toBe('Bearer vk-secret');
    expect(calls[0]!.body.model).toBe('vikey-model-1');
    expect(calls[0]!.body.messages).toEqual([{ role: 'system', content: 'sys' }, { role: 'user', content: 'Hello!' }]);
  });
  it('standard style adds only temperature and max_tokens, and never JSON mode or reasoning_effort', async () => {
    const { f, calls } = scripted(ok);
    await aiProviderFromEnv({ AI_PROVIDER_API_KEY: 'k' }, f)!.complete(req);
    expect(Object.keys(calls[0]!.body).sort()).toEqual(['max_tokens', 'messages', 'model', 'temperature']);
  });
  it('bare style is exactly the curl example: model and messages only', async () => {
    const { f, calls } = scripted(ok);
    await aiProviderFromEnv({ AI_PROVIDER_API_KEY: 'k', AI_REQUEST_STYLE: 'bare' }, f)!.complete(req);
    expect(Object.keys(calls[0]!.body).sort()).toEqual(['messages', 'model']);
  });
  it('full style still sends JSON mode and reasoning_effort, as before', async () => {
    const { f, calls } = scripted(ok);
    await aiProviderFromEnv({ AI_PROVIDER_API_KEY: 'k', AI_REQUEST_STYLE: 'full' }, f)!.complete(req);
    expect(calls[0]!.body).toMatchObject({ response_format: { type: 'json_object' }, reasoning_effort: 'medium' });
  });
  it('a router that rejects the extra fields gets one retry with the bare request, and the model is remembered', async () => {
    const { f, calls } = scripted(() => new Response('{"error":"unknown field"}', { status: 400 }), ok, ok);
    const p = aiProviderFromEnv({ AI_PROVIDER_API_KEY: 'k' }, f)!;
    expect((await p.complete(req)).text).toContain('final');
    expect(calls).toHaveLength(2);
    expect(Object.keys(calls[1]!.body).sort()).toEqual(['messages', 'model']);
    await p.complete(req); // remembered: one request, bare, no repeat of the rejected one
    expect(calls).toHaveLength(3);
    expect(Object.keys(calls[2]!.body).sort()).toEqual(['messages', 'model']);
  });
  it('does not retry a bad key, and the error names the fix without leaking the key or the provider body', async () => {
    const { f, calls } = scripted(() => new Response('vk-secret is invalid, you sent: Hello!', { status: 401 }));
    const e = await aiProviderFromEnv({ AI_PROVIDER_API_KEY: 'vk-secret' }, f)!.complete(req).catch((x: Error) => x);
    expect(e).toBeInstanceOf(LlmError);
    expect((e as Error).message).toBe('Model request returned HTTP 401 (check AI_PROVIDER_API_KEY)');
    expect(calls).toHaveLength(1);
  });
  it('a wrong model id fails after the bare retry, with a hint, and is not remembered as working', async () => {
    const { f, calls } = scripted(() => new Response('no such model', { status: 400 }));
    const p = aiProviderFromEnv({ AI_PROVIDER_API_KEY: 'k' }, f)!;
    await expect(p.complete(req)).rejects.toThrow('HTTP 400 (the model id or a request field was rejected)');
    await expect(p.complete(req)).rejects.toThrow(LlmError);
    expect(calls).toHaveLength(4); // two attempts each time: the first call did not mark the model as bare
  });
  it('tolerates a trailing slash or a pasted /chat/completions in the base URL', () => {
    expect(chatCompletionsUrl('https://api.vikey.ai/v1/')).toBe('https://api.vikey.ai/v1/chat/completions');
    expect(chatCompletionsUrl('https://api.vikey.ai/v1/chat/completions')).toBe('https://api.vikey.ai/v1/chat/completions');
    expect(chatCompletionsUrl(undefined)).toBe('https://api.openai.com/v1/chat/completions'); // the class default is unchanged
  });
  it('is off without a key, and refuses an unknown request style', () => {
    expect(aiProviderFromEnv({})).toBeNull();
    expect(aiProviderFromEnv({ AI_PROVIDER_API_KEY: '   ' })).toBeNull();
    expect(() => aiProviderFromEnv({ AI_PROVIDER_API_KEY: 'k', AI_REQUEST_STYLE: 'wild' })).toThrow('AI_REQUEST_STYLE');
    expect(aiProviderFromEnv({ AI_PROVIDER_API_KEY: 'k' })).toBeInstanceOf(OpenAiCompatibleProvider);
  });
  it('AI_MODEL_ID becomes the default fast and reasoning model, and nothing else changes', () => {
    expect(defaultAiConfig({})).toEqual(DEFAULT_AI_CONFIG);
    const c = defaultAiConfig({ AI_MODEL_ID: ' my-model ' });
    expect(c).toMatchObject({ fastModel: 'my-model', reasoningModel: 'my-model', judgeModel: null, confidenceThreshold: DEFAULT_AI_CONFIG.confidenceThreshold });
    expect(defaultAiConfig({ AI_MODEL_ID: 'x'.repeat(81) })).toEqual(DEFAULT_AI_CONFIG);
  });
});
