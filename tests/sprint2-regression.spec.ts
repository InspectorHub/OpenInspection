/**
 * Sprint 2 regression suite — Track A fixes (A1-A4).
 *
 * Covers four bugs verified live on production after Sprint 2 ship:
 *   A1 — /library/rating-systems shows "authFetch is not defined" because
 *        the page's <script> tag for rating-systems.js loaded before auth.js,
 *        so the bare authFetch reference was unresolved.
 *   A2 — Sidebar in main-layout.tsx still rendered a "SOON" badge next to
 *        the Rating Systems link — Sprint 1 stub artifact that S2-1 was
 *        supposed to remove.
 *   A3 — /inspections/:id/report did NOT show the 5-tab inspection sub-nav
 *        (Report / Photos / Summary / Signatures / Settings) — InspectionShell
 *        only wrapped the four passive sub-pages, not the Report editor.
 *   A4 — Sub-pages (/photos /summary /signatures /settings) had a generic
 *        <title> ("Photos" instead of "OpenInspection | Photos") and the
 *        Alpine factories called window.authFetch which was undefined because
 *        auth.js declared authFetch as a top-level const — never attached to
 *        window.
 *
 * Tests run unauthenticated where possible — the htmlAuthGuard 302s to /login,
 * but the response body inspection happens before the redirect on routes that
 * are public, and we use server-side template rendering checks for the rest.
 *
 * For pages that require auth, we follow the 302 to /login, then assert the
 * underlying page source via a direct HTML scrape of the dev worker response
 * (the Playwright `request` API doesn't trip Alpine init so JS hangs are
 * irrelevant — we just inspect the static HTML for the expected markup).
 */
import { test, expect } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:8789';
const FAKE_INSPECTION_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

test.describe('Sprint 2 regression — A1 rating-systems wiring', () => {
    test('A1: rating-systems page loads /js/auth.js BEFORE /js/rating-systems.js', async ({ request }) => {
        // Hit the route — even if htmlAuthGuard redirects to /login, the page
        // template is what we care about here. Follow redirects to land on
        // the actual page when possible.
        const res = await request.get(`${BASE_URL}/library/rating-systems`, {
            failOnStatusCode: false,
            maxRedirects: 0,
        });
        // If unauthenticated we get 302 to /login; we want to inspect the
        // actual rating-systems page, so make a direct fetch of the static
        // template via a HEAD-then-GET pattern. To avoid auth, we accept either
        // the rating-systems page body OR the login page. When we see the
        // rating-systems body, we inspect script tag order.
        if ([301, 302, 303, 307, 308].includes(res.status())) {
            // Auth redirect — we can't easily get the authenticated body in
            // this test scope. Instead, assert the source template is correct
            // by virtue of our earlier inspection. The unit-style assertion
            // below covers it.
            test.skip(true, 'Authenticated route — covered by source-level test below');
            return;
        }
        const html = await res.text();
        const authIdx = html.indexOf('/js/auth.js');
        const ratingIdx = html.indexOf('/js/rating-systems.js');
        expect(authIdx, 'auth.js must be present on rating-systems page').toBeGreaterThan(-1);
        expect(ratingIdx, 'rating-systems.js must be present on rating-systems page').toBeGreaterThan(-1);
        expect(authIdx, 'auth.js must load BEFORE rating-systems.js so authFetch is defined').toBeLessThan(ratingIdx);
    });

    test('A1 (source-level): rating-systems.tsx template wires auth.js before rating-systems.js', async () => {
        // Source-level guard so the regression is caught even when the dev
        // worker is offline. Reads the compiled-from-source template file.
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const tsxPath = path.resolve(process.cwd(), 'src/templates/pages/rating-systems.tsx');
        const src = await fs.readFile(tsxPath, 'utf-8');
        const authIdx = src.indexOf('/js/auth.js');
        const ratingIdx = src.indexOf('/js/rating-systems.js');
        expect(authIdx, 'auth.js script tag missing from rating-systems.tsx').toBeGreaterThan(-1);
        expect(ratingIdx, 'rating-systems.js script tag missing from rating-systems.tsx').toBeGreaterThan(-1);
        expect(authIdx, 'auth.js must precede rating-systems.js').toBeLessThan(ratingIdx);
    });

    test('A1 (runtime): auth.js exposes authFetch on window for sub-page JS files', async () => {
        // The Sprint 2 inspection sub-page Alpine factories call
        // window.authFetch directly. Top-level `const` does not attach to
        // window in modern browsers, so auth.js explicitly exports it.
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const jsPath = path.resolve(process.cwd(), 'public/js/auth.js');
        const src = await fs.readFile(jsPath, 'utf-8');
        expect(src, 'auth.js must explicitly attach authFetch to window').toMatch(/window\.authFetch\s*=\s*authFetch/);
    });
});

test.describe('Sprint 2 regression — A2 SOON badge removed', () => {
    test('A2: main-layout.tsx no longer renders a SOON badge next to Rating Systems', async () => {
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const tsxPath = path.resolve(process.cwd(), 'src/templates/layouts/main-layout.tsx');
        const src = await fs.readFile(tsxPath, 'utf-8');
        // The Rating Systems link must still exist.
        expect(src).toMatch(/href="\/library\/rating-systems"/);
        // But the SOON badge span must be gone.
        const ratingMatches = src.match(/href="\/library\/rating-systems"[^>]*>[^<]*<\/a>/g) ?? [];
        expect(ratingMatches.length, 'expected 2 Rating Systems links (mobile + desktop)').toBeGreaterThanOrEqual(2);
        for (const link of ratingMatches) {
            expect(link, 'SOON badge must be removed from Rating Systems link').not.toContain('soon');
        }
    });
});

test.describe('Sprint 2 regression — A3 inspection /report has 5-tab sub-nav', () => {
    test('A3: /inspections/:id/report renders the 5-tab inspection sub-nav', async ({ request }) => {
        // The route is htmlAuthGuard'd — without auth we get redirected to
        // /login. We assert at the template-source level instead, since the
        // actual fix is in inspection-edit.tsx.
        const res = await request.get(`${BASE_URL}/inspections/${FAKE_INSPECTION_ID}/report`, {
            failOnStatusCode: false,
            maxRedirects: 0,
        });
        // Either 302 (auth redirect) or 200 (the actual page). For 200, scan
        // for the sub-nav.
        if (res.status() === 200) {
            const html = await res.text();
            expect(html).toContain('aria-label="Inspection sections"');
            for (const tab of ['Report', 'Photos', 'Summary', 'Signatures', 'Settings']) {
                expect(html, `Sub-nav must include ${tab} tab link`).toContain(`>${tab}</a>`);
            }
        } else {
            // Source-level fallback — verify inspection-edit.tsx contains the
            // 5-tab nav block we added.
            const fs = await import('node:fs/promises');
            const path = await import('node:path');
            const tsxPath = path.resolve(process.cwd(), 'src/templates/pages/inspection-edit.tsx');
            const src = await fs.readFile(tsxPath, 'utf-8');
            expect(src, 'inspection-edit.tsx must include the inspection sections sub-nav').toContain('aria-label="Inspection sections"');
            for (const tab of ['Report', 'Photos', 'Summary', 'Signatures', 'Settings']) {
                expect(src, `Sub-nav must include ${tab} tab link`).toContain(`>${tab}</a>`);
            }
        }
    });
});

test.describe('Sprint 2 regression — A4 sub-pages have proper <title>', () => {
    const SUBS = [
        { route: 'photos',     label: 'Photos' },
        { route: 'summary',    label: 'Summary' },
        { route: 'signatures', label: 'Signatures' },
        { route: 'settings',   label: 'Settings' },
    ];

    for (const { route, label } of SUBS) {
        test(`A4: /inspections/:id/${route} template uses '\${siteName} | ${label}' title`, async () => {
            const fs = await import('node:fs/promises');
            const path = await import('node:path');
            const tsxPath = path.resolve(process.cwd(), `src/templates/pages/inspection/${route}.tsx`);
            const src = await fs.readFile(tsxPath, 'utf-8');
            // The title prop must include the siteName branding pattern, NOT a
            // bare label like "Photos".
            expect(src, `${route}.tsx must derive siteName from branding`).toContain('siteName');
            expect(src, `${route}.tsx title must follow '\${siteName} | ${label}' pattern`).toContain(`\${siteName} | ${label}`);
        });
    }
});

test.describe('Sprint 2 regression — A4 sub-route HTTP smoke', () => {
    const SUBS = ['photos', 'summary', 'signatures', 'settings'] as const;

    for (const sub of SUBS) {
        test(`A4: /inspections/:id/${sub} returns a route response (200 or auth 302), never 5xx`, async ({ request }) => {
            const res = await request.get(`${BASE_URL}/inspections/${FAKE_INSPECTION_ID}/${sub}`, {
                failOnStatusCode: false,
                maxRedirects: 0,
                timeout: 10000,
            });
            // 200 = page renders, 302 = auth guard redirect to /login.
            // 404 means the route is not mounted, 5xx means it errors out.
            expect([200, 301, 302, 303, 307, 308]).toContain(res.status());
        });
    }
});
