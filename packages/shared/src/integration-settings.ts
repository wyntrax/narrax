import { z } from 'zod';

/**
 * Credentials and delivery settings for the external integrations the admin page can change.
 * Stored values win over the environment, so an operator can rotate a credential without a redeploy.
 * Only these exact keys can be written, and secrets are never returned by the admin API.
 */

// Telegram bot tokens are "<bot id>:<secret>". Only trim/preserve them; the Bot API is the real validator.
export const TelegramBotToken = z.string().trim().min(1).max(300);
// A numeric chat id (groups are negative, for example -1001234567890) or a public @channel name.
export const TelegramChatId = z.string().trim().min(1).max(100).regex(/^(?:-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$/);
export const TregToken = z.string().trim().min(1).max(500);
// Empty clears the optional organisation header without falling back to an environment value.
export const TregOrg = z.string().trim().max(200);

export const INTEGRATION_SETTING_SCHEMAS = {
  'integrations.telegram.enabled': z.boolean(),
  'integrations.telegram.bot_token': TelegramBotToken,
  'integrations.telegram.chat_id': TelegramChatId,
  // A call older than this is not worth posting. 1 day is the practical ceiling for a research alert.
  'integrations.telegram.max_age_min': z.number().int().min(1).max(1_440),
  'integrations.telegram.max_per_run': z.number().int().min(1).max(20),
  'integrations.telegram.send_delay_ms': z.number().int().min(0).max(60_000),
  'integrations.treg.enabled': z.boolean(),
  'integrations.treg.token': TregToken,
  'integrations.treg.org': TregOrg,
} as const;

export type IntegrationSettingKey = keyof typeof INTEGRATION_SETTING_SCHEMAS;
export const INTEGRATION_SETTING_KEYS = Object.keys(INTEGRATION_SETTING_SCHEMAS) as IntegrationSettingKey[];

/** Values that must never be returned to a browser or written to the audit log. */
export const SECRET_INTEGRATION_KEYS = ['integrations.telegram.bot_token', 'integrations.treg.token'] as const satisfies readonly IntegrationSettingKey[];

export const isSecretIntegrationKey = (key: string): key is (typeof SECRET_INTEGRATION_KEYS)[number] =>
  (SECRET_INTEGRATION_KEYS as readonly string[]).includes(key);

/** The body the admin page sends. Unknown keys are refused, never silently stored. */
export const IntegrationSettingsInput = z.object(INTEGRATION_SETTING_SCHEMAS).partial().strict();
export type IntegrationSettingsInputValue = z.infer<typeof IntegrationSettingsInput>;

export type SettingSource = 'database' | 'environment' | 'default';
export interface Sourced<T> { value: T; source: SettingSource }

export interface TelegramIntegrationSettings {
  enabled: Sourced<boolean>;
  botToken: Sourced<string>;
  chatId: Sourced<string>;
  maxAgeMin: Sourced<number>;
  maxPerRun: Sourced<number>;
  sendDelayMs: Sourced<number>;
}

export interface TregIntegrationSettings {
  enabled: Sourced<boolean>;
  token: Sourced<string>;
  org: Sourced<string>;
}

export interface EffectiveIntegrations {
  telegram: TelegramIntegrationSettings;
  treg: TregIntegrationSettings;
  /** Keys that are stored but no longer validate. They are ignored, never applied. */
  invalid: string[];
}

export type IntegrationRow = { key: string; value: unknown };

const num = (raw: string | undefined, fallback: number, allowZero = false): number => {
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && (allowZero ? n >= 0 : n > 0) ? n : fallback;
};

function storedValue(rows: readonly IntegrationRow[], key: IntegrationSettingKey, invalid: Set<string>): unknown {
  const row = rows.find(value => value.key === key);
  if (!row) return undefined;
  const parsed = INTEGRATION_SETTING_SCHEMAS[key].safeParse(row.value);
  if (!parsed.success) {
    invalid.add(key);
    return undefined;
  }
  return parsed.data;
}

const sourced = <T>(value: T, source: SettingSource): Sourced<T> => ({ value, source });

export function effectiveIntegrations(rows: readonly IntegrationRow[], env: Record<string, string | undefined> = process.env): EffectiveIntegrations {
  const invalid = new Set<string>();
  const get = (key: IntegrationSettingKey) => storedValue(rows, key, invalid);
  const envText = (raw: string | undefined) => raw?.trim() ?? '';
  const pickText = (key: IntegrationSettingKey, envValue: string): Sourced<string> => {
    const stored = get(key);
    if (stored !== undefined) return sourced(stored as string, 'database');
    const value = envText(envValue);
    return value ? sourced(value, 'environment') : sourced('', 'default');
  };
  const pickNumber = (key: IntegrationSettingKey, envValue: string | undefined, fallback: number, allowZero = false): Sourced<number> => {
    const stored = get(key);
    if (stored !== undefined) return sourced(stored as number, 'database');
    if (envValue != null && envValue.trim() !== '') {
      const parsed = Number(envValue);
      const schema = INTEGRATION_SETTING_SCHEMAS[key] as z.ZodNumber;
      const min = allowZero ? 0 : 1;
      if (Number.isFinite(parsed) && parsed >= min) {
        const max = schema.maxValue ?? Number.MAX_SAFE_INTEGER;
        const value = Math.round(parsed);
        // Match the worker's historical behavior: a too-large env value is clamped, never treated as a new ceiling.
        return sourced(Math.min(Math.max(value, min), max), 'environment');
      }
    }
    return sourced(fallback, 'default');
  };

  const storedEnabled = get('integrations.telegram.enabled');
  const telegramEnabled = storedEnabled !== undefined
    ? sourced(storedEnabled as boolean, 'database')
    : envText(env.TELEGRAM_ENABLED).toLowerCase() === 'false'
      ? sourced(false, 'environment')
      : env.TELEGRAM_ENABLED != null && envText(env.TELEGRAM_ENABLED) !== ''
        ? sourced(true, 'environment')
        : sourced(true, 'default');

  const storedTregEnabled = get('integrations.treg.enabled');
  const tregEnabled = storedTregEnabled !== undefined
    ? sourced(storedTregEnabled as boolean, 'database')
    : env.TREG_NARRATIVE_ENABLED != null && envText(env.TREG_NARRATIVE_ENABLED) !== ''
      ? sourced(envText(env.TREG_NARRATIVE_ENABLED) === 'true', 'environment')
      : sourced(false, 'default');

  return {
    telegram: {
      enabled: telegramEnabled,
      botToken: pickText('integrations.telegram.bot_token', env.TELEGRAM_BOT_TOKEN ?? ''),
      chatId: pickText('integrations.telegram.chat_id', env.TELEGRAM_CHAT_ID ?? ''),
      maxAgeMin: pickNumber('integrations.telegram.max_age_min', env.TELEGRAM_MAX_AGE_MIN, 15),
      maxPerRun: pickNumber('integrations.telegram.max_per_run', env.TELEGRAM_MAX_PER_RUN, 10),
      sendDelayMs: pickNumber('integrations.telegram.send_delay_ms', env.TELEGRAM_SEND_DELAY_MS, 1_200, true),
    },
    treg: {
      enabled: tregEnabled,
      token: pickText('integrations.treg.token', env.TREG_TOKEN ?? ''),
      org: pickText('integrations.treg.org', env.TREG_ORG ?? ''),
    },
    invalid: [...invalid],
  };
}

/** Telegram delivery needs all three: an explicit on switch, a bot token and a target chat. */
export const telegramConfigured = (settings: TelegramIntegrationSettings): boolean =>
  settings.enabled.value && !!settings.botToken.value && !!settings.chatId.value;

/** Treg ingestion needs an explicit on switch and a token. */
export const tregConfigured = (settings: TregIntegrationSettings): boolean =>
  settings.enabled.value && !!settings.token.value;

/** A small, bounded watchlist for a Treg setup that has no topic pack or custom topics in the environment. */
export const DEFAULT_TREG_SETUP_PACKS = 'trencher';
