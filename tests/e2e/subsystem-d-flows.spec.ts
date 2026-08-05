/**
 * Design System 0520 subsystem D — units, republish, version diff.
 *
 * RUN MODE: `SEED_E2E=1 npx playwright test --project=subsystem-d-flows`.
 * These specs drive the multi-user seed (`tests/seed-fixtures.ts`), which
 * globalSetup only writes when SEED_E2E=1. That harness EXISTS — the "pending
 * the multi-user seed harness" note this file used to carry was stale.
 *
 * Every assertion below was re-pointed at the surface that ships today; the
 * originals were written against the Alpine build and named things the React
 * Router migration moved or renamed. What changed, per test, is recorded on the
 * test itself.
 */
import { test, expect } from '@playwright/test';
import { SEED_EMAILS, SEED_INSPECTIONS } from '../seed-fixtures';
import { loginAsSeedUser, apiPost } from './helpers/seed-login';

test.describe('Subsystem D — units, republish, version diff', () => {

    /**
     * P1+P2 — create a unit, then scope the inspection to it.
     *
     * CHANGED vs the original: the units surface is no longer an Alpine
     * `[title="Add building"]` button answering a `window.prompt`. It is the
     * UnitsManager drawer (app/components/editor/UnitsManager.tsx), opened from
     * the editor header's "Units" button, and scope selection is the
     * BreadcrumbDropdown next to it. Two consequences the old test could not
     * have known:
     *   - the drawer only mounts for a COMMERCIAL inspection
     *     (`showUnitsSurface` === propertyType === 'commercial'), which is why
     *     `seed-empty-inspection` is now seeded commercial;
     *   - the scope switcher only renders in per-unit mode, so the flow has to
     *     flip the mode before a unit is selectable. "selectedUnitId mirrors the
     *     click" — the original's trailing comment, never asserted — is now an
     *     actual assertion on the switcher's label.
     */
    test('P1+P2 — create a unit, switch to per-unit, and scope the inspection to it', async ({ page }) => {
        await loginAsSeedUser(page, SEED_EMAILS.lead);
        await page.goto(`/inspections/${SEED_INSPECTIONS.empty}/edit`);

        // Open the units drawer (title, not label: the drawer heading is also "Units").
        await page.getByTitle('Manage units').click();
        await expect(page.getByRole('dialog')).toBeVisible();

        // Create one.
        await page.getByLabel('New unit name').fill('Building A');
        await page.getByRole('button', { name: 'Add', exact: true }).click();
        await expect(page.getByLabel('Rename Building A')).toBeVisible({ timeout: 15_000 });

        // Findings are shared until the inspection is switched to per-unit; only
        // then is a unit a selectable SCOPE.
        await page.getByRole('button', { name: 'Switch to per-unit' }).click();
        await page.keyboard.press('Escape');

        // The scope switcher starts on the shared Common scope...
        const scopeSwitcher = page.getByRole('button', { name: /^Inspection scope:/ });
        await expect(scopeSwitcher).toHaveAttribute('aria-label', 'Inspection scope: Common. Switch scope', { timeout: 15_000 });

        // ...and the click really moves it (this is the "unit-selected" flow).
        await scopeSwitcher.click();
        await page.getByRole('option', { name: 'Building A' }).click();
        await expect(page.getByRole('button', { name: /^Inspection scope:/ }))
            .toHaveAttribute('aria-label', 'Inspection scope: Building A. Switch scope');
    });

    /**
     * P7+P9 — republishing asks what changed, and the answer lands on the frozen
     * version row.
     *
     * CHANGED vs the original: the republish prompt is NOT in the editor's
     * PublishModal — that modal has no summary field and never had one. It is
     * the inspection hub's PublishReportModal (`/inspections/:id`), which renders
     * `textarea[name=summary]` only when the next publish would be an amendment
     * (`versions.length > 0`, IA-40). The original's `button:has-text("Send All")`
     * never existed in this repo; today's submit is "Publish report".
     *
     * The hub offers Publish only while the report is NOT published, so the flow
     * unpublishes first — that is the real republish path, not a workaround.
     */
    test('P7+P9 — republish prompts for a summary and records it on the new version', async ({ page }) => {
        await loginAsSeedUser(page, SEED_EMAILS.lead);
        const id = SEED_INSPECTIONS.published;

        // Setup, not assertion: one existing version is what makes the NEXT
        // publish an amendment. Driving it through the API keeps the test's
        // subject (the modal) the only UI in play.
        await apiPost(page, `/api/inspections/${id}/publish`, {});

        await page.goto(`/inspections/${id}`);
        await page.getByRole('button', { name: 'Unpublish' }).click();
        // The card action and the modal's submit share the label "Publish
        // report", so the trigger is taken from the page and the submit from
        // inside the dialog rather than by text alone.
        const publishBtn = page.getByRole('button', { name: 'Publish report', exact: true });
        await expect(publishBtn).toBeVisible({ timeout: 15_000 });
        await publishBtn.click();

        // P7 — the amendment prompt.
        const dialog = page.getByRole('dialog');
        const summary = dialog.locator('textarea[name=summary]');
        await expect(summary).toBeVisible();
        await expect(dialog.getByText('What changed in this amendment?')).toBeVisible();
        await summary.fill('Fixed roof recommendation per follow-up');
        await dialog.getByRole('button', { name: 'Publish report', exact: true }).click();

        // P9 — the snapshot exists as its own version, flagged as an amendment,
        // and carries a link to the diff against its predecessor.
        await expect(page.getByText('Report versions')).toBeVisible({ timeout: 20_000 });
        await expect(page.getByText('Version 2', { exact: true })).toBeVisible();
        await expect(page.getByText('Amendment')).toBeVisible();
        await expect(page.getByText('Fixed roof recommendation per follow-up')).toBeVisible();
        await expect(page.locator(`a[href="/version-diff/${id}?n=2&from=1"]`)).toHaveCount(1);
    });

    /**
     * P8 — the diff page renders the changed set, including unit add/remove.
     *
     * CHANGED vs the original: the route is `/version-diff/:id?n=&from=`, not
     * `/inspections/:id/versions/:n/diff` — the latter is the API path and has
     * never been a page. The headings are "Version {n} Changes" and the
     * Field/Before/After table, not "v1 → v2" / "Items changed".
     */
    test('P8 — /version-diff renders the added unit between two published versions', async ({ page }) => {
        await loginAsSeedUser(page, SEED_EMAILS.lead);
        const id = SEED_INSPECTIONS.republished;

        // v1 → add a unit → v2, so the diff has exactly one real change to show.
        await apiPost(page, `/api/inspections/${id}/publish`, {});
        await apiPost(page, `/api/inspections/${id}/units`, {
            name: 'Unit 101', parentUnitId: null, kind: 'unit', type: 'unit',
        });
        await apiPost(page, `/api/inspections/${id}/publish`, { summary: 'Added Unit 101' });

        await page.goto(`/version-diff/${id}?n=2&from=1`);
        await expect(page.getByRole('heading', { name: 'Version 2 Changes' })).toBeVisible();
        await expect(page.getByText('1 change', { exact: false })).toBeVisible();
        await expect(page.getByText('Added', { exact: true })).toBeVisible();
        // Header row proves the table rendered rather than the "no changes" card.
        await expect(page.getByText('Before', { exact: true })).toBeVisible();
        await expect(page.getByText('After', { exact: true })).toBeVisible();
    });
});
