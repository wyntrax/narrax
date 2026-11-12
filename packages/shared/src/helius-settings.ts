import { z } from 'zod';
import type { SettingSource, Sourced } from './integration-settings';

/**
 * Helius credentials and endpoints managed on the admin page.
 *
 * These are the same variables the environment used to provide. A stored value wins over
 * the environment, so an exhausted key can be replaced without editing a file or
 * redeploying. RPC URLs usually embed the API key, so every URL except the public
 * webhook endpoint is treated as a secret and never returned by the admin API.
 *
 * Values are read when a process starts. Restart the API and workers after saving.
 */

const HttpUrl = z.string().trim().min(1).max(2_048).refine(value => {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !/\s/.test(value);
  } catch { return false; }
}, { message: 'must be an http:// or https:// URL' });

/** An empty string clears a stored endpoint and does not fall back to the environment. */
export const OptionalHeliusUrl = z.union([z.literal(''), HttpUrl]);
/** Helius keys are treated as opaque tokens. No whitespace or URL syntax can be injected. */
export const HeliusApiKey = z.string().trim().max(300).regex(/^[A-Za-z0-9_-]*$/);
/** Sent back by Helius in the Authorization header. Empty disables webhook sync. */
export const HeliusWebhookSecret = z.string().max(500).refine(value => !/[\r\n]/.test(value));

export const HELIUS_SETTING_SCHEMAS = {
  'integrations.helius.rpc_url': OptionalHeliusUrl,
  'integrations.helius.rpc_fallback_url': OptionalHeliusUrl,
  'integrations.helius.api_key': HeliusApiKey,
  'integrations.helius.holder_rpc_url': OptionalHeliusUrl,
  'integrations.helius.holder_rpc_fallback_url': OptionalHeliusUrl,
  'integrations.helius.webhook_url': OptionalHeliusUrl,
  'integrations.helius.webhook_secret': HeliusWebhookSecret,
} as const;

export type HeliusSettingKey = keyof typeof HELIUS_SETTING_SCHEMAS;
export const HELIUS_SETTING_KEYS = Object.keys(HELIUS_SETTING_SCHEMAS) as HeliusSettingKey[];

export const SECRET_HELIUS_KEYS = [
  'integrations.helius.rpc_url',
  'integrations.helius.rpc_fallback_url',
  'integrations.helius.api_key',
  'integrations.helius.holder_rpc_url',
  'integrations.helius.holder_rpc_fallback_url',
  'integrations.helius.webhook_secret',
] as const satisfies readonly HeliusSettingKey[];

export const isSecretHeliusKey = (key: string): key is (typeof SECRET_HELIUS_KEYS)[number] =>
  (SECRET_HELIUS_KEYS as readonly string[]).includes(key);

/** Unknown keys are refused. Missing keys are left unchanged. */
export const HeliusSettingsInput = z.object(HELIUS_SETTING_SCHEMAS).partial().strict();

export interface HeliusSettings {
  rpcUrl: Sourced<string>;
  rpcFallbackUrl: Sourced<string>;
  apiKey: Sourced<string>;
  holderRpcUrl: Sourced<string>;
  holderRpcFallbackUrl: Sourced<string>;
  webhookUrl: Sourced<string>;
  webhookSecret: Sourced<string>;
  /** Stored keys that no longer validate. They are ignored, never applied. */
  invalid: string[];
  ready: { rpc: boolean; holder: boolean; webhook: boolean };
}

export type HeliusRow = { key: string; value: unknown };

const sourced = (value: string, source: SettingSource): Sourced<string> => ({ value, source });

export function effectiveHeliusSettings(
  rows: readonly HeliusRow[],
  env: Record<string, string | undefined> = process.env,
): HeliusSettings {
  const invalid = new Set<string>();
  const stored = (key: HeliusSettingKey): string | undefined => {
    const row = rows.find(value => value.key === key);
    if (!row) return undefined;
    const parsed = HELIUS_SETTING_SCHEMAS[key].safeParse(row.value);
    if (!parsed.success) { invalid.add(key); return undefined; }
    return parsed.data as string;
  };
  const pick = (key: HeliusSettingKey, envValue: string | undefined, trim = true): Sourced<string> => {
    const value = stored(key);
    if (value !== undefined) return sourced(value, 'database');
    const raw = envValue ?? '';
    const text = trim ? raw.trim() : raw;
    return text ? sourced(text, 'environment') : sourced('', 'default');
  };

  const rpcUrl = pick('integrations.helius.rpc_url', env.HELIUS_RPC_URL);
  const rpcFallbackUrl = pick('integrations.helius.rpc_fallback_url', env.HELIUS_RPC_FALLBACK_URL);
  const apiKey = pick('integrations.helius.api_key', env.HELIUS_API_KEY);
  const holderRpcUrl = pick('integrations.helius.holder_rpc_url', env.HOLDER_RPC_URL);
  const holderRpcFallbackUrl = pick('integrations.helius.holder_rpc_fallback_url', env.HOLDER_RPC_FALLBACK_URL);
  const webhookUrl = pick('integrations.helius.webhook_url', env.HELIUS_WEBHOOK_URL);
  const webhookSecret = pick('integrations.helius.webhook_secret', env.HELIUS_WEBHOOK_SECRET, false);

  return {
    rpcUrl, rpcFallbackUrl, apiKey, holderRpcUrl, holderRpcFallbackUrl, webhookUrl, webhookSecret,
    invalid: [...invalid],
    ready: {
      rpc: !!rpcUrl.value,
      holder: !!holderRpcUrl.value || !!rpcUrl.value,
      webhook: !!apiKey.value && !!webhookUrl.value && !!webhookSecret.value,
    },
  };
}
