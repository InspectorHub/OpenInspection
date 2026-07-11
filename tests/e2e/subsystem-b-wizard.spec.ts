/**
 * New Inspection wizard — a dedicated full page at /inspections/new (converted
 * from the former modal overlay).
 *
 * Fixture: the `editor-seed` setup project logs in as the api-seeded admin and
 * records its credentials via {@link readEditorSeed}; this spec depends on it
 * (see playwright.config.ts) and reuses those creds. Skips only when the seed
 * is absent. The wizard needs no inspection id — it exercises the create flow's
 * property step, not an existing inspection.
 */
import { test, expect } from '@playwright/test';
import { readEditorSeed } from './helpers/editor-seed';

test.describe('New Inspection wizard page (/inspections/new)', () => {
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
        // stays present (possibly disabled); the create flow itself is covered
        // by unit/api tests.
        await expect(page.getByRole('button', { name: 'Next' })).toBeVisible();
    });
});
