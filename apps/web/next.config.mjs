import createNextIntlPlugin from 'next-intl/plugin';
import path from 'node:path';
if (process.env.NODE_ENV === 'production' && Object.hasOwn(process.env, 'NARRA_WEB_TEST_AUTH')) {
  throw new Error('NARRA_WEB_TEST_AUTH is forbidden in production; unset it before building or starting.');
}
const testAuth = process.env.NARRA_WEB_TEST_AUTH === '1';
/** @type {import('next').NextConfig} */
const config = {
  transpilePackages: ['@narra/shared'],
  poweredByHeader: false,
  devIndicators: false,
  distDir: testAuth ? '.next-e2e' : '.next',
  webpack(config) {
    if (testAuth) {
      config.resolve.alias['@/components/auth/privy'] = path.resolve('e2e/auth-fixture.tsx');
      config.resolve.alias[path.resolve('src/components/auth/privy.tsx')] = path.resolve('e2e/auth-fixture.tsx');
    }
    return config;
  },
  async headers() { return [{source: '/:path*', headers: [
    {key: 'X-Content-Type-Options', value: 'nosniff'}, {key: 'X-Frame-Options', value: 'DENY'},
    {key: 'Referrer-Policy', value: 'no-referrer'}, {key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()'}
  ]}]; }
};
export default createNextIntlPlugin('./src/i18n/request.ts')(config);
