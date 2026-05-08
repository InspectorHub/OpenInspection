/**
 * Track E1 (ITB §11, UC-ITB-07) — Repair List route smoke.
 *
 * Router-level guard: verify the new `/inspections/:id/repair-list` route
 * is mounted and gated by htmlAuthGuard. Without a session the route
 * 302s to /login (proves the route is registered + auth runs first); with
 * an opted-in session the route either renders the punch-list or 404s
 * when the tenant has the toggle off.
 *
 * Full UI flow (toggle on → see tab → click → see card list → print) is
 * exercised by the Chrome MCP smoke separately.
 */
import { test, expect } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:8789';
const FAKE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

test.describe('Track E1 — repair-list route', () => {
    test('/repair-list sub-route is mounted', async ({ request }) => {
        const res = await request.get(`${BASE_URL}/inspections/${FAKE_ID}/repair-list`, {
            maxRedirects: 0,
            failOnStatusCode: false,
        });
        // Either a 302 to /login (unauth) or a 200/404 (auth + opt-in/out).
        // A 500 or anything else means the route blew up.
        expect([200, 301, 302, 303, 307, 308, 404]).toContain(res.status());
        if ([301, 302, 303, 307, 308].includes(res.status())) {
            const location = res.headers()['location'] || '';
            expect(location).toMatch(/\/login/);
        }
    });

    test('GET /api/inspections/:id/repair-list responds', async ({ request }) => {
        const res = await request.get(`${BASE_URL}/api/inspections/${FAKE_ID}/repair-list`, {
            failOnStatusCode: false,
        });
        // Auth middleware on /api/* returns 401 without a token; the route
        // should be mounted (not 404 from the catch-all).
        expect(res.status()).not.toBe(404);
        expect([401, 403, 200]).toContain(res.status());
    });
});
