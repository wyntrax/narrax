import type { PrismaClient } from '@narra/database';
import { DEFAULT_TREG_SETUP_PACKS, effectiveIntegrations } from '@narra/shared';
import { readTregConfig, type TregConfig } from '@narra/narrative';

/**
 * Reads the admin-managed Treg settings with the environment as the fallback, and builds the same validated
 * config the worker used to read from env alone. Called per job so a token or enable change applies without
 * restarting the pipeline worker.
 */
export interface TregIntegration {
  config: TregConfig;
  token: string;
  org?: string;
}

export async function tregConfigFromSettings(
  db: Pick<PrismaClient, 'systemSetting'>,
  env: Record<string, string | undefined> = process.env,
): Promise<TregIntegration | null> {
  const rows = await db.systemSetting.findMany({ where: { key: { startsWith: 'integrations.treg.' } }, select: { key: true, value: true } });
  const settings = effectiveIntegrations(rows, env).treg;
  if (!settings.enabled.value) return null;
  if (!settings.token.value) throw new Error('TREG_TOKEN_REQUIRED');
  const merged: Record<string, string | undefined> = {
    ...env,
    TREG_NARRATIVE_ENABLED: 'true',
    TREG_TOKEN: settings.token.value,
    ...(settings.org.value ? { TREG_ORG: settings.org.value } : {}),
  };
  // A setup configured only from the admin page has no env topic list. Use one bounded default pack so the
  // enabled integration actually collects a watchlist instead of failing every run.
  if (!merged.TREG_NARRATIVE_PACKS?.trim() && !merged.TREG_NARRATIVE_TOPICS?.trim()) {
    merged.TREG_NARRATIVE_PACKS = DEFAULT_TREG_SETUP_PACKS;
  }
  const config = readTregConfig(merged);
  return config ? { config, token: settings.token.value, ...(settings.org.value ? { org: settings.org.value } : {}) } : null;
}
