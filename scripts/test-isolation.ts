import { assertTestDatabase } from './test-database';

/** Unreachable on purpose: a test that connects with these skips (its "is it up?" probe fails) instead of touching real data. */
export const BLOCKED_DATABASE_URL = 'postgresql://narra_test_guard:unused@127.0.0.1:1/narra_test_guard_blocked';
export const BLOCKED_REDIS_URL = 'redis://127.0.0.1:1';

export interface TestEnvDecision { databaseUrl: string; redisUrl: string; databaseIsolated: boolean; redisIsolated: boolean }

/** Never inherit provider credentials or model defaults from the invoking shell. */
export function clearTestAiEnv(env: Record<string, string | undefined>): void {
  for (const key of ['AI_PROVIDER_API_KEY', 'AI_BASE_URL', 'AI_MODEL_ID', 'AI_REQUEST_STYLE']) delete env[key];
}

/**
 * Never inherit the admin allowlist from the invoking shell. A shell that happens to export ADMIN_EMAIL would otherwise
 * silently change which users the admin checks accept, so tests always start from the database-flag fallback.
 */
export function clearTestAdminEnv(env: Record<string, string | undefined>): void {
  for (const key of ['ADMIN_EMAIL', 'ADMIN_PRIVY_USER_ID']) delete env[key];
}

/**
 * Decides which database and Redis the tests may use. Integration tests insert fabricated rows, run global recompute jobs and
 * obliterate real BullMQ queues, so they must never reach the application's own services by default.
 * - Postgres: only a DATABASE_URL that passes `assertTestDatabase` (explicit NARRA_TEST_DATABASE_NAME, local host, matching name).
 * - Redis: only NARRA_TEST_REDIS_URL, a local redis:// URL you set on purpose (a separate instance, or a separate database number).
 * REDIS_URL is ignored, because the app's own Redis is usually what it points at.
 */
export function resolveTestEnv(env: Record<string, string | undefined>): TestEnvDecision {
  let databaseIsolated = false;
  // The name must be in this env object. Passing undefined on its own would fall back to assertTestDatabase's default
  // (process.env), which would let an unnamed environment through and contradict the "explicit name or nothing" rule.
  try { if (env.DATABASE_URL && env.NARRA_TEST_DATABASE_NAME) { assertTestDatabase(new URL(env.DATABASE_URL), env.NARRA_TEST_DATABASE_NAME); databaseIsolated = true; } } catch { /* not an isolated test database */ }
  let redisUrl = BLOCKED_REDIS_URL, redisIsolated = false;
  try {
    const u = env.NARRA_TEST_REDIS_URL ? new URL(env.NARRA_TEST_REDIS_URL) : null;
    if (u && ['redis:', 'rediss:'].includes(u.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) { redisUrl = env.NARRA_TEST_REDIS_URL!; redisIsolated = true; }
  } catch { /* not a usable URL */ }
  return { databaseUrl: databaseIsolated ? env.DATABASE_URL! : BLOCKED_DATABASE_URL, redisUrl, databaseIsolated, redisIsolated };
}
