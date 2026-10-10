import createNextIntlPlugin from 'next-intl/plugin';
/** @type {import('next').NextConfig} */
const config = {
  transpilePackages: ['@narra/shared'],
  poweredByHeader: false,
  async headers() { return [{source: '/:path*', headers: [
    {key: 'X-Content-Type-Options', value: 'nosniff'}, {key: 'X-Frame-Options', value: 'DENY'},
    {key: 'Referrer-Policy', value: 'no-referrer'}, {key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()'}
  ]}]; }
};
export default createNextIntlPlugin('./src/i18n/request.ts')(config);
