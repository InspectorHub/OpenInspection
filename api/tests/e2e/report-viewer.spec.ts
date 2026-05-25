/**
 * Sprint 1 Sub-spec D Task 8 — Report viewer e2e smoke.
 *
 * Verifies the new viewer chrome (sidebar + tabs + share/PDF dropdowns +
 * status pill) and the Sub-spec D filter behaviors (empty-item collapse,
 * safety-only view, no stray glyphs).
 *
 * Requires the wrangler dev server (via `npm run dev`) plus seeded
 * inspection + share token. Set `TEST_INSPECTION_ID` and
 * `TEST_SHARE_TOKEN` env vars before running:
 *
 *   TEST_INSPECTION_ID=... TEST_SHARE_TOKEN=... \
 *     npx playwright test tests/e2e/report-viewer.spec.ts
 *
 * The default playwright config does not match this file via a project, so
 * pass the path explicitly. The tests skip themselves when env vars are
 * missing so CI can still load the file without failure.
 */
import { test, expect } from '@playwright/test';

const INSPECTION_ID = process.env.TEST_INSPECTION_ID || '';
const SHARE_TOKEN   = process.env.TEST_SHARE_TOKEN   || '';

test.describe('Report viewer (Sprint 1 Sub-spec D)', () => {
    test.skip(!INSPECTION_ID || !SHARE_TOKEN, 'Set TEST_INSPECTION_ID and TEST_SHARE_TOKEN to run.');

    test.beforeEach(async ({ page }) => {
        await page.goto(`/api/inspections/${INSPECTION_ID}/report?view=agent&token=${SHARE_TOKEN}`);
    });

    test('left sidebar visible at desktop breakpoint', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await expect(page.locator('aside[aria-label="Report navigation"]')).toBeVisible();
        await expect(page.locator('aside nav a').first()).toBeVisible();
    });

    test('top tab bar exposes Full / Summary / Safety Hazard', async ({ page }) => {
        await expect(page.getByRole('tab', { name: 'Full Report' })).toBeVisible();
        await expect(page.getByRole('tab', { name: /Summary/ })).toBeVisible();
        await expect(page.getByRole('tab', { name: /Safety Hazard/ })).toBeVisible();
    });

    test('Summary tab hides items that have no defects', async ({ page }) => {
        await page.getByRole('tab', { name: /Summary/ }).click();
        await expect(page.locator('text=No notes recorded.')).toHaveCount(0);
    });

    test('Safety Hazard tab keeps only items flagged as safety', async ({ page }) => {
        await page.getByRole('tab', { name: /Safety Hazard/ }).click();
        const items = page.locator('article.report-item, .report-item');
        const count = await items.count();
        for (let i = 0; i < count; i++) {
            await expect(items.nth(i)).toHaveAttribute('data-defect-safety', '1');
        }
    });

    test('Share dropdown opens with three menu items', async ({ page }) => {
        await page.getByRole('button', { name: 'Share' }).click();
        await expect(page.getByRole('menuitem', { name: 'Copy link' })).toBeVisible();
        await expect(page.getByRole('menuitem', { name: 'Email link' })).toBeVisible();
        await expect(page.getByRole('menuitem', { name: 'Share with your agent' })).toBeVisible();
    });

    test('PDF dropdown opens with three print options', async ({ page }) => {
        await page.getByRole('button', { name: 'PDF' }).click();
        await expect(page.getByRole('menuitem', { name: /Print Full Report/ })).toBeVisible();
        await expect(page.getByRole('menuitem', { name: /Print Summary/ })).toBeVisible();
        await expect(page.getByRole('menuitem', { name: /Print Safety Hazards/ })).toBeVisible();
    });

    test('Status pill displays the report status', async ({ page }) => {
        const pill = page.locator('[aria-label^="Report status:"]').first();
        await expect(pill).toBeVisible();
    });

    test('Mobile (375 px): sidebar hidden and no horizontal scroll', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        await expect(page.locator('aside[aria-label="Report navigation"]')).toBeHidden();
        const hasHScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
        expect(hasHScroll).toBe(false);
    });

    test('No bare "/" character renders inside section headers', async ({ page }) => {
        const stray = await page.locator('section.report-section >> text=/^\\s*\\/\\s*$/').count();
        expect(stray).toBe(0);
    });
});
