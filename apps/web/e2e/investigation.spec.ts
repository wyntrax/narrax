import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { access, researchApi, enterWorkspace } from './research-fixtures';
import { empty } from '../src/test/fixtures';
import { investigationStrategyFixture as investigationFixture } from '../src/features/investigation/fixture';
import { investigationCopy } from '../src/features/investigation/copy';
import { strategyCopy } from '../src/features/investigation/strategy-copy';

test.use({ ...(process.env.E2E_BASE_URL ? { baseURL: process.env.E2E_BASE_URL } : {}) });
for (const width of [1440, 390]) for (const locale of ['en', 'id'] as const) {
  test(`investigation ${locale} ${width}: compare, evidence, paging and accessibility`, async ({ page }) => {
    const c = investigationCopy[locale], fixture = investigationFixture(), errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewportSize({ width, height: 900 });
    const requests = await researchApi(page, (path, url) => path.startsWith('/v1/smart-money/investigations/') ? { body: { ...fixture, window: url.searchParams.get('window') ?? '24h', ...(url.searchParams.has('cursor') ? { nextCursor: null, trades: [{ ...fixture.trades[0]!, signature: '3'.repeat(88) }] } : {}) } } : undefined);
    await page.goto(`/${locale}/app/investigation/${fixture.token.mint}`, { waitUntil: 'domcontentloaded' });
    await page.locator('.gate-primary').click();
    await expect(page.locator('.research-shell')).toBeVisible();
    await expect(page.getByRole('heading', { name: c.title, exact: true, level: 1 })).toBeVisible();
    await expect(page.getByText(c.capped, { exact: true })).toBeVisible();
    const strategy = strategyCopy[locale];
    await expect(page.getByRole('heading', { name: strategy.title, exact: true })).toBeVisible();
    await page.getByText(strategy.details, { exact: true }).click();
    await expect(page.getByRole('heading', { name: `${strategy.counterexamples} (1)`, exact: true })).toBeVisible();
    await page.getByText(strategy.frozen, { exact: true }).click();
    await expect(page.getByText('historic-cluster', { exact: true })).toBeVisible();
    await expect(page.getByText(`1h · ${strategy.MEASURED}`, { exact: true })).toBeVisible();
    const boxes = page.getByRole('checkbox'); await boxes.nth(0).check(); await boxes.nth(1).check(); await boxes.nth(2).check(); await expect(boxes.nth(3)).toBeDisabled();
    await expect(page.getByText(c.comparisonReady)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('.research-main').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    const evidence = page.getByRole('button', { name: `${c.evidence} 222222…2222`, exact: true }); await evidence.click();
    const dialog = page.getByRole('dialog'); await expect(dialog.getByText(/untrusted evidence/)).toBeVisible();
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.keyboard.press('Escape'); await expect(dialog).toBeHidden(); await expect(evidence).toBeFocused();
    await page.getByRole('button', { name: `${c.groupEvidence} ${c.group} 1`, exact: true }).click();
    await expect(page.getByRole('dialog').getByText(c.relationshipCap)).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: c.close }).click();
    const next = page.locator('.research-pager button').last(); await next.click(); await expect(next).toBeDisabled();
    expect(requests.some(path => { const u = new URL(path, 'http://localhost'); return u.searchParams.get('cursor') === fixture.nextCursor && u.searchParams.get('asOf') === fixture.asOf; })).toBe(true);
    await page.getByLabel(c.window).selectOption('7d'); await expect(next).toBeEnabled();
    await page.screenshot({ path: `test-results/investigation-${locale}-${width}.png`, fullPage: true }); expect(errors).toEqual([]);
  });
}
test('denied direct navigation makes no investigation data request', async ({ page }) => {
  const requests = await researchApi(page, path => path === '/v1/me/entitlements' ? { body: { ...access, effectiveTier: 'EARLY_ACCESS', features: empty.features } } : undefined);
  await enterWorkspace(page, `/app/investigation/${investigationFixture().token.mint}`);
  await expect(page.getByRole('heading', { name: 'Research access required' })).toBeVisible();
  expect(requests.some(path => path.startsWith('/v1/smart-money/investigations/'))).toBe(false);
});
test('Early Access override opens the desk and directory navigation reaches the token', async ({ page }) => {
  const fixture = investigationFixture();
  await researchApi(page, path => path === '/v1/me/entitlements' ? { body: { ...access, effectiveTier: 'EARLY_ACCESS', features: { ...empty.features, 'research.smart_money_investigation': { allowed: true, requiredTier: 'EARLY_ACCESS', min_entitlement_age_hours: 0 } } } } : path.startsWith('/v1/smart-money/investigations/') ? { body: fixture } : undefined);
  await enterWorkspace(page, '/app/investigation');
  await page.getByLabel('Solana token mint').fill(fixture.token.mint); await page.getByRole('button', { name: 'Investigate token', exact: true }).click();
  await expect(page.getByText(investigationCopy.en.capped, { exact: true })).toBeVisible(); await expect(page).toHaveURL(new RegExp(`/investigation/${fixture.token.mint}$`));
});
