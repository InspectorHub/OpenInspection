/**
 * Spec 2B — Recommendations Library E2E
 *
 * Requires env vars (or defaults to local dev):
 *   BASE_URL      — e.g. https://your-core.workers.dev   (default: http://127.0.0.1:8788)
 *   TEST_EMAIL    — admin account email                   (default: admin@example.com)
 *   TEST_PASSWORD — admin account password                (default: changeme)
 *
 * Do NOT run against a local wrangler instance without first completing setup
 * (POST /setup) and ensuring the admin credentials above are valid.
 *
 * Coverage:
 *   1. Library CRUD via UI — login → /recommendations → create → edit → delete
 *   2. Aggregation API    — GET /api/inspections/:id/recommendations returns expected shape
 */

import { test, expect, Page } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8788';
const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@example.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'changeme';

/**
 * Log in via the /login page and wait for the dashboard to appear.
 * The login form uses `#email`, `#password`, and `#submitBtn` IDs (see login.tsx).
 */
async function login(page: Page): Promise<void> {
    await page.goto(`${BASE_URL}/login`);
    await page.fill('#email', TEST_EMAIL);
    await page.fill('#password', TEST_PASSWORD);
    await page.click('#submitBtn');
    await page.waitForURL(/\/(dashboard|agent-dashboard)/, { timeout: 15000 });
}

test.describe('Spec 2B — Recommendations Library', () => {

    // ── Test 1: Library CRUD via UI ───────────────────────────────────────────

    test('library page lists, creates, edits, and deletes a recommendation', async ({ page }) => {
        await login(page);
        await page.goto(`${BASE_URL}/recommendations`);

        // Verify page heading (h1 text from recommendations.tsx)
        await expect(page.locator('h1')).toContainText('Recommendations Library', { timeout: 10000 });

        // If the library is empty, seed defaults so subsequent selectors have something to work with
        // The seed button is only visible when items.length === 0 (x-show="items.length === 0")
        const seedBtn = page.locator('button:has-text("Seed defaults")');
        if (await seedBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await seedBtn.click();
            // Wait for the Alpine reload() call to complete (network + DOM update)
            await page.waitForTimeout(3000);
        }

        // ── Create ────────────────────────────────────────────────────────────
        // Click the "+ Add recommendation" button (always visible regardless of item count)
        await page.click('button:has-text("+ Add recommendation")');

        // The modal should now be open (x-show="modalOpen")
        const modal = page.locator('.fixed.inset-0.z-50');
        await expect(modal).toBeVisible({ timeout: 5000 });

        // Category field — <input placeholder="e.g., Roof"> (recommendations.tsx line 74)
        await page.fill('input[placeholder="e.g., Roof"]', 'E2E Test Category');

        // Name field — <input placeholder="e.g., Active roof leak"> (recommendations.tsx line 86)
        await page.fill('input[placeholder="e.g., Active roof leak"]', 'E2E Test Recommendation');

        // Severity select — single <select> in the modal, choose "monitor"
        // The select has x-model="form.severity"; it's the only <select> inside the modal
        await modal.locator('select').selectOption('monitor');

        // Repair summary textarea
        await modal.locator('textarea').fill('E2E test repair summary — recommend evaluation by licensed contractor.');

        // Click Save button inside the modal
        await modal.locator('button:has-text("Save")').click();

        // Modal should close and the new item should appear in the grid
        await expect(modal).not.toBeVisible({ timeout: 5000 });
        await expect(page.locator('p.font-bold:has-text("E2E Test Recommendation")').first()).toBeVisible({ timeout: 8000 });

        // ── Edit ──────────────────────────────────────────────────────────────
        // Each card is a .rounded-2xl div. Find the one containing our item and click its Edit button.
        // The card structure is: div.rounded-2xl > div.flex > div.flex-1 (name) + div.flex-col (buttons)
        const card = page.locator('div.rounded-2xl').filter({
            has: page.locator('p.font-bold:has-text("E2E Test Recommendation")'),
        }).first();
        await card.locator('button:has-text("Edit")').click();

        // Modal should reopen in edit mode (h2 says "Edit recommendation")
        await expect(modal).toBeVisible({ timeout: 5000 });
        await expect(modal.locator('h2')).toContainText('Edit recommendation');

        // Clear and retype the name field
        const nameInput = modal.locator('input[placeholder="e.g., Active roof leak"]');
        await nameInput.clear();
        await nameInput.fill('E2E Test Recommendation (edited)');

        await modal.locator('button:has-text("Save")').click();
        await expect(modal).not.toBeVisible({ timeout: 5000 });
        await expect(page.locator('p.font-bold:has-text("E2E Test Recommendation (edited)")').first()).toBeVisible({ timeout: 8000 });

        // ── Delete ────────────────────────────────────────────────────────────
        // confirmDelete() calls window.confirm() — accept the browser dialog automatically
        page.once('dialog', d => d.accept());

        const editedCard = page.locator('div.rounded-2xl').filter({
            has: page.locator('p.font-bold:has-text("E2E Test Recommendation (edited)")'),
        }).first();
        await editedCard.locator('button:has-text("Delete")').click();

        // After deletion Alpine calls reload(); the item must vanish
        await expect(page.locator('p.font-bold:has-text("E2E Test Recommendation (edited)")')).toHaveCount(0, { timeout: 8000 });
    });

    // ── Test 2: Aggregation API endpoint ─────────────────────────────────────

    test('aggregation endpoint returns flat item list with totals', async ({ request, page }) => {
        // Login via UI to acquire the HttpOnly auth cookie in this browser context
        await login(page);

        // Extract cookies from the browser context for use with the API request fixture
        const cookies = await page.context().cookies();
        const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

        // Find any inspection ID by navigating to the dashboard and reading a link
        await page.goto(`${BASE_URL}/dashboard`);

        const firstInspectionLink = page.locator('a[href*="/inspections/"]').first();
        if (await firstInspectionLink.count() === 0) {
            test.skip(true, 'No inspections found on dashboard — aggregation test skipped (needs at least 1 inspection)');
            return;
        }

        const href = await firstInspectionLink.getAttribute('href');
        const inspectionId = href?.match(/\/inspections\/([^/?#]+)/)?.[1];
        expect(inspectionId, 'Could not parse inspectionId from href').toBeTruthy();

        // Call the aggregation route
        const res = await request.get(`${BASE_URL}/api/inspections/${inspectionId}/recommendations`, {
            headers: { cookie: cookieHeader },
        });

        expect(res.ok(), `Expected 200, got ${res.status()}`).toBeTruthy();

        const body = await res.json();

        // Top-level shape matches AggregatedRecommendationsResponseSchema (recommendation.schema.ts)
        expect(body.success).toBe(true);
        expect(body.data).toHaveProperty('items');
        expect(body.data).toHaveProperty('totals');
        expect(Array.isArray(body.data.items)).toBe(true);

        // Totals shape
        const { totals } = body.data;
        expect(totals).toHaveProperty('count');
        expect(totals).toHaveProperty('estimateMinSum');
        expect(totals).toHaveProperty('estimateMaxSum');
        expect(typeof totals.count).toBe('number');
        expect(typeof totals.estimateMinSum).toBe('number');
        expect(typeof totals.estimateMaxSum).toBe('number');
    });
});
