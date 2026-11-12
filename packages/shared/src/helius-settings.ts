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
 * RPC endpoints are pools. A primary list is used in round-robin; a fallback list is
 * used only when every primary is cooling down or failing. The legacy single-endpoint
 * keys remain readable so existing rows and environment values keep working.
 */

const HttpUrl = z.string().trim().min(1).max(2_048).refine(value => {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !/\s/.test(value);
  } catch { return false; }
}, { message: 'must be an http:// or https:// URL' });

/** Up to eight independent endpoints in one tier. */
export const HeliusUrlList = z.array(HttpUrl).max(8);
/** A single legacy endpoint. An empty string clears it. */
export const OptionalHeliusUrl = z.union([z.literal(''), HttpUrl]);
/** Helius keys are treated as opaque tokens. No whitespace or URL syntax can be injected. */
export const HeliusApiKey = z.string().trim().max(300).regex(/^[A-Za-z0-9_-]*$/);
/** Sent back by Helius in the Authorization header. Empty disables webhook sync. */
export const HeliusWebhookSecret = z.string().max(500).refine(value => !/[\r\n]/.test(value));

export const HELIUS_SETTING_SCHEMAS = {
  'integrations.helius.rpc_urls': HeliusUrlList,
  'integrations.helius.rpc_fallback_urls': HeliusUrlList,
  'integrations.helius.holder_rpc_urls': HeliusUrlList,
  'integrations.helius.holder_rpc_fallback_urls': HeliusUrlList,
  // Read-only compatibility with the first admin version and existing environment keys.
  'integrations.helius.rpc_url': OptionalHeliusUrl,
  'integrations.helius.rpc_fallback_url': OptionalHeliusUrl,
  'integrations.helius.holder_rpc_url': OptionalHeliusUrl,
  'integrations.helius.holder_rpc_fallback_url': OptionalHeliusUrl,
  'integrations.helius.api_key': HeliusApiKey,
  'integrations.helius.webhook_url': OptionalHeliusUrl,
  'integrations.helius.webhook_secret': HeliusWebhookSecret,
} as const;

export type HeliusSettingKey = keyof typeof HELIUS_SETTING_SCHEMAS;
export const HELIUS_SETTING_KEYS = Object.keys(HELIUS_SETTING_SCHEMAS) as HeliusSettingKey[];

export const SECRET_HELIUS_KEYS = [
  'integrations.helius.rpc_urls',
  'integrations.helius.rpc_fallback_urls',
  'integrations.helius.holder_rpc_urls',
  'integrations.helius.holder_rpc_fallback_urls',
  'integrations.helius.rpc_url',
  'integrations.helius.rpc_fallback_url',
  'integrations.helius.holder_rpc_url',
  'integrations.helius.holder_rpc_fallback_url',
  'integrations.helius.api_key',
  'integrations.helius.webhook_secret',
] as const satisfies readonly HeliusSettingKey[];

export const isSecretHeliusKey = (key: string): key is (typeof SECRET_HELIUS_KEYS)[number] =>
  (SECRET_HELIUS_KEYS as readonly string[]).includes(key);

/** Unknown keys are refused. Missing keys are left unchanged. */
export const HeliusSettingsInput = z.object(HELIUS_SETTING_SCHEMAS).partial().strict();

export interface HeliusSettings {
  /** Primary RPC endpoints, tried in round-robin. */
  rpcUrls: Sourced<string[]>;
  /** Tried only when every primary is cooling down or failing. */
  rpcFallbackUrls: Sourced<string[]>;
  apiKey: Sourced<string>;
  /** Dedicated holder enumeration endpoints. Empty means use the shared RPC pool. */
  holderRpcUrls: Sourced<string[]>;
  holderRpcFallbackUrls: Sourced<string[]>;
  webhookUrl: Sourced<string>;
  webhookSecret: Sourced<string>;
  /** Stored keys that no longer validate. They are ignored, never applied. */
  invalid: string[];
  ready: { rpc: boolean; holder: boolean; webhook: boolean };
}

export type HeliusRow = { key: string; value: unknown };

const sourced = <T>(value: T, source: SettingSource): Sourced<T> => ({ value, source });
const normalize = (values: readonly string[]) => [...new Set(values.map(value => value.trim()).filter(Boolean))];

export function effectiveHeliusSettings(
  rows: readonly HeliusRow[],
  env: Record<string, string | undefined> = process.env,
): HeliusSettings {
  const invalid = new Set<string>();
  const stored = (key: HeliusSettingKey): unknown => {
    const row = rows.find(value => value.key === key);
    if (!row) return undefined;
    const parsed = HELIUS_SETTING_SCHEMAS[key].safeParse(row.value);
    if (!parsed.success) { invalid.add(key); return undefined; }
    return parsed.data;
  };
  const pickList = (poolKey: HeliusSettingKey, legacyKey: HeliusSettingKey, envValue: string | undefined): Sourced<string[]> => {
    const pool = stored(poolKey) as string[] | undefined;
    if (pool !== undefined) return sourced(normalize(pool), 'database');
    const legacy = stored(legacyKey) as string | undefined;
    if (legacy !== undefined) return sourced(normalize([legacy]), 'database');
    const raw = envValue?.trim();
    return raw ? sourced([raw], 'environment') : sourced([], 'default');
  };
  const pickText = (key: HeliusSettingKey, envValue: string | undefined, trim = true): Sourced<string> => {
    const value = stored(key);
    if (value !== undefined) return sourced(value as string, 'database');
    const raw = envValue ?? '';
    const text = trim ? raw.trim() : raw;
    return text ? sourced(text, 'environment') : sourced('', 'default');
  };

  const rpcUrls = pickList('integrations.helius.rpc_urls', 'integrations.helius.rpc_url', env.HELIUS_RPC_URL);
  const rawFallbackUrls = pickList('integrations.helius.rpc_fallback_urls', 'integrations.helius.rpc_fallback_url', env.HELIUS_RPC_FALLBACK_URL);
  // A URL in both tiers would be tried twice and spend the same quota.
  const rpcFallbackUrls = sourced(rawFallbackUrls.value.filter(url => !rpcUrls.value.includes(url)), rawFallbackUrls.source);
  const holderRpcUrls = pickList('integrations.helius.holder_rpc_urls', 'integrations.helius.holder_rpc_url', env.HOLDER_RPC_URL);
  const rawHolderFallbackUrls = pickList('integrations.helius.holder_rpc_fallback_urls', 'integrations.helius.holder_rpc_fallback_url', env.HOLDER_RPC_FALLBACK_URL);
  const holderRpcFallbackUrls = sourced(rawHolderFallbackUrls.value.filter(url => !holderRpcUrls.value.includes(url)), rawHolderFallbackUrls.source);
  const apiKey = pickText('integrations.helius.api_key', env.HELIUS_API_KEY);
  const webhookUrl = pickText('integrations.helius.webhook_url', env.HELIUS_WEBHOOK_URL);
  const webhookSecret = pickText('integrations.helius.webhook_secret', env.HELIUS_WEBHOOK_SECRET, false);
  const rpcReady = rpcUrls.value.length > 0 || rpcFallbackUrls.value.length > 0;

  return {
    rpcUrls, rpcFallbackUrls, apiKey, holderRpcUrls, holderRpcFallbackUrls, webhookUrl, webhookSecret,
    invalid: [...invalid],
    ready: {
      rpc: rpcReady,
      holder: holderRpcUrls.value.length > 0 || holderRpcFallbackUrls.value.length > 0 || rpcReady,
      webhook: !!apiKey.value && !!webhookUrl.value && !!webhookSecret.value,
    },
  };
}
