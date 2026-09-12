/**
 * A photo captured on ANOTHER device, opened in the media viewer.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * The viewer rendered a BROKEN IMAGE for this case. An inspector who shot a
 * photo on a phone that had not yet synced, then opened the same inspection on
 * a laptop, got the browser's torn-page icon and no explanation — the entry is
 * real, the pixels are simply somewhere else.
 *
 * It was fixed (49d7d903) and then verified by hand, over a public tunnel,
 * because nothing in the suite could reach it. That is the gap this file
 * closes: the repair is one `renderSlide` branch, and a regression in it looks
 * exactly like a working viewer to every other test.
 *
 * ── WHY THE SEEDED CONFIG AND NOT `browser-collab` ──────────────────────────
 * This spec was planned for `browser-collab`, and that was wrong for a reason
 * worth recording rather than quietly correcting. `browser-collab` runs under
 * the DEFAULT config, whose `api` project asserts that `POST /api/auth/setup`
 * returns a fresh 200 — so that run is deliberately unseeded, and
 * `seedFixtures()` is only called when `SEED_E2E=1`. The fixture this spec
 * needs would not exist there, and the spec would have failed for a reason
 * unrelated to the viewer.
 *
 * It belongs here on `statutory-coverage`'s argument, sharpened: the state
 * under test cannot be minted through the API at all. A pending photo whose
 * `pendingId` names a blob that is in no local store is, by construction, the
 * one shape an upload cannot produce — an upload always leaves the blob behind
 * on the device that did it. It has to be seeded before the worker starts.
 *
 * ── WHAT THE FIXTURE IS SHAPED TO PROVE ─────────────────────────────────────
 * `MEDIA_RESULTS_DATA` gives the entry a `pendingId`, no `key`, and no crop or
 * annotate derivative. Give it a key and it becomes an ordinary photo that
 * loads, and this spec proves nothing.
 */
import { test, expect } from '@playwright/test';
import { loginAsSeedUser } from './helpers/seed-login';
import { awaitEditorInteractive } from './helpers/editor-ready';
import { SEED_EMAILS, SEED_INSPECTIONS } from '../seed-fixtures';

/** The seeded owner: opens any inspection in the workspace. */
test.describe('media viewer — a photo still on another device', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsSeedUser(page, SEED_EMAILS.admin);
        await page.goto(`/inspections/${SEED_INSPECTIONS.empty}/edit`);
        // The media fixture replaces this inspection's template with one
        // section (Exterior) holding one item (Siding), so Siding is what the
        // editor has to become interactive on.
        await awaitEditorInteractive(page, 'Siding');
        await page.getByText('Siding', { exact: true }).first().click();
    });

    test('the strip marks it pending rather than showing a broken thumbnail', async ({ page }) => {
        await expect(page.getByTestId('pending-placeholder-0')).toBeVisible();
        await expect(page.getByTestId('pending-badge-0')).toBeVisible();
    });

    test('opening it shows a placeholder, and no broken image', async ({ page }) => {
        await page.getByTestId('thumb-0').click();

        // The lightbox is a carousel: it mounts the neighbouring slides as well
        // as the current one, so with a single photo the SAME slide renders
        // three times. Asserting a count of three would pin an implementation
        // detail of the lightbox; asserting at least one, and looking at the
        // first, pins what the reader sees.
        const placeholders = page.getByTestId('media-pending-placeholder');
        // Wait for the lightbox to finish rendering before counting. `.count()`
        // is a point-in-time snapshot — it returns 0 if called before the
        // carousel mounts its slides. `toBeVisible()` retries and is the right
        // gate; the count assertion that follows is then a post-condition, not a
        // race.
        const placeholder = placeholders.first();
        await expect(placeholder).toBeVisible();
        expect(await placeholders.count()).toBeGreaterThan(0);
        // Not just present: it has to SAY something, and say the right thing.
        // An empty box is the same dead end as the torn-page icon, one shade
        // quieter — and copy about a failed upload would be a different lie.
        await expect(placeholder).toContainText(/upload/i);

        // The defect itself. `naturalWidth === 0` on a completed image is
        // exactly what the browser reports for the torn-page icon, and it is
        // the only way to see it from a test — the element is present and
        // visible either way.
        const broken = await page.evaluate(() =>
            Array.from(document.images).filter((i) => i.complete && i.naturalWidth === 0).length);
        expect(broken).toBe(0);
    });

    /**
     * POSITIVE CONTROL, and the one that carries the weight here.
     *
     * Every assertion above would also hold if the viewer had simply rendered
     * nothing at all for this entry — no image, no placeholder, no error. The
     * lightbox must actually be open, or "no broken image" is a statement about
     * an empty screen.
     */
    test('the viewer really opened', async ({ page }) => {
        // Before the click there is no viewer placeholder at all — only the
        // strip's own, which carries a different testid. That asymmetry is what
        // makes this a control rather than a restatement.
        await expect(page.getByTestId('media-pending-placeholder')).toHaveCount(0);

        await page.getByTestId('thumb-0').click();

        const placeholder = page.getByTestId('media-pending-placeholder').first();
        await expect(placeholder).toBeVisible();
        const box = await placeholder.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.width).toBeGreaterThan(0);
        expect(box!.height).toBeGreaterThan(0);
    });
});
