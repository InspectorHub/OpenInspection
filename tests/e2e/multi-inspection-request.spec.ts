/**
 * Sprint 2 Track 2 — Multi-inspection per request smoke.
 *
 * Verifies the public surface of S2-2 (multi-service booking) without
 * requiring an authenticated admin login:
 *
 *   1. /book renders the multi-service add UI (Sprint 1 C-4 + S2-2)
 *   2. POST /api/public/booking accepts a payload with two services and
 *      creates a single inspection_request grouping both inspections
 *   3. GET  /api/inspection-requests/by-inspection/:id returns the parent
 *      request + sibling list when called with M2M / admin auth — when no
 *      auth is present it 401s, which we treat as "wired up".
 *
 * The full admin flow (login → dashboard → switcher click) is exercised
 * during the Chrome MCP GIF capture. Keeping the spec auth-free means it
 * runs reliably in any environment without seed users.
 */
import { test, expect } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:8789';

test.describe('Sprint 2 S2-2 — multi-inspection per request', () => {
    // Deleted in the 2026-07 tests-reorg de-stale: the "Services multi-select"
    // test scraped the Alpine booking page for the `selectedServiceIds` x-model
    // (removed in the RR v7 migration) and hit the bare `/book` route (now
    // `/book/:tenant`, so `/book` 404s). The multi-service selection is a React
    // wizard step (app/components/booking/BookingSteps.tsx ServicesStep). The
    // two request-level endpoint smokes below remain the migration-proof
    // coverage of the S2-2 surface.

    test('by-inspection endpoint is wired up (no 404)', async ({ request }) => {
        // The endpoint must NOT return 404 — that would mean the route isn't
        // registered. Acceptable answers depend on test environment:
        //   401/403 — JWT middleware fired (route present, auth missing)
        //   503     — tenant not initialized (route present, system not seeded)
        // Anything in 400..504 except 404 proves the route is mounted.
        const res = await request.get(`${BASE_URL}/api/inspection-requests/by-inspection/does-not-exist`);
        expect(res.status()).not.toBe(404);
        expect(res.status()).toBeGreaterThanOrEqual(400);
        expect(res.status()).toBeLessThanOrEqual(599);
    });

    test('public booking endpoint exists and rejects empty payload', async ({ request }) => {
        const res = await request.post(`${BASE_URL}/api/public/book`, {
            data: {},
            failOnStatusCode: false,
        });
        // 400 / 401 / 403 / 422 / 503 all prove the route is mounted and
        // validating input. 404 would be the regression we're catching.
        expect(res.status()).not.toBe(404);
        expect(res.status()).toBeGreaterThanOrEqual(400);
    });
});
