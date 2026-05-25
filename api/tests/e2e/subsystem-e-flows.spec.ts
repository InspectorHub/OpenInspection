/**
 * Design System 0520 subsystem E P10 — E2E spec stubs.
 *
 * All test.skip: the multi-user seed harness needed to make these
 * runnable is the same gap that blocked the subsystem-C and -D E2E
 * specs. Unit-test coverage for the underlying logic is solid:
 *
 *   tests/unit/preflight.spec.ts          (9 tests, GREEN)
 *   tests/unit/csv-export.spec.ts         (7 tests, GREEN)
 *   tests/unit/identity-service.spec.ts   (7 tests, GREEN)
 *   tests/unit/analytics.spec.ts          (8 tests, GREEN)
 *
 * Unskip once the seed harness lands in tests/global-setup.ts.
 */
import { test, expect } from '@playwright/test';

test.skip('P1 — publish-modal Send All button disabled until all 5 pre-flight gates pass', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name=email]',    'inspector-half@seed.test');
    await page.fill('input[name=password]', 'seedpassword');
    await page.click('button[type=submit]');

    await page.goto('/inspections/seed-half-done-inspection/edit');
    await page.click('text=Publish');

    await expect(page.locator('[data-test=publish-send-all]')).toBeDisabled();
    await expect(page.locator('text=All items rated')).toBeVisible();
    await expect(page.locator('text=Cover photo set')).toBeVisible();
});

test.skip('P2 — workflow tab AND-filters with time tab + survives URL reload', async ({ page }) => {
    await page.goto('/dashboard?workflow=drafts');
    await expect(page.locator('button:has-text("Drafts").bg-indigo-600')).toBeVisible();
    await page.click('text=Awaiting payment');
    await expect(page).toHaveURL(/workflow=awaitingPayment/);
});

test.skip('P3 — CSV Export downloads visible inspections', async ({ page }) => {
    await page.goto('/dashboard');
    const downloadPromise = page.waitForEvent('download');
    await page.click('button:has-text("Export")');
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^inspections-\d{4}-\d{2}-\d{2}\.csv$/);
});

test.skip('P4 — user with linked identity can switch into the linked tenant', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name=email]',    'multi-tenant-user@seed.test');
    await page.fill('input[name=password]', 'seedpassword');
    await page.click('button[type=submit]');

    await page.click('[aria-label="User menu"]');
    await expect(page.locator('text=Switch identity')).toBeVisible();
    await page.click('text=branch-b@seed.test');
    await page.waitForURL('**/dashboard');
});

test.skip('P6 — IntegrationGrid renders 6 cards with correct connected state', async ({ page }) => {
    await page.goto('/settings/integrations-grid');
    for (const name of ['QuickBooks Online', 'Stripe Connect', 'Google Calendar',
                        'Resend (email)',    'Google Places',  'Gemini AI']) {
        await expect(page.locator(`text=${name}`)).toBeVisible();
    }
});

test.skip('P7 — AnalyticsPanel renders growth chart + findings heatmap on /metrics', async ({ page }) => {
    await page.goto('/metrics');
    await expect(page.locator('text=Inspections per month')).toBeVisible();
    await expect(page.locator('text=Findings heatmap')).toBeVisible();
    await expect(page.locator('svg polyline')).toBeVisible();
});

test.skip('P8 — published report footer renders TeamCredit + NACHI badge when configured', async ({ page }) => {
    await page.goto('/reports/seed-delivered-inspection');
    await expect(page.locator('text=Inspected by')).toBeVisible();
    await expect(page.locator('text=InterNACHI')).toBeVisible();
});
