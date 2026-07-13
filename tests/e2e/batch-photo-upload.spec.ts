/**
 * Phase 3 Task 16 — batch photo upload e2e smoke.
 *
 * Verifies the library input (added alongside the pre-existing single-shot
 * camera input) lets an inspector select MANY photos in one go and have all
 * of them attach to the correct item, instead of the old one-at-a-time flow.
 *
 * The hidden `<input type="file" multiple>` (app/routes/inspection-edit.tsx,
 * `libraryInputRef`) is targeted directly via `input[type="file"][multiple]`
 * — it uniquely distinguishes the library input from the single-shot camera
 * input (`capture="environment"`, no `multiple`). Driving the real
 * AddMediaChooser → "Add from library" click chain first would exercise a
 * couple more lines of UI wiring, but `setInputFiles` on the underlying
 * input already exercises the code this task actually changed
 * (handlePhotoUpload's batch rewrite) without depending on the OS-level file
 * picker, which Playwright cannot drive directly anyway.
 *
 * Partial-failure path: NOT exercised here. The upload round trip is
 * server-side (the route action fans out to the BFF's upload endpoint from
 * the Worker, not from the browser), so there is no client-visible network
 * call for Playwright's `page.route()` to intercept and fail selectively.
 * Forcing a partial failure would need a test-only fault-injection hook in
 * the action (e.g. an env-gated "fail file N" switch) that does not exist
 * today and is out of scope for this task — see
 * app/routes/inspection-edit/action.server.ts's `upload-photo` intent and
 * the `results[]`-driven toast in inspection-edit.tsx for the code path this
 * would exercise if such a hook is added later.
 *
 * Needs the `editor-seed` setup project's handoff (a fresh inspection with a
 * Roof/Plumbing/Electrical item list, seeded via the API) — see
 * tests/e2e/helpers/editor-seed.ts. Skips itself when that handoff is
 * missing, same as inspection-edit-hotkeys.spec.ts.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from '@playwright/test';
import { readEditorSeed } from './helpers/editor-seed';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_IMAGE = path.join(__dirname, '..', 'assets', 'test-logo.png');

test.describe('Batch photo upload (Task 16)', () => {
    test.beforeEach(async ({ page }) => {
        const seed = readEditorSeed();
        test.skip(!seed, 'editor-seed handoff missing — run with the editor-seed setup project.');
        await page.goto('/login');
        await page.fill('input[name=email]',    seed!.email);
        await page.fill('input[name=password]', seed!.password);
        await page.click('button[type=submit]');
        await page.waitForURL('**/inspections');
        await page.goto(`/inspections/${seed!.inspectionId}/edit`);
        await page.getByRole('main').waitFor({ state: 'visible' });
    });

    test('selecting 3 files via the library input attaches 3 thumbnails to the active item', async ({ page }) => {
        await page.getByRole('button', { name: /Roof/ }).first().click();
        await page.getByRole('heading', { name: 'Roof' }).waitFor({ state: 'visible' });

        // The library input is `multiple` and lacks `capture` — the camera
        // input (single-shot, capture="environment") never matches this
        // selector. setInputFiles fires the same `change` event a real
        // multi-select would, driving handlePhotoUpload's batch path.
        const libraryInput = page.locator('input[type="file"][multiple]');
        await expect(libraryInput).toBeAttached();
        await libraryInput.setInputFiles([FIXTURE_IMAGE, FIXTURE_IMAGE, FIXTURE_IMAGE]);

        // All 3 uploads (bounded CONCURRENCY=4 server-side) round-trip through
        // the upload-photo action before the effect attaches keys — give the
        // thumbnail strip room to catch up.
        await expect(page.getByTestId('thumb-0')).toBeVisible({ timeout: 15000 });
        await expect(page.getByTestId('thumb-1')).toBeVisible({ timeout: 15000 });
        await expect(page.getByTestId('thumb-2')).toBeVisible({ timeout: 15000 });
        await expect(page.getByTestId('thumb-3')).toHaveCount(0);

        // "3 photos added" success toast (Task 16's all-succeeded branch).
        await expect(page.getByText('3 photos added', { exact: false })).toBeVisible();

        // Right-item association: switching to Plumbing must show zero photos
        // — the batch attached to Roof only, not every item.
        await page.getByRole('button', { name: /Plumbing/ }).first().click();
        await page.getByRole('heading', { name: 'Plumbing' }).waitFor({ state: 'visible' });
        await expect(page.getByTestId('thumb-0')).toHaveCount(0);
    });

    test('re-selecting after a batch resets the input (same files fire onChange again)', async ({ page }) => {
        await page.getByRole('button', { name: /Roof/ }).first().click();
        await page.getByRole('heading', { name: 'Roof' }).waitFor({ state: 'visible' });

        const libraryInput = page.locator('input[type="file"][multiple]');
        await libraryInput.setInputFiles([FIXTURE_IMAGE]);
        await expect(page.getByTestId('thumb-0')).toBeVisible({ timeout: 15000 });

        // Re-selecting the SAME file must re-fire onChange (handlePhotoUpload
        // resets both input refs' .value at the end of every run) and attach a
        // second photo rather than silently no-op.
        await libraryInput.setInputFiles([FIXTURE_IMAGE]);
        await expect(page.getByTestId('thumb-1')).toBeVisible({ timeout: 15000 });
    });
});
