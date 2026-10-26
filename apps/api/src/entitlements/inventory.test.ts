import { readFileSync, readdirSync } from 'node:fs';
import { expect, it } from 'vitest';
import { GATED_ROUTES } from './gating';
it('every literal HTTP registration is deliberately classified; generated account routes stay in the named always-open tests', () => {
  const always = new Set([...readFileSync('apps/api/src/entitlements/alwaysOpen.test.ts', 'utf8').matchAll(/'(GET|POST|PUT|PATCH|DELETE) ([^']+)'/g)].map(m => `${m[1]} ${m[2]}`));
  const mixed = new Set(['GET /v1/tokens', 'GET /v1/opportunities', 'GET /v1/opportunities/:id/analysis', 'GET /v1/wallets/:address', 'GET /v1/wallets/:address/trades', 'GET /v1/stream']);
  // This route applies research.tokens explicitly inside the authenticated handler.
  mixed.add('GET /v1/tokens/:mint/history');
  const newRoutes = new Set(['GET /v1/me/entitlements', 'POST /v1/me/membership/refresh', 'POST /v1/me/early-access/join', 'DELETE /v1/me/early-access', 'GET /v1/admin/entitlements/settings', 'PUT /v1/admin/entitlements/settings', 'GET /v1/admin/users/:userId/entitlements', 'POST /v1/admin/users/:userId/entitlements/grants', 'POST /v1/admin/users/:userId/entitlements/grants/:id/revoke', 'DELETE /v1/admin/users/:userId/linked-wallets/:id', 'GET /v1/admin/early-access/stats', 'POST /v1/integrations/wyntrax/events']);
  newRoutes.add('GET /v1/early-access/status');
  // Authenticated four-number teaser, explicitly tier-independent; all detailed research stays gated.
  newRoutes.add('GET /v1/market-preview');
  // Own-account paper-only routes: authentication/ownership/governor, never research-tier authority.
  for(const route of ['GET /v1/paper-trades/account','POST /v1/paper-trades/preview','POST /v1/paper-trades/confirm'])newRoutes.add(route);
  // Public, unauthenticated, no per-user data: the $Wyntrax tier amounts and the early-access window.
  newRoutes.add('GET /v1/access/requirements');
  for (const route of ['GET /v1/public-config', 'GET /v1/admin/runtime-settings', 'POST /v1/admin/runtime-settings/check-privy', 'GET /v1/admin/users/lookup', 'GET /v1/admin/early-access/grants']) newRoutes.add(route);
  // Admin-only research review and its diagnostics; operator approval never grants research eligibility.
  for (const route of ['GET /v1/admin/wallet-research/health', 'POST /v1/admin/wallets/:address/research-review']) newRoutes.add(route);
  // Manual user-signed swaps: own-data config/history/status are authentication-only; research, balances,
  // preview and submit require research.tokens and are still blocked by evidence and wallet checks.
  for (const route of ['GET /v1/manual-trades/config', 'GET /v1/manual-trades/balances', 'POST /v1/manual-trades/research', 'POST /v1/manual-trades/preview', 'POST /v1/manual-trades/submit', 'GET /v1/manual-trades', 'GET /v1/manual-trades/:id']) newRoutes.add(route);
  const files = ['apps/api/src', 'apps/api/src/entitlements'].flatMap(dir => readdirSync(dir).filter(f => f.endsWith('.ts') && !f.includes('.test')).map(f => `${dir}/${f}`));
  let count = 0;
  for (const file of files) for (const m of readFileSync(file, 'utf8').matchAll(/\b(?:app|scoped)\.(get|post|put|patch|delete)\('([^']+)'/g)) {
    const route = `${m[1]!.toUpperCase()} ${m[2]}`; count++;
    expect(always.has(route) || mixed.has(route) || newRoutes.has(route) || Object.hasOwn(GATED_ROUTES, route), `${file}: ${route}`).toBe(true);
  }
  expect(count).toBeGreaterThan(90);
});
