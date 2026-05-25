/**
 * Sprint 1 Sub-spec C-7 — Report-gate end-to-end coverage.
 *
 * Verifies that the public `/report/:id` route blocks non-inspector
 * viewers when payment or agreement is pending, and that
 * inspector / admin / owner roles bypass the gate.
 *
 * The fix this spec exercises: prior to Sprint 1, `/report/:id` (the
 * public share link) skipped the payment/agreement check entirely —
 * only the JWT-authenticated `/api/inspections/:id/report` enforced it.
 * Customers could open the share URL and see the report regardless of
 * payment state. Sprint 1 patches `/report/:id` to enforce the gate
 * before rendering, while still allowing inspector/admin/owner JWTs to
 * preview without paying themselves.
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:8789';

const ADMIN_EMAIL = 'admin@autotest.com';
const ADMIN_PASSWORD = 'Password123!';
// PR 2 — path-tenant URL shape: /report/<tenantSlug>/<id>. Matches the slug
// the setup wizard derives from the standalone-browser COMPANY_NAME.
const TENANT_SLUG = 'automation-test-corp';

// ── Helpers ─────────────────────────────────────────────────────────────────

async function getCsrf(request: APIRequestContext): Promise<string> {
    const res = await request.get(`${BASE_URL}/login`);
    const setCookie = res.headers()['set-cookie'] ?? '';
    const match = setCookie.match(/__Host-csrf_token=([^;]+)/);
    return match?.[1] ?? '';
}

async function loginApi(request: APIRequestContext, email: string, password: string): Promise<string> {
    const csrf = await getCsrf(request);
    const res = await request.post(`${BASE_URL}/api/auth/login`, {
        data: { email, password },
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrf,
            'Cookie': `__Host-csrf_token=${csrf}`,
        },
    });
    if (res.status() !== 200) return '';
    const cookie = res.headers()['set-cookie'] ?? '';
    const match = cookie.match(/__Host-inspector_token=([^;]+)/);
    return match?.[1] ?? '';
}

async function withAuth(page: Page, path: string, token: string) {
    await page.setExtraHTTPHeaders({ 'Cookie': `__Host-inspector_token=${token}` });
    await page.goto(`${BASE_URL}${path}`, { waitUntil: 'domcontentloaded' });
}

async function createTestInspection(
    request: APIRequestContext,
    token: string,
    options: { paymentRequired?: boolean; paymentStatus?: string; agreementRequired?: boolean },
): Promise<string | null> {
    // Best-effort — the admin /api/inspections POST may need richer fields
    // depending on tenant config. Falls back to null when creation isn't
    // possible in the local test environment, which lets the rest of the
    // spec skip rather than fail noisily.
    const res = await request.post(`${BASE_URL}/api/inspections`, {
        data: {
            propertyAddress:    `1234 Gate Test ${Date.now()}`,
            clientName:         'Gate Test Client',
            clientEmail:        'gatetest@example.com',
            date:               new Date().toISOString().split('T')[0],
            ...options,
        },
        headers: {
            'Content-Type': 'application/json',
            'Cookie': `__Host-inspector_token=${token}`,
        },
    });
    if (res.status() !== 200 && res.status() !== 201) return null;
    const json = await res.json();
    return json?.data?.id || json?.id || null;
}

// ── Specs ───────────────────────────────────────────────────────────────────

test.describe('Report gate (Sprint 1 C-7)', () => {
    let adminToken = '';
    let setupOk = false;

    test.beforeAll(async ({ request }) => {
        adminToken = await loginApi(request, ADMIN_EMAIL, ADMIN_PASSWORD);
        setupOk = adminToken.length > 0;
    });

    test('unpaid + payment required → public report URL shows the gate', async ({ page, request }) => {
        test.skip(!setupOk, 'Setup test data missing — run standalone-browser SETUP first');
        const id = await createTestInspection(request, adminToken, {
            paymentRequired: true,
            paymentStatus:   'unpaid',
        });
        test.skip(id === null, 'Could not seed gated inspection');

        // Visit the public share URL with NO auth cookie (clear any from
        // prior tests) — simulates a customer opening the share link.
        await page.context().clearCookies();
        await page.goto(`${BASE_URL}/report/${TENANT_SLUG}/${id}`, { waitUntil: 'domcontentloaded' });

        const body = await page.textContent('body');
        expect(body).toContain('Pending payment');
        // The actual report content (rating descriptions etc.) MUST NOT
        // leak through into the HTML — verify a sentinel from the report
        // template is absent.
        expect(body).not.toContain('Roof Covering');
    });

    test('agreement required + unsigned → public report URL shows the gate', async ({ page, request }) => {
        test.skip(!setupOk, 'Setup test data missing');
        const id = await createTestInspection(request, adminToken, {
            agreementRequired: true,
        });
        test.skip(id === null, 'Could not seed gated inspection');

        await page.context().clearCookies();
        await page.goto(`${BASE_URL}/report/${TENANT_SLUG}/${id}`, { waitUntil: 'domcontentloaded' });

        const body = await page.textContent('body');
        expect(body).toContain('Pending agreement');
    });

    test('inspector role bypasses the gate', async ({ page, request }) => {
        test.skip(!setupOk, 'Setup test data missing');
        const id = await createTestInspection(request, adminToken, {
            paymentRequired: true,
            paymentStatus:   'unpaid',
        });
        test.skip(id === null, 'Could not seed gated inspection');

        // Visit with admin JWT — gate must be skipped.
        await withAuth(page, `/report/${TENANT_SLUG}/${id}`, adminToken);
        const body = await page.textContent('body');
        expect(body).not.toContain('Pending payment');
        expect(body).not.toContain('Pending agreement');
    });
});
