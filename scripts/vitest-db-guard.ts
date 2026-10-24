// Vitest setup file: runs in every test file before it loads. See test-isolation.ts for the rules.
import { beforeEach } from 'vitest';
import { clearTestAdminEnv, clearTestAiEnv, resolveTestEnv } from './test-isolation';

const decision = resolveTestEnv(process.env);
clearTestAiEnv(process.env);
clearTestAdminEnv(process.env);
process.env.DATABASE_URL = decision.databaseUrl;
process.env.REDIS_URL = decision.redisUrl;
// Tests opt into enforcement explicitly; an operator shell must not turn shadow fixtures into zero-alert tests.
delete process.env.RADAR_SAFETY_MODE;

// Prisma may lazily load the repository `.env` when a test constructs its client, which puts the
// admin allowlist (and AI keys) back after the one-time setup above. Re-assert isolation before each
// test; a test that deliberately exercises the allowlist sets it inside the test body.
beforeEach(() => {
  clearTestAdminEnv(process.env);
  clearTestAiEnv(process.env);
});
