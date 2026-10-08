import { readFileSync, readdirSync } from 'node:fs';
import { expect, it } from 'vitest';
import { GATED_ROUTES } from './gating';
it('every literal HTTP registration is deliberately classified; generated account routes stay in the named always-open tests', () => {
  const always = new Set([...readFileSync('apps/api/src/entitlements/alwaysOpen.test.ts', 'utf8').matchAll(/'(GET|POST|PUT|PATCH|DELETE) ([^']+)'/g)].map(m => `${m[1]} ${m[2]}`));
  const mixed = new Set(['GET /v1/tokens', 'GET /v1/opportunities', 'GET /v1/opportunities/:id/analysis', 'GET /v1/wallets/:address', 'GET /v1/wallets/:address/trades', 'GET /v1/stream']);
  const newRoutes = new Set(['GET /v1/me/entitlements', 'POST /v1/me/early-access/join', 'DELETE /v1/me/early-access', 'GET /v1/admin/entitlements/settings', 'PUT /v1/admin/entitlements/settings', 'GET /v1/admin/users/:userId/entitlements', 'POST /v1/admin/users/:userId/entitlements/grants', 'POST /v1/admin/users/:userId/entitlements/grants/:id/revoke', 'DELETE /v1/admin/users/:userId/linked-wallets/:id', 'POST /v1/admin/entitlements/reconcile', 'GET /v1/admin/early-access/stats', 'POST /v1/integrations/wyntrax/events']);
  const files = ['apps/api/src', 'apps/api/src/entitlements'].flatMap(dir => readdirSync(dir).filter(f => f.endsWith('.ts') && !f.includes('.test')).map(f => `${dir}/${f}`));
  let count = 0;
  for (const file of files) for (const m of readFileSync(file, 'utf8').matchAll(/\b(?:app|scoped)\.(get|post|put|patch|delete)\('([^']+)'/g)) {
    const route = `${m[1]!.toUpperCase()} ${m[2]}`; count++;
    expect(always.has(route) || mixed.has(route) || newRoutes.has(route) || Object.hasOwn(GATED_ROUTES, route), `${file}: ${route}`).toBe(true);
  }
  expect(count).toBeGreaterThan(90);
});
