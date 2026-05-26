/**
 * Sprint 2 Track 2 — Inspection sub-routes (S2-5) smoke.
 *
 * Verifies that the /edit and /report URLs are wired into the router
 * and that /edit redirects to /report.
 *
 * Note: the original Sprint 2 sub-nav (Photos / Summary / Signatures /
 * Settings) was retired in the design-alignment rollback. The editor
 * is now single-view with slide-over sheets for Photos and Settings;
 * Summary is reached via the editor's Preview link; envelope audit
 * chain folds into PublishModal. The /settings deep link still 302s
 * to /report so external links don't break.
 */
import { test, expect } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:8789';

const FAKE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

test.describe('Sprint 2 S2-5 — inspection sub-routes', () => {
    test('/edit redirects to /report (302)', async ({ request }) => {
        const res = await request.get(`${BASE_URL}/inspections/${FAKE_ID}/edit`, {
            maxRedirects: 0,
            failOnStatusCode: false,
        });
        expect([301, 302, 303, 307, 308]).toContain(res.status());
        const location = res.headers()['location'] || '';
        expect(location).toMatch(/\/(login|report)/);
    });

    test('/settings 302s to /report (or to /login when unauthed)', async ({ request }) => {
        const res = await request.get(`${BASE_URL}/inspections/${FAKE_ID}/settings`, {
            maxRedirects: 0,
            failOnStatusCode: false,
        });
        expect([301, 302, 303, 307, 308]).toContain(res.status());
        const location = res.headers()['location'] || '';
        expect(location).toMatch(/\/(login|report)/);
    });

    test('/report editor route is mounted', async ({ request }) => {
        const res = await request.get(`${BASE_URL}/inspections/${FAKE_ID}/report`, {
            maxRedirects: 0,
            failOnStatusCode: false,
        });
        expect([200, 301, 302, 303, 307, 308]).toContain(res.status());
        if ([301, 302, 303, 307, 308].includes(res.status())) {
            const location = res.headers()['location'] || '';
            expect(location).toMatch(/\/login/);
        }
    });

    test('responsive sweep — /report editor renders without horizontal scroll across 5 viewports', async ({ page }) => {
        const VIEWPORTS = [
            { name: 'iphone-se',    w: 375,  h: 667  },
            { name: 'iphone-pro',   w: 414,  h: 896  },
            { name: 'tablet',       w: 768,  h: 1024 },
            { name: 'small-laptop', w: 1024, h: 768  },
            { name: 'desktop',      w: 1440, h: 900  },
        ];

        for (const vp of VIEWPORTS) {
            await page.setViewportSize({ width: vp.w, height: vp.h });
            const res = await page.goto(`${BASE_URL}/inspections/${FAKE_ID}/report`, {
                waitUntil: 'domcontentloaded',
            });
            // Auth bounce to /login still gives us a 200 on the login page; either
            // way no horizontal scroll should be present.
            test.skip(!res || res.status() >= 500, 'Sub-route unreachable');
            const hScroll = await page.evaluate(
                () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
            );
            expect(hScroll, `/report has horizontal scroll at ${vp.w}px`).toBe(false);
        }
    });
});
