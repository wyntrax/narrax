/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS preload must intercept require before Next loads. */
// This workflow accepts process environment only. Prevent Next (including forked
// build/dev workers) from automatically loading or watching real .env files.
const envId = require.resolve('@next/env');
const env = require(envId);
require.cache[envId].exports = {
  ...env,
  loadEnvConfig: () => ({combinedEnv: process.env, parsedEnv: {}, loadedEnvFiles: []}),
};
if (require.main === module) {
  const preload = `--require="${__filename.replaceAll('\\', '/')}"`;
  process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, preload].filter(Boolean).join(' ');
  require('next/dist/bin/next');
}
