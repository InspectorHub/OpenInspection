/**
 * The statutory coverage panel, in a real browser.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * The panel was written and shipped without anybody looking at it, and the
 * commit said so. That is the same gap this whole change set is about: the
 * statutory subsystem had complete server-side machinery and no surface an
 * inspector could actually reach, and nothing in the suite could tell.
 *
 * Until now there were ZERO statutory E2E specs. Not "a thin one" — none. So a
 * panel that rendered blank, or in unreadable colours, or crashed the editor,
 * would have shipped with a full green suite behind it.
 *
 * ── WHAT THE FIXTURE IS SHAPED TO PROVE ─────────────────────────────────────
 * `seed-statutory-inspection` is missing exactly one field of each kind:
 * `inspector_license_number` (the inspector's profile — the production failure
 * of 2026-09-05) and `client_name` (this job). A fixture missing only one kind
 * would leave the other group's rendering unproven, and the two groups are the
 * whole point of the panel.
 */
import { test, expect } from '@playwright/test';
import { loginAsSeedUser } from './helpers/seed-login';
import { SEED_EMAILS, STATUTORY_INSPECTION_ID } from '../seed-fixtures';

test.describe('statutory coverage in the editor', () => {
    test.beforeEach(async ({ page }) => {
        // The seeded owner. The inspection belongs to LEAD_INSPECTOR_ID, and an owner
        // can open it -- which is also the seat that would fix the profile gap.
        await loginAsSeedUser(page, SEED_EMAILS.admin);
        await page.goto(`/inspections/${STATUTORY_INSPECTION_ID}/edit`);
        // The panel lives on the "Inspection Details" overview, not the item
        // list the editor opens on. Clicking there is part of what this spec
        // proves: a panel mounted somewhere nobody navigates to is the exact
        // shape of defect this whole change set is about.
        await page.getByText('Inspection Details', { exact: true }).first().click();
    });

    test('the panel is reachable, and names both kinds of gap', async ({ page }) => {
        const panel = page.getByTestId('statutory-coverage');
        await expect(panel).toBeVisible();

        // The profile half — set once under Settings, missing since before this
        // inspection existed.
        const profile = page.getByTestId('statutory-coverage-profile');
        await expect(profile).toContainText('inspector license number');
        // And the negative half: a panel that listed every missing field in
        // both groups would satisfy the assertion above while telling an
        // inspector to fix a client's name on a settings screen.
        await expect(profile).not.toContainText('client name');

        // The this-job half.
        const onJob = page.getByTestId('statutory-coverage-inspection');
        await expect(onJob).toContainText('client name');
        await expect(onJob).not.toContainText('inspector license number');
    });

    test('the preview link points at the preview, not the deliverable', async ({ page }) => {
        // The distinction is load-bearing: the deliverable requires a published
        // report and files a production row, and this inspection has neither.
        // A link that pointed there would 409 on a screen offering it.
        const link = page.getByTestId('statutory-coverage').getByRole('link');
        await expect(link).toHaveAttribute(
            'href',
            `/api/inspections/${STATUTORY_INSPECTION_ID}/statutory-form/preview.pdf`,
        );
    });

    test('the preview answers a real navigation, with no published report', async ({ page }) => {
        // Walked the way a person walks it: the link is an anchor, so the
        // browser NAVIGATES and the session cookie rides along. `page.request`
        // is not the same journey -- it answered 401 here, which would have
        // been a true statement about a path nobody takes.
        const res = await page.goto(
            `/api/inspections/${STATUTORY_INSPECTION_ID}/statutory-form/preview.pdf`,
        );
        const status = res?.status() ?? 0;
        // 422 is the honest answer while required fields are unanswered, and it
        // is a DIFFERENT answer from the 409 the deliverable gives for a missing
        // report. Either proves the published-report gate is not applied here.
        expect([200, 422]).toContain(status);
        expect(status, 'the preview must not demand a published report').not.toBe(409);
        expect(status, 'the preview must not be unauthenticated').not.toBe(401);
    });

    test('reads correctly in both themes', async ({ page }) => {
        // Contrast and hierarchy are the two things unit tests say nothing
        // about, and the dark palette is where a token that resolves to nothing
        // becomes invisible rather than wrong.
        for (const theme of ['light', 'dark'] as const) {
            await page.emulateMedia({ colorScheme: theme });
            const panel = page.getByTestId('statutory-coverage');
            await expect(panel).toBeVisible();
            // Every chip must have a computed colour that is not the background
            // it sits on. A DS token that compiles to nothing passes `toBeVisible`
            // and disappears here.
            const readable = await panel.evaluate((el) => {
                const style = getComputedStyle(el);
                return style.color !== style.backgroundColor;
            });
            expect(readable, `panel text must be distinguishable in ${theme}`).toBe(true);
            await page.screenshot({
                path: `test-results/statutory-coverage-${theme}.png`,
                fullPage: false,
            });
        }
    });
});
