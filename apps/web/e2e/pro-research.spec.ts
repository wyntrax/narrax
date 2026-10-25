import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { access, researchApi, enterWorkspace } from './research-fixtures';
import { ADDRESS, empty } from '../src/test/fixtures';

// Set E2E_BASE_URL for a separate fixture server; the regular suite uses its existing base URL.
test.use({ ...(process.env.E2E_BASE_URL ? { baseURL: process.env.E2E_BASE_URL } : {}) });
const at = '2026-10-25T12:00:00.000Z';
const evaluation = { status: 'UNKNOWN', checks: [{ key: 'liquidity', status: 'UNKNOWN', value: null, threshold: 200000, at: null, source: null, refs: [], reason: 'MISSING_OR_STALE' }] };
const monitor = { id: 'mine', kind: 'THESIS', name: 'Liquidity supports my thesis', thesis: 'A thesis with explicit evidence gaps.', mint: ADDRESS, narrativeSlug: null, active: true, updatedAt: at,
  rules: { minLiquidityUsd: 200000, minIndependentBuyers: null, windowMinutes: 30, minNarrativeVelocity: null, maxRiskScore: null },
  lastRun: { at, considered: 1, matched: 0, unknown: 1, capped: false }, observations: [{ id: 'observation', mint: ADDRESS, at, evaluation }] };

for (const width of [1440, 390]) for (const [path, title] of [['personal-radar', 'Personal Radar'], ['theses', 'Thesis Tracker'], ['briefing', 'Personal Briefing']]) {
  test(`PRO ${path}: ${width}, evidence and accessible layout`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.setViewportSize({ width, height: 900 });
    await researchApi(page, path => path === '/v1/personal-research/theses' ? { body: { items: [monitor] } }
      : path === '/v1/personal-research/radars' ? { body: { items: [] } }
      : path === '/v1/personal-research/briefings' ? { body: { items: [{ day: '2026-10-25', generatedAt: at, since: '2026-10-24T12:00:00.000Z', radarMatches: 0, thesisChanges: 1, unknown: 1, capped: false,
        items: [{ monitorId: monitor.id, name: monitor.name, kind: 'THESIS', mint: ADDRESS, at, previousStatus: null, evaluation }] }] } } : undefined);
    await enterWorkspace(page, `/app/${path}`);
    await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
    if (path === 'personal-radar') await page.getByRole('button', { name: 'Create radar', exact: true }).click();
    if (path === 'theses') await page.getByText('Recent observations · latest 20', { exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('.research-main').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    expect(errors).toEqual([]);
    await page.screenshot({ path: `test-results/pro-${path}-${width}.png`, fullPage: true });
  });
}
test('Early Access cannot mount any personal workspace', async ({ page }) => {
  const requests = await researchApi(page, path => path === '/v1/me/entitlements' ? { body: { ...access, effectiveTier: 'EARLY_ACCESS', features: empty.features } } : undefined);
  for (const path of ['personal-radar', 'theses', 'briefing']) {
    await enterWorkspace(page, `/app/${path}`);
    await expect(page.getByRole('heading', { name: 'Research access required' })).toBeVisible();
  }
  expect(requests.some(path => path.startsWith('/v1/personal-research'))).toBe(false);
});
