import type { PrismaClient } from '@narra/database';
import { HELIUS_SETTING_KEYS, effectiveHeliusSettings, type HeliusSettings } from '@narra/shared';

/**
 * Reads the admin-managed Helius credentials, falling back to the environment.
 * One read per process at startup is enough: the clients built from it are long-lived.
 */
export async function readHeliusSettings(
  db: Pick<PrismaClient, 'systemSetting'>,
  env: Record<string, string | undefined> = process.env,
): Promise<HeliusSettings> {
  const rows = await db.systemSetting.findMany({
    where: { key: { in: [...HELIUS_SETTING_KEYS] } },
    select: { key: true, value: true },
  });
  return effectiveHeliusSettings(rows, env);
}
