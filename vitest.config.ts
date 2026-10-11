import { defineConfig } from 'vitest/config';

// Integration tests share one database and run its global recompute jobs, so files run one at a time.
export default defineConfig({ envDir: './apps/web/no-env-files', test: { fileParallelism: false, exclude: ['**/node_modules/**', '**/dist/**', 'apps/web/**'] } });
