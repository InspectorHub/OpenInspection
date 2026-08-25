/**
 * The printed deliverable of a translated report: ONE file, English first.
 *
 * A courtesy translation is not a second document. Somebody forwards this PDF
 * to a client, and that client must not have to be told which half to read or
 * which of two files is current. So the print render carries both halves in one
 * pass — the English inspection record, then the courtesy translation — and the
 * three properties asserted below are the ones that make that true rather than
 * merely intended:
 *
 *  1. **One file, English first.** Both halves are in a single render, in that
 *     order. Concatenating two separately rendered PDFs would satisfy neither
 *     the page numbering nor the table of contents (see below), so the seam is
 *     asserted INSIDE one document.
 *  2. **The notice heads both halves.** A translation notice a reader cannot
 *     find is decoration, and it is the one element whose absence is silent —
 *     nothing breaks, it is simply gone. Each half resolves its own notice
 *     through the reviewed-constant register, so the day a per-language wording
 *     is reviewed the translated half's notice changes language and nothing
 *     else does.
 *  3. **Page numbers run continuously across the seam.** They come from the
 *     headless renderer's own footer over the whole document, which is exactly
 *     what appending inside one render buys and what merging two files loses.
 *     A second numbering sequence would make the file read as two documents
 *     stapled together, and the first thing a client asks then is which one is
 *     current.
 *
 * ## Why the fixture is seeded rather than produced
 *
 * `AIService.translateSegments` has no dev-mock arm, so an environment with no
 * AI credentials cannot reach a stored translation through the product's own
 * regenerate path. The `POST /api/__test__/report-translation` hook stands in
 * for the model call ONLY: it resolves the report, runs the real segmenter and
 * stores under the real English hash, marking each span instead of translating
 * it. Everything downstream of storage — the freshness check, the read path,
 * the render — is the production code.
 *
 * ## Two arms, and only one of them needs a browser binding
 *
 * The structural assertions run against the print RENDER (the HTML the headless
 * browser would capture), which the worker serves unaided. The PDF arm needs a
 * live Cloudflare Browser Rendering binding, which local `wrangler dev` does
 * not have, so it skips itself there exactly like `report-toc-numbers.spec.ts`.
 * Do not read that skip as a pass.
 */
import { test, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { extractAnchorPages } from '../../server/lib/toc-pages';
import { makeCsrfToken } from './helpers/csrf';
import { ADMIN_EMAIL, ADMIN_PASSWORD, TENANT_SLUG } from './helpers/tenant-identity';

const BASE_URL = 'http://127.0.0.1:8789';
const LOCALE = 'es-419';
/** Prefixed onto every seeded span, so a half can be identified by content. */
const MARKER = '[ES]';
const NAV_TIMEOUT = 30_000;

let token = '';
let inspectionId = '';
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

/** Open the print render as the OWNER — the same page the PDF renderer loads. */
async function gotoPrintRender(page: Page): Promise<void> {
    await page.setExtraHTTPHeaders({ Cookie: `__Host-inspector_token=${token}` });
    await page.goto(`${BASE_URL}/report-view/${TENANT_SLUG}/${inspectionId}?print=1`, {
        timeout: NAV_TIMEOUT,
        waitUntil: 'networkidle',
    });
}

test.describe.serial('A translated report prints as one file, English first', () => {
    test.beforeAll(async ({ request }) => {
        token = await loginApi(request);

        // A COMMERCIAL inspection, for the same reason report-toc-numbers.spec.ts
        // creates one: `propertyType: 'commercial'` resolves a non-null report
        // tier, which is what gives the report a table of contents and the PCA
        // front matter that carries the reliance block. Both are load-bearing
        // here — the TOC is what a merged two-file deliverable would break, and
        // the reliance block is the span that must stay English INSIDE the
        // translated half.
        const wizard = await request.post(`${BASE_URL}/api/inspections/wizard`, {
            data: {
                property: { address: '88 Courtesy Translation Plaza, Springfield', propertyType: 'commercial' },
                services: ['general'],
                schedule: { date: '2026-08-01', startTime: '09:00', durationMinutes: 120 },
                teamMode: false,
            },
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        });
        const wizardBody = await wizard.json().catch(() => ({}));
        expect(wizard.ok(), JSON.stringify(wizardBody)).toBeTruthy();
        inspectionId = wizardBody.data?.id;
        expect(inspectionId, 'wizard must return the created inspection id').toBeTruthy();

        const seed = await request.post(`${BASE_URL}/api/__test__/report-translation`, {
            data: { inspectionId, locale: LOCALE, marker: MARKER },
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        });
        const seedBody = await seed.json().catch(() => ({}));
        expect(seed.ok(), `translation seed failed: ${JSON.stringify(seedBody)}`).toBeTruthy();
        segmentCount = seedBody.data?.segmentCount ?? 0;
        // A zero-span fixture would make every assertion below vacuously true:
        // an untranslated report renders one half and looks correct doing it.
        expect(segmentCount, 'the fixture must actually translate something').toBeGreaterThan(0);
    });

    test('renders both halves in one document, English before the translation', async ({ page }) => {
        await gotoPrintRender(page);

        const halves = page.locator('[data-report-half]');
        await expect(halves).toHaveCount(2);
        expect(await halves.evaluateAll((els) => els.map((e) => e.getAttribute('data-report-half'))))
            .toEqual(['en', LOCALE]);

        // ONE document: both halves are children of the same body, not an
        // embedded frame or a second page. This is the property that a pdf-lib
        // merge of two renders would satisfy in appearance and break in fact.
        expect(await page.locator('body [data-report-half]').count()).toBe(2);
        expect(await page.locator('iframe[data-report-half], frame').count()).toBe(0);

        // Content, not just position: the seeded marker is in the second half
        // and nowhere in the first.
        expect(await halves.nth(0).innerText()).not.toContain(MARKER);
        expect(await halves.nth(1).innerText()).toContain(MARKER);

        // No toggle in print: both halves are in the file, so there is nothing
        // to switch between and a dead control would print onto paper.
        await expect(page.locator('[data-testid="courtesy-translation-toggle"]')).toHaveCount(0);
    });

    test('the notice heads BOTH halves, each resolved for its own language', async ({ page }) => {
        await gotoPrintRender(page);

        const notices = page.getByRole('note');
        await expect(notices).toHaveCount(2);

        // The document's own identity, on both halves. Phrased as what the
        // document IS rather than as a disclaimer about it.
        for (const half of ['en', LOCALE]) {
            const notice = page.locator(`[data-report-half="${half}"] [data-testid="courtesy-translation-notice"]`);
            await expect(notice).toHaveCount(1);
            await expect(notice).toContainText('Courtesy Translation of Inspection Report');
            // Each half resolves its notice independently, and SAYS which
            // language it resolved. Today the reviewed-constant register is
            // empty, so both answer English and that is the correct answer, not
            // a gap — the English wording is the record. The attribute is what
            // makes the day that changes visible to this test.
            await expect(notice).toHaveAttribute('data-notice-locale', /.+/);
        }

        // ...and each half SAYS which half it is. Both open with the same
        // masthead, the same address and the same notice title, so without this
        // a reader turning to the seam sees the report apparently starting
        // over. Nothing above catches that — it took reading a render.
        const notes = page.locator('[data-testid="courtesy-translation-half-note"]');
        await expect(notes).toHaveCount(2);
        const [englishNote, translatedNote] = await notes.allInnerTexts();
        expect(englishNote.trim(), 'the English half must point forward to the translation').not.toBe('');
        expect(translatedNote.trim(), 'the two halves must not be introduced by the same sentence')
            .not.toBe(englishNote.trim());

        // The notice is above the content it describes, in both halves.
        const noticeFirst = await page.evaluate(() =>
            Array.from(document.querySelectorAll('[data-report-half]')).every((half) => {
                const notice = half.querySelector('[data-testid="courtesy-translation-notice"]');
                const body = half.querySelector('[data-report-body]');
                return !!notice && !!body
                    && (notice.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
            }));
        expect(noticeFirst, 'the notice must precede the report body in every half').toBe(true);
    });

    test('the reliance block stays English inside the translated half, and says so', async ({ page }) => {
        await gotoPrintRender(page);

        const englishReliance = page.locator('[data-report-half="en"] [data-pca-reliance]');
        const translatedReliance = page.locator(`[data-report-half="${LOCALE}"] [data-pca-reliance]`);
        await expect(englishReliance).toHaveCount(1);
        await expect(translatedReliance).toHaveCount(1);

        // Byte-for-byte the same text in both halves: the clause that decides
        // whether a third party may rely on the report is never re-expressed.
        expect((await translatedReliance.innerText()).trim())
            .toBe((await englishReliance.innerText()).trim());
        expect(await translatedReliance.innerText()).not.toContain(MARKER);

        // ...and it is MARKED, so a reader meeting an English paragraph in the
        // middle of the translation reads it as deliberate. A reader who
        // concludes the translation is broken discounts the notice too.
        await expect(
            page.locator(`[data-report-half="${LOCALE}"] [data-english-span-scope="reliance"] [data-testid="english-span-badge"]`),
        ).toHaveCount(1);
        // The badge is noise on the English half, where every span is English.
        await expect(
            page.locator('[data-report-half="en"] [data-testid="english-span-badge"]'),
        ).toHaveCount(0);
    });

    test('nothing in the render restarts the page counter at the seam', async ({ page }) => {
        await gotoPrintRender(page);

        // Page numbers are printed by the headless renderer's footer template
        // over the WHOLE document (server/lib/pdf.ts), so a single render is
        // continuous by construction. The only way the render itself could
        // break that is by resetting the CSS page counter — which is what a
        // "start the translation at page 1" instruction would look like.
        const resets = await page.evaluate(() =>
            Array.from(document.styleSheets)
                .flatMap((sheet) => {
                    try { return Array.from(sheet.cssRules).map((r) => r.cssText); } catch { return []; }
                })
                .filter((text) => /counter-reset\s*:\s*[^;]*\bpage\b/.test(text)));
        expect(resets, `page-counter reset found: ${resets.join(' | ')}`).toEqual([]);

        // The TOC belongs to the half it describes. Two halves in one file each
        // carry their own contents page, and the second one's links must point
        // into the second half — not back into the English pages, which is what
        // duplicated anchor ids would silently produce.
        const tocHrefs = await page.evaluate(() =>
            Array.from(document.querySelectorAll('[data-report-half] a[href^="#"]'))
                .map((a) => ({
                    half: a.closest('[data-report-half]')?.getAttribute('data-report-half') ?? '',
                    target: (a.getAttribute('href') ?? '').slice(1),
                })));
        expect(tocHrefs.length, 'a commercial report must render a table of contents').toBeGreaterThan(0);
        for (const { half, target } of tocHrefs) {
            const owner = await page.evaluate(
                (id) => document.getElementById(id)?.closest('[data-report-half]')?.getAttribute('data-report-half') ?? null,
                target,
            );
            expect(owner, `TOC link #${target} in the ${half} half resolves outside it`).toBe(half);
        }
    });

    test('the rendered PDF is one file whose anchors resolve in both halves', async ({ request }) => {
        // The real-render proof. Needs a live BROWSER binding; local wrangler
        // dev has none, so this skips rather than false-passing.
        const pdfRes = await request.get(`${BASE_URL}/api/inspections/${inspectionId}/pdf?type=full`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!pdfRes.ok()) {
            test.skip(true, `PDF render unavailable here (status ${pdfRes.status()}) — needs a live BROWSER binding.`);
            return;
        }

        const pageMap = await extractAnchorPages(await pdfRes.body());
        const names = Object.keys(pageMap);
        const englishPages = names.filter((n) => !n.startsWith(LOCALE)).map((n) => pageMap[n]);
        const translatedPages = names.filter((n) => n.startsWith(LOCALE)).map((n) => pageMap[n]);

        expect(englishPages.length, `no English anchors in ${JSON.stringify(pageMap)}`).toBeGreaterThan(0);
        expect(translatedPages.length, `no translated-half anchors in ${JSON.stringify(pageMap)}`).toBeGreaterThan(0);
        // One file: every translated-half anchor lands AFTER every English one,
        // on pages of the same document. Two merged PDFs cannot produce this —
        // the second file's anchors would resolve to its own page 1.
        expect(Math.min(...translatedPages)).toBeGreaterThan(Math.max(...englishPages));
    });
});
