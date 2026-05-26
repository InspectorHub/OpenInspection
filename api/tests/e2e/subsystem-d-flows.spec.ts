/**
 * Design System 0520 subsystem D P10 — E2E spec stubs.
 *
 * All test.skip pending the multi-user seed harness (same gap that
 * blocked subsystem-C and -E E2E). Unit coverage carries the
 * underlying logic:
 *
 *   tests/unit/unit-service.spec.ts          (CRUD + tree validation)
 *   tests/unit/unit-schema.spec.ts           (depth + cycle + name)
 *   tests/unit/observer-cookie.spec.ts       (HMAC round-trip)
 *   tests/unit/observer-link-service.spec.ts (mint/list/claim/revoke)
 *   tests/unit/report-version-service.spec.ts
 *   tests/unit/version-diff.spec.ts
 *
 * Unskip once the seed harness lands in tests/global-setup.ts.
 */
import { test, expect } from '@playwright/test';

test.skip('P1+P2 — create unit → scope rating → unit-selected event flows', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name=email]',    'inspector-a@seed.test');
    await page.fill('input[name=password]', 'seedpassword');
    await page.click('button[type=submit]');

    await page.goto('/inspections/seed-empty-inspection/edit');
    page.on('dialog', async d => { await d.accept('Building A'); });
    await page.click('[title="Add building"]');
    await expect(page.locator('text=Building A')).toBeVisible();

    await page.click('text=Building A');
    // selectedUnitId Alpine state should mirror the click.
});

test.skip('P5 — admin mints observer link → anonymous claim sets cookie → viewer renders', async ({ browser }) => {
    const adminCtx = await browser.newContext();
    const obsCtx   = await browser.newContext();
    const adminP   = await adminCtx.newPage();
    const obsP     = await obsCtx.newPage();

    await adminP.goto('/login');
    await adminP.fill('input[name=email]',    'inspector-a@seed.test');
    await adminP.fill('input[name=password]', 'seedpassword');
    await adminP.click('button[type=submit]');

    await adminP.goto('/inspections/seed-team-inspection/edit');
    await adminP.evaluate(() => window.dispatchEvent(new CustomEvent('open-mint-observer')));
    await adminP.click('text=Generate link');
    const url = await adminP.locator('input[readonly]').inputValue();
    expect(url).toMatch(/\/observe\/[A-Za-z0-9_-]{20,}$/);

    await obsP.goto(url);
    await expect(obsP).toHaveURL(/\/observe\/inspections\//);
    await expect(obsP.locator('text=Live view')).toBeVisible();
});

test.skip('P5 — expired / revoked observer cookie → /observer/expired recovery page', async ({ page }) => {
    await page.goto('/observe/inspections/some-id');
    await expect(page).toHaveURL(/\/observer\/expired/);
    await expect(page.locator('text=Observer link expired')).toBeVisible();
});

test.skip('P6 — observer joining presence WS appears with 👁 glyph in roster', async ({ browser }) => {
    const adminCtx = await browser.newContext();
    const obsCtx   = await browser.newContext();
    const adminP   = await adminCtx.newPage();
    const obsP     = await obsCtx.newPage();

    await adminP.goto('/login');
    await adminP.fill('input[name=email]',    'inspector-a@seed.test');
    await adminP.fill('input[name=password]', 'seedpassword');
    await adminP.click('button[type=submit]');
    await adminP.goto('/inspections/seed-team-inspection/edit');

    // observer joins via a pre-seeded link
    await obsP.goto('/observe/seed-observer-token');

    await adminP.evaluate(() => window.dispatchEvent(new CustomEvent('open-roster-popover')));
    await expect(adminP.locator('text=Observer (read-only)')).toBeVisible();
    await expect(adminP.locator('text=👁')).toBeVisible();
});

test.skip('P7+P9 — Republish UX prompts for summary + snapshots create new version diff', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name=email]',    'inspector-a@seed.test');
    await page.fill('input[name=password]', 'seedpassword');
    await page.click('button[type=submit]');

    await page.goto('/inspections/seed-published-inspection/edit');
    await page.click('text=Publish');
    await expect(page.locator('text=Republish')).toBeVisible();
    await page.fill('textarea[name=summary]', 'Fixed roof recommendation per follow-up');
    await page.click('button:has-text("Send All")');
});

test.skip('P8 — /inspections/:id/versions/:n/diff renders changed items + unit add/remove', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name=email]',    'inspector-a@seed.test');
    await page.fill('input[name=password]', 'seedpassword');
    await page.click('button[type=submit]');

    await page.goto('/inspections/seed-republished-inspection/versions/2/diff');
    await expect(page.locator('text=v1 → v2')).toBeVisible();
    await expect(page.locator('text=Items changed')).toBeVisible();
});
