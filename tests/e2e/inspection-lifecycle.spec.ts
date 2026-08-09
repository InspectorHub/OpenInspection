/**
 * Inspection Lifecycle E2E — cancel through the priced door, un-cancel through
 * the row.
 *
 * REWRITTEN FOR #78, and the rewrite is the point of the spec. This test used to
 * cancel by picking "Cancelled" in the dashboard row's status <select>, which
 * PATCHed the status straight onto the inspection — no quote, no fee, no refund,
 * no recorded reason. That door is closed: the API answers 400
 * USE_CANCEL_ENDPOINT and the option is gone from the dropdown, so a spec
 * driving it would now be asserting a bug.
 *
 * The two halves are deliberately asymmetric, because the product is:
 *
 *   CANCEL happens on the inspection hub's Lifecycle card, behind a modal that
 *   prices the cancellation and a confirmation that names the money. It is the
 *   only writer of `status = 'cancelled'`.
 *
 *   UN-CANCEL is still the row dropdown. A mis-click in that confirmation has to
 *   be recoverable, and `POST /:id/uncancel` has no caller in the product — so
 *   picking another status is how a cancelled inspection comes back, and this
 *   spec pins that it still works.
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

        // ── Back on the list: cancelled, and not re-selectable ─────────────
        await page.goto('/inspections');

        // Locate the seeded inspection's row via its unique edit-link href, then
        // walk up to the nearest ancestor row that owns a <select> (the status
        // dropdown). `.first()` because the grouped dashboard view does NOT dedup
        // across buckets — a cancelled inspection can render in more than one
        // bucket, but every copy's select is bound to the same server status.
        const row = page
            .locator(`a[href="/inspections/${seed!.inspectionId}/edit"]`)
            .locator('xpath=ancestor::div[.//select][1]')
            .first();
        await expect(row).toBeVisible();

        const statusSelect = row.locator('select').first();
        await expect(statusSelect).toHaveValue('cancelled');
        // Present so the row tells the truth, disabled so this is not a second
        // way in. Asserted on the live DOM because a disabled <option> is
        // exactly the kind of detail that survives a refactor as an enabled one.
        await expect(statusSelect.locator('option[value="cancelled"]')).toBeDisabled();

        // ── Un-cancel: the mis-click is recoverable ────────────────────────
        await row.hover();
        await statusSelect.selectOption('scheduled');
        await expect(statusSelect).toHaveValue('scheduled');
    });
});
