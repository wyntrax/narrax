// Vitest global setup: runs once and says why integration tests will be skipped, so a skip is never a mystery.
import { resolveTestEnv } from './test-isolation';

export default function setup(): void {
  const d = resolveTestEnv(process.env);
  if (d.databaseIsolated && d.redisIsolated) return;
  const lines = ['', 'Test isolation: integration tests that need these services will be SKIPPED, not run against your real ones.'];
  if (!d.databaseIsolated) lines.push('  Postgres: set NARRA_TEST_DATABASE_NAME=narra_<something>_test and DATABASE_URL=postgresql://.../narra_<something>_test (local host).');
  if (!d.redisIsolated) lines.push('  Redis:    set NARRA_TEST_REDIS_URL=redis://127.0.0.1:<port>[/<db>] for a Redis used only by tests (REDIS_URL is ignored).');
  lines.push('  scripts/check-test-results.mjs fails the run while anything is skipped, so a full verification needs both.', '');
  console.warn(lines.join('\n'));
}
