/**
 * Design System 0520 subsystem A phase 5 — InspectorTools FAB dock E2E
 * (Task 5.5).
 *
 * Fixture: the `editor-seed` setup project creates an editable inspection with
 * items and records it via {@link readEditorSeed}; this spec depends on it (see
 * playwright.config.ts), so the handoff is present. Skips only when the seed is
 * absent (e.g. the setup project was not selected).
 */
import { test, expect } from '@playwright/test';
import { readEditorSeed } from './helpers/editor-seed';

test.describe('InspectorTools FAB dock (subsystem A M15)', () => {
    test.beforeEach(async ({ page }) => {
        // Read at RUNTIME, not module scope: the editor-seed dependency writes the
        // handoff while the suite is executing, but Playwright evaluates top-level
        // spec code at collection time (before any project runs), so a module-level
        // read would always see it missing and skip.
        const seed = readEditorSeed();
        test.skip(!seed, 'editor-seed handoff missing — run with the editor-seed setup project.');
        await page.goto('/login');
        await page.fill('input[name=email]',    seed!.email);
        await page.fill('input[name=password]', seed!.password);
        await page.click('button[type=submit]');
        await page.waitForURL('**/inspections');
        await page.goto(`/inspections/${seed!.inspectionId}/edit`);
        // The RR v7 editor shell renders a single <main>; wait for it to hydrate
        // before driving keyboard/pointer flows.
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
