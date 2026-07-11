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
import { readEditorSeed } from './helpers/editor-seed';

test.describe('Inspection Edit hotkeys (Sprint 1 A-1..A-9)', () => {
    test.beforeEach(async ({ page }) => {
        // Read at RUNTIME — the editor-seed dependency writes the handoff during
        // the run, after Playwright evaluates top-level spec code.
        const seed = readEditorSeed();
        test.skip(!seed, 'editor-seed handoff missing — run with the editor-seed setup project.');
        await page.goto('/login');
        await page.fill('input[name=email]',    seed!.email);
        await page.fill('input[name=password]', seed!.password);
        await page.click('button[type=submit]');
        await page.waitForURL('**/inspections');
        await page.goto(`/inspections/${seed!.inspectionId}/edit`);
        // The RR v7 editor shell renders a single <main>; wait for it to hydrate.
        await page.getByRole('main').waitFor({ state: 'visible' });
    });

    test('? opens keyboard HUD with all 5 rating rows', async ({ page }) => {
        await page.keyboard.press('?');
        // KeyboardHud (role=dialog, aria-label="Keyboard shortcuts") lists the
        // canonical 5-level ladder; scope to the HUD so the item editor's own
        // rating buttons can't satisfy the assertion.
        const hud = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
        await expect(hud).toBeVisible();
        for (const label of ['Satisfactory', 'Monitor', 'Defect', 'Not Inspected', 'Not Present']) {
            await expect(hud.getByText(label, { exact: true })).toBeVisible();
        }
    });

    test('press 4 sets the active item rating to Not Inspected', async ({ page }) => {
        // Select an item so the rating hotkeys act on a live finding.
        await page.getByRole('button', { name: /Roof/ }).first().click();
        await page.getByRole('heading', { name: 'Roof' }).waitFor({ state: 'visible' });
        await page.keyboard.press('4');
        // Rating hotkey 4 = "Not Inspected": its rating button becomes pressed.
        await expect(page.getByRole('button', { name: /Not Inspected/ })).toHaveAttribute('aria-pressed', 'true');
    });

    test('press / opens the Comment Library drawer', async ({ page }) => {
        // The rich item's Notes textarea is the slash trigger surface.
        await page.getByRole('button', { name: /Roof/ }).first().click();
        const ta = page.locator('textarea').first();
        await ta.focus();
        await page.keyboard.press('/');
        // CommentLibraryDrawer renders as a titled dialog (was the Alpine right
        // aside in the pre-RR editor; the "Active Item" pane label no longer
        // exists, so this now asserts only the drawer surface).
        await expect(page.getByRole('dialog', { name: 'Comment Library' })).toBeVisible();
    });

    test('Esc closes the Comment Library drawer', async ({ page }) => {
        await page.getByRole('button', { name: /Roof/ }).first().click();
        const ta = page.locator('textarea').first();
        await ta.focus();
        await page.keyboard.press('/');
        const library = page.getByRole('dialog', { name: 'Comment Library' });
        await expect(library).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(library).toBeHidden();
    });
});
