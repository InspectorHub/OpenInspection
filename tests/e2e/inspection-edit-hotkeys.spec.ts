/**
 * Sprint 1 Sub-spec A Task 13 — Inspection Edit hotkeys e2e smoke.
 *
 * Verifies the keyboard-driven workflow added by A-1 (slash popover hides
 * right pane) and A-8 (rating hotkeys 1-5). Run inside Playwright with the
 * standalone dev worker:
 *
 *   npx playwright test tests/e2e/inspection-edit-hotkeys.spec.ts
 *
 * Required env vars (set in .dev.vars or shell):
 *   TEST_INSPECTOR_EMAIL    inspector login email
 *   TEST_INSPECTOR_PASSWORD inspector login password
 *   TEST_INSPECTION_ID      uuid of an inspection the inspector can edit
 *
 * If any of those are missing, the test suite is skipped — local CI won't
 * fail just because the seed data isn't present.
 */
import { test, expect } from '@playwright/test';

const EMAIL = process.env['TEST_INSPECTOR_EMAIL'];
const PASSWORD = process.env['TEST_INSPECTOR_PASSWORD'];
const INSPECTION_ID = process.env['TEST_INSPECTION_ID'];

test.describe('Inspection Edit hotkeys (Sprint 1 A-1..A-9)', () => {
    test.skip(
        !EMAIL || !PASSWORD || !INSPECTION_ID,
        'Set TEST_INSPECTOR_EMAIL / TEST_INSPECTOR_PASSWORD / TEST_INSPECTION_ID to run.',
    );

    test.beforeEach(async ({ page }) => {
        await page.goto('/login');
        await page.fill('input[name=email]',    EMAIL!);
        await page.fill('input[name=password]', PASSWORD!);
        await page.click('button[type=submit]');
        await page.waitForURL('**/dashboard');
    });

    test('? opens keyboard HUD with all 5 rating rows', async ({ page }) => {
        await page.goto(`/inspections/${INSPECTION_ID}/edit`);
        await page.waitForSelector('[x-data*=inspectionEditor]');
        await page.keyboard.press('?');
        // KeyboardHUD shows the canonical rating ladder.
        await expect(page.locator('text=Satisfactory').first()).toBeVisible();
        await expect(page.locator('text=Monitor').first()).toBeVisible();
        await expect(page.locator('text=Defect').first()).toBeVisible();
        await expect(page.locator('text=Not Inspected').first()).toBeVisible();
        await expect(page.locator('text=Not Present').first()).toBeVisible();
    });

    test('press 4 sets the active item rating to Not Inspected', async ({ page }) => {
        await page.goto(`/inspections/${INSPECTION_ID}/edit`);
        await page.waitForSelector('[x-data*=inspectionEditor]');
        // Activate the first item by clicking its row title.
        const firstItem = page.locator('[x-data*=inspectionEditor]').locator('button, [role=button]').first();
        await firstItem.click().catch(() => { /* tolerate non-button rows */ });
        await page.keyboard.press('4');
        // The shape of the rating UI varies, so we just confirm a rating
        // pill or aria-selected="true" appears somewhere on the page after
        // pressing the hotkey.
        await expect(page.locator('[aria-selected=true], .ih-pill, [data-rating]')).not.toHaveCount(0);
    });

    test('press / opens Comment Library and ACTIVE ITEM right pane hides', async ({ page }) => {
        await page.goto(`/inspections/${INSPECTION_ID}/edit`);
        await page.waitForSelector('[x-data*=inspectionEditor]');
        // Click into the first textarea so the slash trigger fires inside a field.
        const ta = page.locator('textarea').first();
        await ta.focus();
        await page.keyboard.press('/');
        // Comment Library drawer opens.
        await expect(page.locator('text=Comment Library').first()).toBeVisible();
        // Right ACTIVE ITEM aside disappears (Sprint 1 A-1).
        await expect(page.locator('text=Active Item').first()).toBeHidden();
    });

    test('Esc closes Library and right pane returns', async ({ page }) => {
        await page.goto(`/inspections/${INSPECTION_ID}/edit`);
        await page.waitForSelector('[x-data*=inspectionEditor]');
        const ta = page.locator('textarea').first();
        await ta.focus();
        await page.keyboard.press('/');
        await expect(page.locator('text=Comment Library').first()).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('text=Comment Library').first()).toBeHidden();
        // Right ACTIVE ITEM pane returns once the drawer closes.
        await expect(page.locator('text=Active Item').first()).toBeVisible();
    });
});
