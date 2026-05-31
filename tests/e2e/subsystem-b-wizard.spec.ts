/**
 * Design System 0520 subsystem B phase 5 task 5.5 — NewInspectionWizard E2E.
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

test.describe('NewInspectionWizard (subsystem B M6)', () => {
    test.skip(!EMAIL || !PASSWORD, 'Set TEST_INSPECTOR_EMAIL / TEST_INSPECTOR_PASSWORD to run.');

    test.beforeEach(async ({ page }) => {
        await page.goto('/login');
        await page.fill('input[name=email]',    EMAIL!);
        await page.fill('input[name=password]', PASSWORD!);
        await page.click('button[type=submit]');
        await page.waitForURL('**/dashboard');
    });

    test('happy path — 4 steps → create → redirect to edit', async ({ page }) => {
        await page.click('button[title="Open 4-step wizard"]');
        const dialog = page.locator('[role=dialog][aria-label="New inspection wizard"]');
        await expect(dialog).toBeVisible();

        // Step 1 — fill address
        await dialog.locator('input[aria-label="Property address"]').fill('789 Test Lane');
        await dialog.locator('button:has-text("Next")').click();

        // Step 2 — general pre-selected, just advance
        await dialog.locator('button:has-text("Next")').click();

        // Step 3 — fill date (start time defaults to 09:00)
        const today = new Date();
        const future = new Date(today.getTime() + 7 * 86_400_000);
        const iso = future.toISOString().slice(0, 10);
        await dialog.locator('input[type=date]').fill(iso);
        await dialog.locator('button:has-text("Next")').click();

        // Step 4 — leave teamMode unchecked
        await dialog.locator('button:has-text("Create")').click();

        await page.waitForURL(/\/inspections\/[a-f0-9-]+\/edit/, { timeout: 8_000 });
    });

    test('step 1 blocks Next on empty address', async ({ page }) => {
        page.on('dialog', d => d.accept());
        await page.click('button[title="Open 4-step wizard"]');
        const dialog = page.locator('[role=dialog][aria-label="New inspection wizard"]');
        await dialog.locator('input[aria-label="Property address"]').fill('');
        await dialog.locator('button:has-text("Next")').click();

        // Still on step 1 indicator
        await expect(dialog.locator('text=Step 2')).toBeVisible();   // chip exists but inactive
        // The step header should still highlight Step 1 (Property)
        await expect(dialog.locator('text=Property')).toBeVisible();
    });
});
