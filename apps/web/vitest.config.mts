import {defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';
export default defineConfig({envDir:fileURLToPath(new URL('./no-env-files',import.meta.url)),resolve: {alias: {'@': fileURLToPath(new URL('./src', import.meta.url))}}, esbuild: {jsx: 'automatic'}, test: {server:{deps:{inline:['next-intl']}},environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'], setupFiles: ['./src/test/setup.ts']}});
