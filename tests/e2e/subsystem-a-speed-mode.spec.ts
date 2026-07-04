/**
 * Design System 0520 subsystem A phase 3 — SpeedMode E2E (Task 3.6).
 *
 * Required env vars (.dev.vars or shell):
 *   TEST_INSPECTOR_EMAIL
 *   TEST_INSPECTOR_PASSWORD
 *   TEST_INSPECTION_ID      — uuid of an inspection with at least one
 *                              unrated item the inspector can edit
 *
 * Skipped automatically when any var is missing so local CI doesn't fail
 * just because seed data isn't loaded.
 */
import { test, expect } from '@playwright/test';

const EMAIL = process.env['TEST_INSPECTOR_EMAIL'];
const PASSWORD = process.env['TEST_INSPECTOR_PASSWORD'];
const INSPECTION_ID = process.env['TEST_INSPECTION_ID'];

test.describe('SpeedMode (subsystem A M10)', () => {
    test.skip(
        !EMAIL || !PASSWORD || !INSPECTION_ID,
        'Set TEST_INSPECTOR_EMAIL / TEST_INSPECTOR_PASSWORD / TEST_INSPECTION_ID to run.',
    );

    test.beforeEach(async ({ page }) => {
        await page.goto('/login');
        await page.fill('input[name=email]',    EMAIL!);
        await page.fill('input[name=password]', PASSWORD!);
        await page.click('button[type=submit]');
        await page.waitForURL('**/inspections');
        await page.goto(`/inspections/${INSPECTION_ID}/edit`);
        // De-stale (2026-07 tests-reorg): the RR v7 editor shell renders a
        // single <main> (app/routes/inspection-edit.tsx:1873) — was the Alpine
        // [x-data*=inspectionEditor] root.
        await page.getByRole('main').waitFor({ state: 'visible' });
    });

    test('Z opens overlay; 1 rates first unrated + advances; Z exits', async ({ page }) => {
        await page.keyboard.press('z');
        const dialog = page.locator('[role=dialog][aria-label="Speed-rate inspection items"]');
        await expect(dialog).toBeVisible({ timeout: 5_000 });

        // Capture initial "Item N of M" — pressing 1 should advance.
        const counter = dialog.locator('text=/Item \\d+ of \\d+/');
        const before = await counter.textContent();
        await page.keyboard.press('1');
        // Either the counter changes OR (if only one unrated item existed) the
        // "All items rated" path runs and the overlay closes.
        await page.waitForTimeout(300);
        if (await dialog.isVisible()) {
            await expect(counter).not.toHaveText(before!);
        }

        await page.keyboard.press('z');
        await expect(dialog).toBeHidden({ timeout: 3_000 });
    });

    test('Esc exits SpeedMode', async ({ page }) => {
        await page.keyboard.press('z');
        const dialog = page.locator('[role=dialog][aria-label="Speed-rate inspection items"]');
        await expect(dialog).toBeVisible({ timeout: 5_000 });
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden({ timeout: 3_000 });
    });
});
