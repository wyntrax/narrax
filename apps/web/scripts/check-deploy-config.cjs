/* eslint-disable @typescript-eslint/no-require-imports -- Used by Docker build and standalone startup. */
const fs = require('node:fs');
const path = require('node:path');
const publicKeys = ['NEXT_PUBLIC_SITE_URL', 'NEXT_PUBLIC_API_URL', 'NEXT_PUBLIC_PRIVY_APP_ID', 'NEXT_PUBLIC_WYNTRAX_URL'];
function validateConfig(env) {
  if (Object.hasOwn(env, 'NARRA_WEB_TEST_AUTH')) throw Error('NARRA_WEB_TEST_AUTH must be absent');
  const values = Object.fromEntries(publicKeys.map(key => [key, env[key] || '']));
  if (Object.values(values).some(value => /\s/.test(value))) throw Error('Public deployment settings must not contain whitespace');
  for (const key of ['NEXT_PUBLIC_SITE_URL', 'NEXT_PUBLIC_API_URL']) {
    let url;
    try { url = new URL(values[key]); } catch { throw Error(`${key} must be a public HTTPS origin`); }
    if (url.protocol !== 'https:' || url.origin !== values[key] || url.username || url.password || /^(localhost|127\.|0\.|\[?::1\]?)/i.test(url.hostname) || url.hostname.endsWith('.localhost')) throw Error(`${key} must be a bare public HTTPS origin`);
  }
  if (!/^[a-zA-Z0-9_-]{2,200}$/.test(values.NEXT_PUBLIC_PRIVY_APP_ID)) throw Error('NEXT_PUBLIC_PRIVY_APP_ID must be a nonempty public app ID');
  if (values.NEXT_PUBLIC_WYNTRAX_URL) {
    let url;
    try { url = new URL(values.NEXT_PUBLIC_WYNTRAX_URL); } catch { throw Error('NEXT_PUBLIC_WYNTRAX_URL must be an HTTPS URL or empty'); }
    if (url.protocol !== 'https:' || url.username || url.password) throw Error('NEXT_PUBLIC_WYNTRAX_URL must be an HTTPS URL or empty');
  }
  if (!['true', 'false'].includes(env.NARRA_SEO_INDEXABLE)) throw Error('NARRA_SEO_INDEXABLE must explicitly be true or false');
  for (const key of ['NARRA_GOOGLE_SITE_VERIFICATION', 'NARRA_BING_SITE_VERIFICATION']) if (env[key] && !/^[a-zA-Z0-9_-]{1,300}$/.test(env[key])) throw Error(`${key} is not a verification token`);
  return values;
}
function checkConfig(env, manifest) {
  const values = validateConfig(env);
  for (const key of publicKeys) if (values[key] !== manifest[key]) throw Error(`${key} differs from the image build; rebuild the frontend before changing it`);
  return values;
}
module.exports = {validateConfig, checkConfig};
if (require.main === module) {
  try {
    const file = process.env.NARRA_WEB_CONFIG_FILE || path.resolve(__dirname, '../../../web-release-config.json');
    if (process.argv.includes('--write')) fs.writeFileSync(file, `${JSON.stringify(validateConfig(process.env))}\n`, {mode: 0o644});
    else checkConfig(process.env, JSON.parse(fs.readFileSync(file, 'utf8')));
    console.log('Web deployment configuration validated.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
