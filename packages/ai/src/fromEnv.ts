import { OpenAiCompatibleProvider, type RequestStyle } from './openai';

/** The provider the chat agent and the analysis pipeline use unless AI_BASE_URL says otherwise. */
export const DEFAULT_AI_BASE_URL = 'https://api.vikey.ai/v1';
const STYLES: readonly RequestStyle[] = ['full', 'standard', 'bare'];

/**
 * Builds the model provider from the environment, or null when no key is set (chat and analysis then stay off).
 *   AI_PROVIDER_API_KEY   the key (server only)
 *   AI_BASE_URL           default https://api.vikey.ai/v1
 *   AI_REQUEST_STYLE      full | standard | bare, default standard (see RequestStyle)
 * The model id is not read here. It comes from the admin AI settings, or AI_MODEL_ID as the default when none are saved.
 */
export function aiProviderFromEnv(env: Record<string, string | undefined> = process.env, fetchImpl?: typeof fetch): OpenAiCompatibleProvider | null {
  const apiKey = env.AI_PROVIDER_API_KEY?.trim();
  if (!apiKey) return null;
  const style = env.AI_REQUEST_STYLE?.trim() || 'standard';
  if (!STYLES.includes(style as RequestStyle)) throw new Error('AI_REQUEST_STYLE must be full, standard or bare.');
  return new OpenAiCompatibleProvider({ apiKey, baseUrl: env.AI_BASE_URL?.trim() || DEFAULT_AI_BASE_URL, requestStyle: style as RequestStyle, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
}
