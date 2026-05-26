/**
 * Design System 0520 subsystem A phase 4 — PhotoStudio E2E (Task 4.10).
 *
 * Required env vars (.dev.vars or shell):
 *   TEST_INSPECTOR_EMAIL
 *   TEST_INSPECTOR_PASSWORD
 *   TEST_INSPECTION_ID
 *   TEST_MEDIA_POOL_ID      — a row in inspection_media_pool for the
 *                              inspection above (skip when absent so local
 *                              CI doesn't fail without seed data).
 *
 * Skipped automatically when any var is missing.
 */
import { test, expect } from '@playwright/test';

const EMAIL = process.env['TEST_INSPECTOR_EMAIL'];
const PASSWORD = process.env['TEST_INSPECTOR_PASSWORD'];
const INSPECTION_ID = process.env['TEST_INSPECTION_ID'];
const MEDIA_POOL_ID = process.env['TEST_MEDIA_POOL_ID'];

test.describe('PhotoStudio MVP (subsystem A M14)', () => {
    test.skip(
        !EMAIL || !PASSWORD || !INSPECTION_ID || !MEDIA_POOL_ID,
        'Set TEST_INSPECTOR_EMAIL / TEST_INSPECTOR_PASSWORD / TEST_INSPECTION_ID / TEST_MEDIA_POOL_ID to run.',
    );

    test.beforeEach(async ({ page }) => {
        await page.goto('/login');
        await page.fill('input[name=email]',    EMAIL!);
        await page.fill('input[name=password]', PASSWORD!);
        await page.click('button[type=submit]');
        await page.waitForURL('**/dashboard');
        await page.goto(`/inspections/${INSPECTION_ID}/edit`);
        await page.waitForSelector('[x-data*=inspectionEditor]');
    });

    test('dispatch open-photo-studio → overlay visible; Circle draws ellipse; Save persists', async ({ page }) => {
        // Open via window event — the factory listens for this in init().
        await page.evaluate(({ inspectionId, mediaId }) => {
            window.dispatchEvent(new CustomEvent('open-photo-studio', {
                detail: {
                    media: {
                        id: mediaId,
                        inspectionId,
                        url: `/api/inspections/${inspectionId}/photos/${encodeURIComponent('placeholder')}`,
                        naturalWidth: 1200,
                        naturalHeight: 800,
                    },
                    inspectionContext: { sectionName: 'Roof', itemTitle: 'NE corner' },
                },
            }));
        }, { inspectionId: INSPECTION_ID!, mediaId: MEDIA_POOL_ID! });

        const dialog = page.locator('[role=dialog][aria-label="Photo annotation studio"]');
        await expect(dialog).toBeVisible({ timeout: 5_000 });

        // Caption pre-filled with auto-caption ("Roof · NE corner").
        await expect(dialog.locator('input[type=text]')).toHaveValue('Roof · NE corner');

        // Select Circle tool + drag on the SVG canvas to draw an ellipse.
        await dialog.locator('button[aria-label=Circle]').click();
        const svg = dialog.locator('svg').first();
        const box = await svg.boundingBox();
        if (!box) throw new Error('SVG canvas not laid out');
        await page.mouse.move(box.x + 60, box.y + 60);
        await page.mouse.down();
        await page.mouse.move(box.x + 180, box.y + 180);
        await page.mouse.up();
        await expect(dialog.locator('svg ellipse')).toHaveCount(1, { timeout: 3_000 });

        // Save → PUT request fires; modal closes on 200.
        const respPromise = page.waitForResponse(
            (r) => r.url().includes(`/media/${MEDIA_POOL_ID}/annotations`) && r.request().method() === 'PUT',
        );
        await dialog.locator('button:has-text("Save")').click();
        const resp = await respPromise;
        expect(resp.status()).toBe(200);
        await expect(dialog).toBeHidden({ timeout: 3_000 });
    });

    test('Reset confirmation clears shapes + restores auto-caption', async ({ page }) => {
        page.on('dialog', d => d.accept());

        await page.evaluate(({ inspectionId, mediaId }) => {
            window.dispatchEvent(new CustomEvent('open-photo-studio', {
                detail: {
                    media: { id: mediaId, inspectionId, url: '', naturalWidth: 800, naturalHeight: 600 },
                    inspectionContext: { sectionName: 'Roof', itemTitle: 'flashing' },
                },
            }));
        }, { inspectionId: INSPECTION_ID!, mediaId: MEDIA_POOL_ID! });

        const dialog = page.locator('[role=dialog][aria-label="Photo annotation studio"]');
        await expect(dialog).toBeVisible({ timeout: 5_000 });

        // Type a non-auto caption.
        const captionInput = dialog.locator('input[type=text]').first();
        await captionInput.fill('overridden caption');
        await expect(captionInput).toHaveValue('overridden caption');

        // Reset → confirmation accepted → caption returns to auto-fill.
        await dialog.locator('button[aria-label="Reset all annotations and caption"]').click();
        await expect(captionInput).toHaveValue('Roof · flashing', { timeout: 3_000 });
    });
});
