/**
 * Design System 0520 subsystem A phase 3 — SpeedMode E2E (Task 3.6).
 *
 * Fixture: the `editor-seed` setup project seeds an inspection whose template
 * gives it unrated items and records it via {@link readEditorSeed}; this spec
 * depends on it (see playwright.config.ts). Skips only when the seed is absent.
 */
import { test, expect } from '@playwright/test';
import { readEditorSeed } from './helpers/editor-seed';

test.describe('SpeedMode (subsystem A M10)', () => {
    test.beforeEach(async ({ page }) => {
        // Read at RUNTIME, not module scope — the editor-seed dependency writes the
        // handoff during the run, after Playwright evaluates top-level spec code.
        const seed = readEditorSeed();
        test.skip(!seed, 'editor-seed handoff missing — run with the editor-seed setup project.');
        await page.goto('/login');
        await page.fill('input[name=email]',    seed!.email);
        await page.fill('input[name=password]', seed!.password);
        await page.click('button[type=submit]');
        await page.waitForURL('**/inspections');
        await page.goto(`/inspections/${seed!.inspectionId}/edit`);
        // The RR v7 editor shell renders a single <main>; wait for it to hydrate
        // before driving keyboard flows.
        await page.getByRole('main').waitFor({ state: 'visible' });
    });

    test('Z opens overlay; 1 rates first unrated + advances; Z exits', async ({ page }) => {
        await page.keyboard.press('z');
        const dialog = page.locator('[role=dialog][aria-label="Speed-rate inspection items"]');
        await expect(dialog).toBeVisible({ timeout: 5_000 });

        // Capture the queue position counter (rendered "N / M", e.g. "1 / 3");
        // pressing 1 rates the current item and advances, so it must change.
        const counter = dialog.locator('text=/^\\d+ \\/ \\d+$/');
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
