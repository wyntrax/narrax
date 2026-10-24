import type { PrismaClient } from '@narra/database';
import { RUNTIME_SETTING_SCHEMAS } from '@narra/shared';
import { parseCorsOrigins } from './http';

export const RUNTIME_CACHE_MS = 20_000;
export const AUTH_SETTING_KEYS = ['auth.privy_app_id', 'auth.privy_verification_key'];
type Db = Pick<PrismaClient, 'systemSetting'>;
type Env = Partial<Pick<NodeJS.ProcessEnv, 'PRIVY_APP_ID' | 'PRIVY_VERIFICATION_KEY' | 'CORS_ORIGINS'>>;
const versions = new WeakMap<object, number>();
export function invalidateRuntimeSettings(db: Db) { versions.set(db, (versions.get(db) ?? 0) + 1); }
const sourced = <T>(value: T, database: boolean) => ({ value, source: database ? 'database' as const : 'environment' as const });

export async function readRuntimeSettings(db: Db, env: Env = process.env) {
  const rows = await db.systemSetting.findMany({ where: { key: { in: Object.keys(RUNTIME_SETTING_SCHEMAS) } } });
  const values: Record<string, unknown> = {};
  for (const row of rows) {
    const schema = RUNTIME_SETTING_SCHEMAS[row.key as keyof typeof RUNTIME_SETTING_SCHEMAS];
    const parsed = schema?.safeParse(row.value);
    if (!parsed?.success) throw new Error('RUNTIME_SETTINGS_UNAVAILABLE');
    values[row.key] = parsed.data;
  }
  const appId = values['auth.privy_app_id'] as string | undefined;
  const key = values['auth.privy_verification_key'] as string | undefined;
  const extra = values['api.cors_origins'] as string[] | undefined;
  const environment = parseCorsOrigins(env.CORS_ORIGINS);
  return {
    privyAppId: sourced(appId ?? env.PRIVY_APP_ID?.trim() ?? '', appId !== undefined),
    privyVerificationKey: sourced(key ?? env.PRIVY_VERIFICATION_KEY?.replace(/\\n/g, '\n').trim() ?? '', key !== undefined),
    corsOrigins: { ...sourced([...new Set([...environment, ...(extra ?? [])])], extra !== undefined), extra: extra ?? [], environment },
  };
}
export type RuntimeSettings = Awaited<ReturnType<typeof readRuntimeSettings>>;
export function createRuntimeSettings(db: Db, env: Env = process.env, now = Date.now) {
  let cache: { value: RuntimeSettings; until: number; version: number } | undefined;
  let pending: { promise: Promise<RuntimeSettings>; version: number } | undefined;
  const read = async (): Promise<RuntimeSettings> => {
    const version = versions.get(db) ?? 0;
    if (cache && cache.version === version && now() < cache.until) return cache.value;
    if (!pending || pending.version !== version) {
      const promise = readRuntimeSettings(db, env).then(value => {
        if ((versions.get(db) ?? 0) !== version) return read();
        cache = { value, until: now() + RUNTIME_CACHE_MS, version };
        return value;
      }).finally(() => { if (pending?.promise === promise) pending = undefined; });
      pending = { promise, version };
    }
    return pending.promise;
  };
  return { read, origins: async () => (await read()).corsOrigins.value };
}
export type RuntimeSettingsResolver = ReturnType<typeof createRuntimeSettings>;
