/**
 * The courtesy translation ON SCREEN: one half at a time, and a way back.
 *
 * The printed deliverable carries both halves in one file and is asserted by
 * `report-courtesy-translation-pdf.spec.ts`. This is the other surface, and its
 * properties are different ones — on screen there is exactly one half in the
 * document and a control moves the reader between them, so what has to be true
 * is about the CONTROL and about what happens when nothing was translated.
 *
 *  1. **The toggle exists only where there is something to toggle to.** A
 *     control that switches to nothing is worse than no control: a reader
 *     presses it, the page does not change, and the reasonable conclusion is
 *     that the translation is broken rather than absent.
 *  2. **The notice cannot be dismissed.** It is the sentence that says WHICH
 *     DOCUMENT IS THE RECORD. A notice a reader can close once and never see
 *     again is precisely the state it exists to prevent, and its absence is
 *     silent — nothing breaks, it is simply gone.
 *  3. **Switching halves is not a navigation.** The two halves are one page's
 *     state. A reload would lose the reader's scroll position, re-run the
 *     loader, and — because English is the default — could land them back on
 *     the half they just left.
 *  4. **A report with no translation shows neither control.** The negative
 *     control, and it is a SECOND REPORT built the same way rather than the
 *     same report inspected before seeding: identical in every respect except
 *     the stored translation, so the absence below is attributable to that one
 *     difference.
 *
 * ⚠️ (1) and (4) are the same claim from either side, and only having both
 * makes either mean anything. A toggle that never renders at all would satisfy
 * (4) on its own.
 *
 * ## Why the fixture is seeded rather than produced
 *
 * `AIService.translateSegments` has no dev-mock arm, so an environment with no
 * AI credentials cannot reach a stored translation through the product's own
 * regenerate path. `POST /api/__test__/report-translation` stands in for the
 * model call ONLY: it resolves the report, runs the real segmenter and stores
 * under the real English hash, marking each span instead of translating it.
 * Everything downstream of storage — the freshness check, the read path, the
 * render — is the production code. The marker is what lets an assertion tell
 * the two halves apart by CONTENT; on screen they are never side by side, so
 * position proves nothing here.
 */
import { test, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { makeCsrfToken } from './helpers/csrf';
import { ADMIN_EMAIL, ADMIN_PASSWORD, TENANT_SLUG } from './helpers/tenant-identity';

const BASE_URL = 'http://127.0.0.1:8789';
const LOCALE = 'es-419';
/** Prefixed onto every seeded span, so a half can be identified by content. */
const MARKER = '[ES]';
const NAV_TIMEOUT = 30_000;

const NOTICE = '[data-testid="courtesy-translation-notice"]';
const TOGGLE = '[data-testid="courtesy-translation-toggle"]';

let token = '';
/** The report WITH a stored translation. */
let translatedId = '';
/** The negative control: same shape, nothing stored. */
let untranslatedId = '';
let segmentCount = 0;

async function loginApi(request: APIRequestContext): Promise<string> {
    const csrf = makeCsrfToken();
    const res = await request.post(`${BASE_URL}/api/auth/login`, {
        data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, Cookie: `__Host-csrf_token=${csrf}` },
    });
    expect(res.status(), `Login failed for ${ADMIN_EMAIL}`).toBe(200);
    const cookie = (res.headers()['set-cookie'] ?? '').match(/__Host-inspector_token=([^;]+)/)?.[1] ?? '';
    expect(cookie, 'no session cookie returned').toBeTruthy();
    return cookie;
}

/**
 * A COMMERCIAL inspection, for the same reason the print spec creates one:
 * `propertyType: 'commercial'` resolves a non-null report tier, which is what
 * gives the report the front matter and the section count a translation has
 * anything to work on. Both reports here are made by this one function, so the
 * negative control differs from the positive one in exactly one thing.
 */
async function createReport(request: APIRequestContext, address: string): Promise<string> {
    const res = await request.post(`${BASE_URL}/api/inspections/wizard`, {
        data: {
            property: { address, propertyType: 'commercial' },
            services: ['general'],
            schedule: { date: '2026-08-01', startTime: '09:00', durationMinutes: 120 },
            teamMode: false,
        },
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    const body = await res.json().catch(() => ({}));
    expect(res.ok(), JSON.stringify(body)).toBeTruthy();
    const id = body.data?.id;
    expect(id, 'wizard must return the created inspection id').toBeTruthy();
    return id;
}

/** Open the WEB report as the owner — no `?print=1`, so one half and a control. */
async function gotoWebReport(page: Page, id: string): Promise<void> {
    await page.setExtraHTTPHeaders({ Cookie: `__Host-inspector_token=${token}` });
    await page.goto(`${BASE_URL}/report-view/${TENANT_SLUG}/${id}`, {
        timeout: NAV_TIMEOUT,
        waitUntil: 'networkidle',
    });
}

/**
 * Mark this exact document instance, so a later assertion can tell "the page
 * re-rendered" from "the page was replaced". A navigation of any kind — a
 * reload, a client-side route change that remounts, a form post — discards it.
 */
async function stampDocument(page: Page): Promise<void> {
    await page.evaluate(() => {
        (window as unknown as { __halfProbe?: string }).__halfProbe = 'same-document';
    });
}
const documentSurvived = (page: Page) =>
    page.evaluate(() => (window as unknown as { __halfProbe?: string }).__halfProbe ?? null);

test.describe.serial('A courtesy translation on screen: one half, and a way back', () => {
    test.beforeAll(async ({ request }) => {
        token = await loginApi(request);

        translatedId = await createReport(request, '90 Courtesy Translation Walk, Springfield');
        untranslatedId = await createReport(request, '92 Courtesy Translation Walk, Springfield');

        const seed = await request.post(`${BASE_URL}/api/__test__/report-translation`, {
            data: { inspectionId: translatedId, locale: LOCALE, marker: MARKER },
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        });
        const seedBody = await seed.json().catch(() => ({}));
        expect(seed.ok(), `translation seed failed: ${JSON.stringify(seedBody)}`).toBeTruthy();
        segmentCount = seedBody.data?.segmentCount ?? 0;
        // A zero-span fixture would make every assertion below vacuously true:
        // an untranslated report renders one half and looks correct doing it.
        expect(segmentCount, 'the fixture must actually translate something').toBeGreaterThan(0);
    });

    test('offers the toggle, and opens on the English record rather than the translation', async ({ page }) => {
        await gotoWebReport(page, translatedId);

        await expect(page.locator(NOTICE)).toHaveCount(1);
        const toggle = page.locator(TOGGLE);
        await expect(toggle).toHaveCount(1);
        await expect(toggle).toBeVisible();

        // English by default, stated three ways because each of them is what a
        // different consumer reads: the notice's own attribute, the control's
        // pressed state, and the CONTENT. A reader who lands on a machine
        // translation without asking for one has been handed a reading aid
        // dressed as the document.
        await expect(page.locator(NOTICE)).toHaveAttribute('data-showing', 'en');
        await expect(toggle).toHaveAttribute('aria-pressed', 'false');
        expect(await page.locator('[data-report-body]').innerText()).not.toContain(MARKER);

        // One half on screen, never two. The printed file is the only place both
        // exist at once, and a web page that rendered both would put the
        // translation below the record where nobody scrolls to it.
        await expect(page.getByRole('note')).toHaveCount(1);
    });

    test('switches the rendered half in place, with no navigation', async ({ page }) => {
        await gotoWebReport(page, translatedId);
        await stampDocument(page);

        // A navigation of the main frame is counted independently of the probe:
        // the probe proves the document survived, this proves nothing tried.
        let navigations = 0;
        page.on('framenavigated', (frame) => {
            if (frame === page.mainFrame()) navigations += 1;
        });
        const urlBefore = page.url();

        const toggle = page.locator(TOGGLE);
        const body = page.locator('[data-report-body]');

        await toggle.click();
        await expect(page.locator(NOTICE)).toHaveAttribute('data-showing', LOCALE);
        await expect(toggle).toHaveAttribute('aria-pressed', 'true');
        // The CONTENT changed, not only the flag. An attribute that flips while
        // the same English stays on screen is exactly the failure a reader
        // would report as "the button does nothing".
        expect(await body.innerText()).toContain(MARKER);
        // The half declares its language, so a screen reader and the browser's
        // own translation prompt both get the right answer.
        await expect(page.locator(`[lang="${LOCALE}"]`).first()).toBeVisible();

        // ...and back. A one-way control strands a reader in the half that is
        // not the record.
        await toggle.click();
        await expect(page.locator(NOTICE)).toHaveAttribute('data-showing', 'en');
        await expect(toggle).toHaveAttribute('aria-pressed', 'false');
        expect(await body.innerText()).not.toContain(MARKER);

        expect(await documentSurvived(page), 'switching halves replaced the document').toBe('same-document');
        expect(navigations, 'switching halves navigated the main frame').toBe(0);
        expect(page.url(), 'switching halves changed the address').toBe(urlBefore);
    });

    test('offers no way to dismiss the notice, in either half', async ({ page }) => {
        await gotoWebReport(page, translatedId);

        const notice = page.locator(NOTICE);
        const toggle = page.locator(TOGGLE);

        for (const half of ['en', LOCALE]) {
            await expect(notice).toHaveAttribute('data-showing', half);
            await expect(notice).toBeVisible();

            // The ONLY control inside the notice is the one that changes which
            // half is on screen. Anything else in there is a dismiss control by
            // another name — this is asserted as a count rather than as the
            // absence of a named button, because the next one to be added will
            // not be called "dismiss".
            const controls = notice.locator('button, a, input, [role="button"]');
            await expect(controls).toHaveCount(1);
            await expect(controls.first()).toHaveAttribute('data-testid', 'courtesy-translation-toggle');

            // Nor a disclosure widget: `<details>` collapses to its summary and
            // remembers nothing, but a reader who closes it has closed the
            // notice, and a closed notice is an absent notice.
            await expect(notice.locator('details, summary')).toHaveCount(0);

            if (half === 'en') await toggle.click();
        }

        // Still there after a full round trip through both halves — a notice
        // that survives one render and not a re-render is not permanent.
        await toggle.click();
        await expect(notice).toHaveAttribute('data-showing', 'en');
        await expect(notice).toBeVisible();
    });

    test('shows neither notice nor toggle on a report with no translation', async ({ page }) => {
        await gotoWebReport(page, untranslatedId);

        // The report itself rendered — without this the two absences below are
        // also what a blank page, a 404 and a crashed loader look like.
        await expect(page.locator('[data-report-body]')).toHaveCount(1);

        await expect(page.locator(NOTICE)).toHaveCount(0);
        await expect(page.locator(TOGGLE)).toHaveCount(0);
        await expect(page.getByRole('note')).toHaveCount(0);
    });
});
