/**
 * Design System 0520 subsystem D P10 — E2E spec stubs.
 *
 * All test.skip pending the multi-user seed harness (same gap that
 * blocked subsystem-C and -E E2E). Unit coverage carries the
 * underlying logic:
 *
 *   tests/unit/unit-service.spec.ts          (CRUD + tree validation)
 *   tests/unit/unit-schema.spec.ts           (depth + cycle + name)
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
