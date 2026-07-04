/**
 * Design System 0520 subsystem A phase 5 — InspectorTools FAB dock E2E
 * (Task 5.5).
 *
 * Required env vars (.dev.vars or shell):
 *   TEST_INSPECTOR_EMAIL
 *   TEST_INSPECTOR_PASSWORD
 *   TEST_INSPECTION_ID
 *
 * Skipped automatically when any var is missing.
 */
import { test, expect } from '@playwright/test';

const EMAIL = process.env['TEST_INSPECTOR_EMAIL'];
const PASSWORD = process.env['TEST_INSPECTOR_PASSWORD'];
const INSPECTION_ID = process.env['TEST_INSPECTION_ID'];

test.describe('InspectorTools FAB dock (subsystem A M15)', () => {
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

    test('FAB visible at page load', async ({ page }) => {
        await expect(page.locator('[aria-label="Open inspector tools"]')).toBeVisible({ timeout: 5_000 });
    });

    test('click FAB opens dock with 4 tiles', async ({ page }) => {
        await page.click('[aria-label="Open inspector tools"]');
        const menu = page.locator('[role=menu][aria-label="Inspector tools"]');
        await expect(menu).toBeVisible();
        await expect(menu.locator('[role=menuitem]')).toHaveCount(4);
    });

    test('click Speed mode tile → SpeedMode overlay opens + dock closes', async ({ page }) => {
        await page.click('[aria-label="Open inspector tools"]');
        await page.click('[role=menuitem]:has-text("Speed mode")');
        await expect(page.locator('[role=dialog][aria-label="Speed-rate inspection items"]')).toBeVisible({ timeout: 3_000 });
        await expect(page.locator('[role=menu][aria-label="Inspector tools"]')).toBeHidden();
    });

    test('Esc closes dock', async ({ page }) => {
        await page.click('[aria-label="Open inspector tools"]');
        await expect(page.locator('[role=menu][aria-label="Inspector tools"]')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('[role=menu][aria-label="Inspector tools"]')).toBeHidden({ timeout: 3_000 });
    });

    test('FAB hidden while SpeedMode active; restored on exit', async ({ page }) => {
        await page.keyboard.press('z');
        await expect(page.locator('[role=dialog][aria-label="Speed-rate inspection items"]')).toBeVisible({ timeout: 3_000 });
        await expect(page.locator('[aria-label="Open inspector tools"]')).toBeHidden();
        await page.keyboard.press('Escape');
        await expect(page.locator('[aria-label="Open inspector tools"]')).toBeVisible({ timeout: 3_000 });
    });
});
