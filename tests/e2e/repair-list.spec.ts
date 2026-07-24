/**
 * Track E1 — Repair List API route smoke.
 *
 * IA-68: there is no `/inspections/:id/repair-list` PAGE route — only the API
 * route exists. The former "page sub-route is mounted" test accepted 404 as a
 * pass, so it green-lit a route that was never registered (the report's dead
 * "View Repair List" button pointed there). That false-green test is removed;
 * this file now asserts only what actually exists — the API route.
 */
import { test, expect } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:8789';
const FAKE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

test.describe('Track E1 — repair-list route', () => {
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
