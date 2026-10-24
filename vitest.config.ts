import { defineConfig } from 'vitest/config';

// Integration tests share one database and run its global recompute jobs, so files run one at a time.
// They also insert fabricated rows and obliterate real queue names, so scripts/test-isolation.ts points DATABASE_URL and REDIS_URL at an
// unreachable address unless an isolated test database and test Redis are named explicitly. Without them those tests skip.
export default defineConfig({
  envDir: './apps/web/no-env-files',
  test: {
    fileParallelism: false,
    exclude: ['**/node_modules/**', '**/dist/**', 'apps/web/**'],
    setupFiles: ['./scripts/vitest-db-guard.ts'],
    globalSetup: ['./scripts/vitest-global-setup.ts'],
  },
});
