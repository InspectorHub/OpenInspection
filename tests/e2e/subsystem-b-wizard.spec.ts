/**
 * New Inspection wizard — now a dedicated full page at /inspections/new
 * (converted from the former modal overlay).
 *
 * Required env vars (.dev.vars or shell):
 *   TEST_INSPECTOR_EMAIL
 *   TEST_INSPECTOR_PASSWORD
 *
 * Skipped automatically when missing.
 */
import { test, expect } from '@playwright/test';

const EMAIL    = process.env['TEST_INSPECTOR_EMAIL'];
const PASSWORD = process.env['TEST_INSPECTOR_PASSWORD'];

test.describe('New Inspection wizard page (/inspections/new)', () => {
    test.skip(!EMAIL || !PASSWORD, 'Set TEST_INSPECTOR_EMAIL / TEST_INSPECTOR_PASSWORD to run.');

    test.beforeEach(async ({ page }) => {
        await page.goto('/login');
        await page.fill('input[name=email]',    EMAIL!);
        await page.fill('input[name=password]', PASSWORD!);
        await page.click('button[type=submit]');
        await page.waitForURL('**/inspections');
    });

    test('New Inspection button navigates to the dedicated page (no modal)', async ({ page }) => {
        await page.getByRole('button', { name: 'New Inspection' }).click();
        await page.waitForURL('**/inspections/new');
        await expect(page.getByRole('heading', { name: 'New Inspection' })).toBeVisible();
        // Rendered full-page — there is no modal dialog / scrim anymore.
        await expect(page.locator('[role=dialog]')).toHaveCount(0);
    });

    test('renders the property step with an address input', async ({ page }) => {
        await page.goto('/inspections/new');
        await expect(page.getByText('Property Type')).toBeVisible();
        await page.locator('input[placeholder="123 Main St, City, State"]').fill('789 Test Lane');
        // Next gates on address (>=5 chars) AND a selected template, so it
        // stays present; the create flow itself is covered by unit/api tests.
        await expect(page.getByRole('button', { name: 'Next' })).toBeVisible();
    });
});
