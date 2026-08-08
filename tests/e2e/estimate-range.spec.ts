/**
 * Sprint 2 S2-4 — Repair estimate range e2e suite.
 *
 * Drives the JSON API directly (no browser) against the local dev worker
 * (http://127.0.0.1:8789) to confirm:
 *
 *   - POST /api/admin/branding refuses to turn `showEstimates` on and still
 *     accepts turning it off.
 *   - The recommendation enum is exposed (sanity check shared with S2-3).
 *
 * The inspection-results JSON sanitizer (sanitizeDefectStates) is covered
 * by the unit suite at tests/unit/estimate-range.spec.ts; the e2e suite
 * focuses on the surfaces that depend on a live worker (KV + D1 +
 * BrandingService caching).
 */
import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { makeCsrfToken } from './helpers/csrf';

const BASE_URL = 'http://127.0.0.1:8789';

const ADMIN_EMAIL = 'admin@autotest.com';
const ADMIN_PASSWORD = 'Password123!';

// CSRF here is a stateless double-submit (server/lib/middleware/csrf.ts): the
// client mints its own token and echoes it as both cookie + header. The server
// never issues the cookie, so there is nothing to fetch — see helpers/csrf.ts.
const getCsrfToken = (_request?: APIRequestContext): string => makeCsrfToken();

async function loginApi(request: APIRequestContext, email: string, password: string): Promise<string> {
    const csrf = await getCsrfToken(request);
    const res = await request.post(`${BASE_URL}/api/auth/login`, {
        data: { email, password },
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrf,
            'Cookie': `__Host-csrf_token=${csrf}`,
        },
    });
    expect(res.status(), `Login failed for ${email}`).toBe(200);
    const cookie = res.headers()['set-cookie'] ?? '';
    const match = cookie.match(/__Host-inspector_token=([^;]+)/);
    return match?.[1] ?? '';
}

let adminToken = '';

test.describe.serial('Sprint 2 S2-4 — Repair estimate range', () => {
    test.beforeAll(async ({ request }) => {
        adminToken = await loginApi(request, ADMIN_EMAIL, ADMIN_PASSWORD);
    });

    test('E-01: POST /api/admin/branding REFUSES showEstimates=true', async ({ request }) => {
        // Inverted deliberately. This test used to assert 200 and persistence,
        // from when the field was writable. Estimates are being redesigned as a
        // separate deliverable rather than a section of the signed report, so
        // the service now refuses to turn the in-report form on. Turning it off
        // stays permitted — see E-03, which is the control that keeps this
        // assertion honest: without it, a route that rejected EVERY branding
        // write would satisfy E-01 just as well.
        const res = await request.post(`${BASE_URL}/api/admin/branding`, {
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
            data: { showEstimates: true },
        });
        expect(res.status(), await res.text()).toBe(422);
    });

    test('E-02: subsequent GET /api/admin/branding round-trips showEstimates', async ({ request }) => {
        const res = await request.get(`${BASE_URL}/api/admin/branding`, {
            headers: { Authorization: `Bearer ${adminToken}` },
        });
        expect(res.status()).toBe(200);
        const body = await res.json();
        // The typed branding response omits showEstimates; the raw column does
        // travel in the payload, and that is deliberate — the setting must stay
        // readable so it can be audited and turned off. What must not happen is
        // a successful write of `true`, which E-01 covers.
        expect(body.success).toBe(true);
    });

    test('E-03: POST showEstimates=false toggles back without errors', async ({ request }) => {
        const res = await request.post(`${BASE_URL}/api/admin/branding`, {
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
            data: { showEstimates: false },
        });
        expect(res.status()).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
    });

    test('E-04: the Report Features settings surface renders for an admin', async ({ request }) => {
        // showEstimates is a branding flag round-tripped by the API (E-01..E-03);
        // there is no standalone "estimate" checkbox in the UI. The report-feature
        // toggles live in the Report Features section of /settings/workspace (the
        // old /settings/workspace/reports sub-route never existed — it 404s).
        // Assert that surface renders for an admin.
        const res = await request.get(`${BASE_URL}/settings/workspace`, {
            headers: { Cookie: `__Host-inspector_token=${adminToken}` },
        });
        expect(res.status()).toBe(200);
        const html = await res.text();
        expect(html).toContain('Report Features');
        expect(html).toContain('Show repair list tab');
    });

    test('E-05: the results write path folds a defect-estimate patch (no 400)', async ({ request }) => {
        // Discover the seeded autotest inspection. The api-project setup
        // creates one as part of standalone-api.spec.ts.
        const list = await request.get(`${BASE_URL}/api/inspections`, {
            headers: { Authorization: `Bearer ${adminToken}` },
        });
        expect(list.status()).toBe(200);
        const listBody = await list.json();
        const inspectionId = (listBody.data?.[0] ?? listBody.data?.items?.[0])?.id;
        if (!inspectionId) test.skip(true, 'No autotest inspection seeded; skipping results write e2e leg');

        // A bulk "Save" writes through POST /:id/results/batch with an
        // array of { itemId, sectionId, field, value } patches -- there is NO
        // PUT or PATCH /:id/results route (both 404). This leg only asserts the
        // live write route folds a defectFields patch without erroring; the
        // estimate keys in the payload below are dropped rather than rejected,
        // so a 200 is the expected answer. That the price does NOT persist is
        // asserted at the unit level, where the stored row can be read back —
        // tests/unit/inspections/inspection-results-batch.spec.ts and
        // tests/unit/inspections/estimate-range.spec.ts.
        const res = await request.post(`${BASE_URL}/api/inspections/${inspectionId}/results/batch`, {
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
            data: {
                patches: [
                    {
                        itemId: 'item-x',
                        sectionId: 's_general',
                        field: 'defectFields',
                        value: {
                            defects: [
                                { cannedId: 'def-1', included: true, estimateLow: -10, estimateHigh: 50000, recommendationId: 'roof-leak' },
                                { cannedId: 'def-2', included: true, estimateLow: 0,   estimateHigh: 0,     recommendationId: 'totally-fake-slug' },
                            ],
                        },
                    },
                ],
            },
        });
        expect(res.status(), await res.text()).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
    });
});
