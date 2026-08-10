/**
 * Inspection Lifecycle E2E — cancel and recover, both through their own door.
 *
 * REWRITTEN FOR #78, THEN AGAIN FOR #81, and each rewrite is the point of the
 * spec. It first cancelled by picking "Cancelled" in the dashboard row's status
 * <select>, which PATCHed the status straight on — no quote, no fee, no refund,
 * no recorded reason. Then it recovered through the same <select>, which was
 * the product's only way back and did less than the endpoint built for the job.
 *
 * Both doors are closed now and the API answers 400 for either direction, so a
 * spec driving that dropdown would be asserting a bug. The flow is symmetric:
 *
 *   CANCEL happens on the inspection hub's Lifecycle card, behind a modal that
 *   prices the cancellation and a confirmation that names the money.
 *   `POST /:id/cancel` is the only writer of `status = 'cancelled'`.
 *
 *   RECOVER happens on the SAME card, in its cancelled state, behind a
 *   confirmation that says the inspection goes back to scheduled and that the
 *   money already moved. `POST /:id/uncancel` is the only way out of
 *   `cancelled`. This is the half that had no discoverable door at all: the
 *   mis-click happened here and the only remedy was on another page.
 *
 * Fixture: the `editor-seed` setup project seeds one editable inspection and
 * records it via {@link readEditorSeed}; this spec depends on it (see
 * playwright.config.ts) and skips only when the seed is absent.
 */
import { test, expect } from '@playwright/test';
import { readEditorSeed } from './helpers/editor-seed';

test.describe('Inspection lifecycle — cancel / uncancel', () => {
    test('cancels via the priced Lifecycle modal, then un-cancels from the row', async ({ page }) => {
        // Read at RUNTIME — the editor-seed dependency writes the handoff during
        // the run, after Playwright evaluates top-level spec code.
        const seed = readEditorSeed();
        test.skip(!seed, 'editor-seed handoff missing — run with the editor-seed setup project.');

        await page.goto('/login');
        await page.fill('input[name=email]', seed!.email);
        await page.fill('input[name=password]', seed!.password);
        await page.click('button[type=submit]');
        await page.waitForURL('**/inspections');

        // ── Cancel, on the hub, with the figures on screen ─────────────────
        await page.goto(`/inspections/${seed!.inspectionId}`);
        await page.getByRole('button', { name: 'Cancel inspection' }).click();

        // The confirm stays unreachable until the quote lands — that is the
        // whole feature, so waiting for the figures is not incidental setup.
        // The seed tenant configures no cancellation policy, so the priced
        // outcome is a free cancellation; the ladder's arithmetic is covered by
        // the unit specs, and what matters here is that a human saw a number.
        const quote = page.getByTestId('cancellation-quote');
        await expect(quote).toContainText('Fee your company keeps');

        const continueBtn = page.getByRole('button', { name: 'Continue' });
        await expect(continueBtn).toBeEnabled();
        await continueBtn.click();

        // Step two names what happens to the money and then does it.
        await expect(page.getByText('Cancel this inspection?')).toBeVisible();
        await page.getByRole('button', { name: 'Cancel the inspection' }).click();

        // The card flips to its terminal state once the hub revalidates.
        await expect(
            page.getByText('This inspection was cancelled. Nothing further is scheduled for it.'),
        ).toBeVisible();

        // ── Back on the list: cancelled, and nothing to pick ───────────────
        await page.goto('/inspections');

        // Locate the seeded inspection's row via its unique edit-link href, then
        // walk up to the nearest ancestor row that owns a <select> (the status
        // control). `.first()` because the grouped dashboard view does NOT dedup
        // across buckets — a cancelled inspection can render in more than one
        // bucket, but every copy's select is bound to the same server status.
        const row = page
            .locator(`a[href="/inspections/${seed!.inspectionId}/edit"]`)
            .locator('xpath=ancestor::div[.//select][1]')
            .first();
        await expect(row).toBeVisible();

        const statusSelect = row.locator('select').first();
        // It says the truth and offers nothing: every target status is a write
        // the API now refuses. Asserted on the live DOM because "disabled" is
        // exactly the kind of detail that survives a refactor as "enabled".
        await expect(statusSelect).toHaveValue('cancelled');
        await expect(statusSelect).toBeDisabled();

        // ── Recover, on the hub, where the mis-click happened ──────────────
        await page.goto(`/inspections/${seed!.inspectionId}`);
        await expect(
            page.getByText('This inspection was cancelled. Nothing further is scheduled for it.'),
        ).toBeVisible();

        await page.getByRole('button', { name: 'Restore to scheduled' }).click();

        // The confirmation names what changes and what does not. The second
        // half is the one that must not quietly disappear: restoring is not an
        // undo, and the fee and refund are already in the ledger.
        const dialog = page.getByRole('dialog');
        await expect(dialog).toContainText('returns to Scheduled');
        await expect(dialog).toContainText('does not reverse them');
        await dialog.getByRole('button', { name: 'Restore to scheduled' }).click();

        // The card leaves its terminal state; the lifecycle pill reads Scheduled.
        await expect(page.getByRole('button', { name: 'Mark fieldwork complete' })).toBeVisible();
    });
});
