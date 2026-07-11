/**
 * Inspection Lifecycle E2E — cancel + uncancel via the dashboard row.
 *
 * Rewritten for the current RR v7 dashboard (the pre-RR action-menu + cancel
 * reason modal + dedicated "Uncancel" control no longer exist). Today the
 * lifecycle is driven by the per-row status <select> in DashboardInspectionRow:
 * picking "Cancelled" fires transitionStatus() → PATCH /api/inspections/:id
 * {status}, RR revalidates the dashboard loader, and the inspection re-buckets
 * into the "Cancelled" group. Reversing the status un-cancels it — no separate
 * endpoint. This exercises that full PATCH → revalidate → re-render loop.
 *
 * Fixture: the `editor-seed` setup project seeds one editable inspection and
 * records it via {@link readEditorSeed}; this spec depends on it (see
 * playwright.config.ts) and skips only when the seed is absent.
 */
import { test, expect } from '@playwright/test';
import { readEditorSeed } from './helpers/editor-seed';

test.describe('Inspection lifecycle — cancel / uncancel', () => {
    test('row status select cancels then un-cancels the seeded inspection', async ({ page }) => {
        // Read at RUNTIME — the editor-seed dependency writes the handoff during
        // the run, after Playwright evaluates top-level spec code.
        const seed = readEditorSeed();
        test.skip(!seed, 'editor-seed handoff missing — run with the editor-seed setup project.');

        await page.goto('/login');
        await page.fill('input[name=email]', seed!.email);
        await page.fill('input[name=password]', seed!.password);
        await page.click('button[type=submit]');
        await page.waitForURL('**/inspections');

        // Locate the seeded inspection's row via its unique edit-link href, then
        // walk up to the nearest ancestor row that owns a <select> (the status
        // dropdown). `.first()` because the grouped dashboard view does NOT dedup
        // across buckets — a cancelled inspection can render in more than one
        // bucket, but every copy's select is bound to the same server status, so
        // driving/asserting one is representative. Re-querying finds the row
        // wherever it re-buckets after each status change.
        const row = page
            .locator(`a[href="/inspections/${seed!.inspectionId}/edit"]`)
            .locator('xpath=ancestor::div[.//select][1]')
            .first();
        await expect(row).toBeVisible();

        const statusSelect = row.locator('select').first();
        // Sanity: it starts in a non-cancelled state (fresh inspections are
        // requested/scheduled, never cancelled).
        await expect(statusSelect).not.toHaveValue('cancelled');

        // ── Cancel ────────────────────────────────────────────────────────
        await row.hover();
        await statusSelect.selectOption('cancelled');
        // PATCH + loader revalidation land the row in the Cancelled bucket with
        // its status select bound to the new value.
        await expect(statusSelect).toHaveValue('cancelled');
        // The Cancelled bucket header is now present (grouped view, "all" tab).
        await expect(
            page.getByText('Cancelled inspections', { exact: true }),
        ).toBeVisible();

        // ── Un-cancel ─────────────────────────────────────────────────────
        await row.hover();
        await statusSelect.selectOption('scheduled');
        await expect(statusSelect).toHaveValue('scheduled');
    });
});
