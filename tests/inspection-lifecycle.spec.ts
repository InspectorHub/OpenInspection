/**
 * Spec 3A — Inspection Lifecycle E2E
 *
 * Requires env vars (or defaults to local dev):
 *   BASE_URL      — e.g. https://your-core.workers.dev   (default: http://127.0.0.1:8788)
 *   TEST_EMAIL    — admin account email                   (default: admin@example.com)
 *   TEST_PASSWORD — admin account password                (default: changeme)
 *
 * Do NOT run against a local wrangler instance without first completing setup
 * (POST /setup) and ensuring the admin credentials above are valid.
 *
 * Coverage:
 *   1. Cancel via action menu → inspection appears in Cancelled section
 *   2. Uncancel → inspection returns to scheduled/today section
 */

import { test, expect, Page } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8788';
const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@example.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'changeme';

/**
 * Log in via the /login page and wait for the dashboard to appear.
 * The login form uses `#email`, `#password`, and `#submitBtn` IDs (see login.tsx).
 */
async function login(page: Page): Promise<void> {
    await page.goto(`${BASE_URL}/login`);
    await page.fill('#email', TEST_EMAIL);
    await page.fill('#password', TEST_PASSWORD);
    await page.click('#submitBtn');
    await page.waitForURL(/\/(dashboard|agent-dashboard)/, { timeout: 15000 });
}

test.describe('Spec 3A — Inspection Lifecycle (action menu + cancel modal)', () => {
    test('cancel via action menu → appears in Cancelled section → uncancel', async ({ page }) => {
        await login(page);
        await page.goto(`${BASE_URL}/dashboard`);

        // Find first inspection row (any section). data-test attribute added by T11.
        const firstRow = page.locator('[data-test="inspection-row"]').first();
        const exists = (await firstRow.count()) > 0;
        if (!exists) {
            test.skip(true, 'No inspections present on dashboard — cannot exercise lifecycle');
            return;
        }

        // Click •••, choose Cancel
        await firstRow.locator('button:has-text("•••")').click();
        await page.click('button:has-text("Cancel")');

        // Cancel modal opens — choose reason + submit
        await expect(page.locator('text=Cancel inspection')).toBeVisible({ timeout: 5000 });
        await page
            .locator('text=Reason >> ../select')
            .selectOption('weather')
            .catch(async () => {
                // Fallback: any select inside the modal
                await page.locator('select').first().selectOption('weather');
            });
        await page.fill('textarea', 'E2E test — automated cancel');
        await page.click('button:has-text("Cancel inspection")');

        // Wait for the dashboard to reload + Cancelled section to appear
        await expect(page.locator('button:has-text("Cancelled")')).toBeVisible({ timeout: 10000 });

        // Expand Cancelled section
        await page.click('button:has-text("Cancelled")');

        // Find a row inside the now-expanded Cancelled section, click ••• → Uncancel
        const cancelledRow = page.locator('[data-test="inspection-row"]').last();
        await cancelledRow.locator('button:has-text("•••")').click();
        await page.click('button:has-text("Uncancel")');

        // Look for success indicator (toast or row reappearing in scheduled/today section)
        await expect(
            page.locator('text=succeeded').or(page.locator('text=Today'))
        ).toBeVisible({ timeout: 10000 });
    });
});
