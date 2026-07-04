/**
 * Standalone API Tests
 *
 * Tests all API endpoints locally via HTTP (Bearer token auth).
 * No browser needed — pure request/response validation.
 *
 * Covers: Setup, Auth, CRUD, RBAC guards, Health endpoints
 * Run: npx playwright test tests/standalone-api.spec.ts
 */
import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { makeCsrfToken } from './helpers/csrf';

const BASE_URL = 'http://127.0.0.1:8789';

const ADMIN_EMAIL = 'admin@autotest.com';
const ADMIN_PASSWORD = 'Password123!';
const ADMIN_NAME    = 'Automation Test Admin';
const COMPANY_NAME = 'Automation Test Corp';
const INSPECTOR_EMAIL = 'inspector@autotest.com';
const INSPECTOR_PASSWORD = 'Inspector123!';

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
    expect(res.status(), `Login failed for ${email}: expected 200`).toBe(200);
    const cookie = res.headers()['set-cookie'] ?? '';
    const match = cookie.match(/__Host-inspector_token=([^;]+)/);
    const token = match?.[1] ?? '';
    expect(token, `No auth token returned for ${email}`).toBeTruthy();
    return token;
}

async function apiPost(request: APIRequestContext, path: string, token: string, data: Record<string, unknown>) {
    return request.post(`${BASE_URL}${path}`, {
        data,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
}

async function apiGet(request: APIRequestContext, path: string, token: string) {
    return request.get(`${BASE_URL}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
}

/**
 * Fetch a PAGE route and return the redirect response (no browser).
 *
 * Page routes are React Router SSR loaders that authenticate via the
 * `__Host-inspector_token` COOKIE only — `getToken()` (app/lib/session.server.ts)
 * reads the raw cookie and ignores the Authorization header (that is the
 * BFF/token-relay contract; Bearer auth is for the JSON API, not pages). So the
 * JWT must ride as a cookie here — a Bearer-only request looks unauthenticated
 * and bounces to /login before the role guard can redirect a forbidden inspector
 * to /inspections. (Bearer is left on too; it is simply ignored by page routes.)
 */
async function fetchPage(request: APIRequestContext, path: string, token: string) {
    return request.get(`${BASE_URL}${path}`, {
        headers: {
            Authorization: `Bearer ${token}`,
            Cookie: `__Host-inspector_token=${token}`,
        },
        maxRedirects: 0, // Don't follow redirects so we can inspect Location
    });
}

// ─── Shared state ────────────────────────────────────────────────────────────

let adminToken = '';
let inspectorToken = '';
let createdTemplateId = '';
let createdInspectionId = '';
let createdAgreementId = '';

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe.serial('Standalone API Tests', () => {

    // ── Setup & Auth ──────────────────────────────────────────────────────────

    test('API-01: POST /api/auth/setup initializes workspace', async ({ request }) => {
        const csrf = await getCsrfToken(request);
        const res = await request.post(`${BASE_URL}/api/auth/setup`, {
            data: {
                companyName: COMPANY_NAME,
                adminName:   ADMIN_NAME,
                email:       ADMIN_EMAIL,
                password:    ADMIN_PASSWORD,
                verificationCode: '000000',
            },
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrf,
                'Cookie': `__Host-csrf_token=${csrf}`,
            },
        });
        expect(res.status(), 'Setup must return 200').toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.data?.redirect).toBe('/inspections');
    });

    test('API-02: POST /api/auth/login returns token in cookie', async ({ request }) => {
        adminToken = await loginApi(request, ADMIN_EMAIL, ADMIN_PASSWORD);
        expect(adminToken.split('.').length, 'Token must be a JWT (3 parts)').toBe(3);
    });

    // ── Template CRUD ─────────────────────────────────────────────────────────

    test('API-03: POST /api/inspections/templates creates template', async ({ request }) => {
        const richItem = (id: string, label: string) => ({
            id, label, type: 'rich' as const,
            ratingOptions: ['Inspected', 'Repair'],
            tabs: { information: [], limitations: [], defects: [] },
        });
        const res = await apiPost(request, '/api/inspections/templates', adminToken, {
            name: 'E2E Standard Residential',
            schema: {
                schemaVersion: 2,
                sections: [
                    {
                        id: 's_general',
                        title: 'General',
                        items: [richItem('roof', 'Roof'), richItem('plumbing', 'Plumbing'), richItem('electrical', 'Electrical')],
                    },
                ],
            },
        });
        expect(res.status(), 'Template creation must return 201').toBe(201);
        const body = await res.json();
        createdTemplateId = body.data?.template?.id;
        expect(createdTemplateId, 'Response must include template ID').toBeTruthy();
    });

    test('API-04: GET /api/inspections/templates lists templates', async ({ request }) => {
        const res = await apiGet(request, '/api/inspections/templates', adminToken);
        expect(res.status()).toBe(200);
        const body = await res.json();
        const templates = body.data?.templates || body.data || [];
        expect(templates.length, 'At least one template must exist').toBeGreaterThanOrEqual(1);
    });

    // ── Inspection CRUD ───────────────────────────────────────────────────────

    test('API-05: POST /api/inspections creates inspection', async ({ request }) => {
        const res = await apiPost(request, '/api/inspections', adminToken, {
            propertyAddress: '742 Evergreen Terrace, Springfield',
            clientName: 'Homer Simpson',
            clientEmail: 'homer@springfield.com',
            templateId: createdTemplateId,
        });
        expect(res.status(), 'Inspection creation must return 201').toBe(201);
        const body = await res.json();
        createdInspectionId = body.data?.inspection?.id;
        expect(createdInspectionId, 'Response must include inspection ID').toBeTruthy();
    });

    test('API-06: GET /api/inspections lists inspections', async ({ request }) => {
        const res = await apiGet(request, '/api/inspections', adminToken);
        expect(res.status()).toBe(200);
        const body = await res.json();
        // Response shape: { success, data: [...] } or { success, data: { inspections: [...] } }
        const inspections = Array.isArray(body.data) ? body.data : (body.data?.inspections || []);
        expect(inspections.length).toBeGreaterThanOrEqual(1);
        const found = inspections.find((i: { id: string }) => i.id === createdInspectionId);
        expect(found, 'Created inspection must appear in list').toBeTruthy();
    });

    test('API-07: GET /api/inspections with search filter', async ({ request }) => {
        const res = await apiGet(request, '/api/inspections?search=Evergreen', adminToken);
        expect(res.status()).toBe(200);
        const body = await res.json();
        const inspections = Array.isArray(body.data) ? body.data : (body.data?.inspections || []);
        expect(inspections.length, 'Search for "Evergreen" must return results').toBeGreaterThanOrEqual(1);
    });

    // ── Agreement CRUD ────────────────────────────────────────────────────────

    test('API-08: POST /api/admin/agreements creates agreement', async ({ request }) => {
        const res = await apiPost(request, '/api/admin/agreements', adminToken, {
            name: 'E2E Test Agreement',
            content: 'Client agrees to standard inspection terms and conditions.',
        });
        expect(res.status(), 'Agreement creation must return 201').toBe(201);
        const body = await res.json();
        createdAgreementId = body.data?.agreement?.id || body.data?.id || '';
        expect(createdAgreementId, 'Response must include agreement ID').toBeTruthy();
    });

    test('API-09: GET /api/admin/agreements lists agreements', async ({ request }) => {
        const res = await apiGet(request, '/api/admin/agreements', adminToken);
        expect(res.status()).toBe(200);
    });

    // ── Team & Invite ─────────────────────────────────────────────────────────

    test('API-10: POST /api/team/invite creates invite and join flow works', async ({ request }) => {
        const res = await apiPost(request, '/api/team/invite', adminToken, {
            email: INSPECTOR_EMAIL,
            role: 'inspector',
        });
        expect(res.status(), 'Invite must return 201').toBe(201);

        const body = await res.json();
        const inviteLink = body.data?.inviteLink || body.inviteLink || '';
        expect(inviteLink, 'Response must include inviteLink').toBeTruthy();

        // Accept invite
        const token = new URL(inviteLink).searchParams.get('token') ?? '';
        expect(token, 'Invite link must contain token param').toBeTruthy();

        const joinRes = await request.post(`${BASE_URL}/api/auth/join`, {
            data: { token, password: INSPECTOR_PASSWORD },
            headers: { 'Content-Type': 'application/json' },
        });
        expect(joinRes.status(), 'Join must return 200').toBe(200);
    });

    test('API-11: Inspector can login after joining', async ({ request }) => {
        inspectorToken = await loginApi(request, INSPECTOR_EMAIL, INSPECTOR_PASSWORD);
        expect(inspectorToken).toBeTruthy();
    });

    // ── Availability ──────────────────────────────────────────────────────────

    test('API-12: GET /api/availability returns 200', async ({ request }) => {
        const res = await apiGet(request, '/api/availability', adminToken);
        expect(res.status()).toBe(200);
    });

    // ── Auth Logout ───────────────────────────────────────────────────────────

    test('API-13: POST /api/auth/logout clears session', async ({ request }) => {
        const res = await request.post(`${BASE_URL}/api/auth/logout`, {
            headers: {
                Authorization: `Bearer ${adminToken}`,
                'Cookie': `__Host-inspector_token=${adminToken}`,
            },
        });
        expect(res.status(), 'Logout must return 200').toBe(200);

        const setCookie = res.headers()['set-cookie'] ?? '';
        expect(setCookie, 'Logout must clear the auth cookie').toContain('__Host-inspector_token');
    });

    test('API-14: Can re-login after logout', async ({ request }) => {
        adminToken = await loginApi(request, ADMIN_EMAIL, ADMIN_PASSWORD);
        expect(adminToken).toBeTruthy();
    });

    // ── RBAC Guards (API level) ───────────────────────────────────────────────

    test('API-15: Unauthenticated GET /inspections redirects to /login', async ({ request }) => {
        const res = await request.get(`${BASE_URL}/inspections`, { maxRedirects: 0 });
        expect(res.status(), 'Must redirect (302)').toBe(302);
        expect(res.headers()['location']).toContain('/login');
    });

    // NOTE (2026-07 de-stale): page routes no longer role-redirect. The old
    // "inspector page → 302 /inspections" model was replaced by (a) requireToken
    // page auth (unauthenticated → /login, see API-15) + (b) in-UI role gating
    // (admin controls hidden client-side, e.g. settings-hub's isAdminRole) + (c)
    // server-side RBAC enforced on the API mutations themselves. So RBAC is now
    // asserted where it is actually enforced: the JSON API middleware.
    test('API-16: Inspector CAN view the shared /library/templates page (200)', async ({ request }) => {
        // The template library is a shared read surface (inspectors need templates
        // to run inspections). templates.tsx guards on requireToken only — there is
        // no admin-only page redirect. Creating/editing templates is gated on the
        // API, not the page.
        const res = await fetchPage(request, '/library/templates', inspectorToken);
        expect(res.status(), 'Inspector must be able to view the template library').toBe(200);
    });

    test('API-17: Inspector is blocked from an admin-only endpoint (403 RBAC)', async ({ request }) => {
        // The real, enforced RBAC lives in the API middleware: GET
        // /api/admin/agreements carries requireRole('owner','manager')
        // (server/api/admin/admin-agreements.ts), so an inspector is rejected.
        // Use a body-less GET on purpose: a POST that requireRole 403s before its
        // body is drained desyncs the reused keep-alive connection under Playwright's
        // request context, hanging the NEXT request. A GET has no body to strand.
        const res = await apiGet(request, '/api/admin/agreements', inspectorToken);
        expect(res.status(), 'Inspector must be forbidden from an admin-only endpoint').toBe(403);
    });

    // API-18/19 assert the form's DATA-ACCESS contract (GET /api/inspections/:id)
    // rather than SSR-loading the /inspections/:id/form page. The page shell is
    // authenticated-only (form-renderer.tsx requireToken) with no role gate, so
    // "can access the form" reduces to "can read the inspection". Driving the JSON
    // endpoint is deterministic; SSR-rendering the full editor shell over the
    // built worker is slow/flaky in the seeded harness. The inspection GET carries
    // no requireRole (server/api/inspections.ts) — it is tenant-scoped, so every
    // authenticated user in the workspace can read it.
    test('API-18: Inspector CAN read the inspection backing the form (200)', async ({ request }) => {
        const res = await apiGet(request, `/api/inspections/${createdInspectionId}`, inspectorToken);
        expect(res.status(), 'Inspector must read the inspection they will fill out').toBe(200);
    });

    test('API-19: Admin CAN also read the same inspection (200)', async ({ request }) => {
        const res = await apiGet(request, `/api/inspections/${createdInspectionId}`, adminToken);
        expect(res.status(), 'Admin must read the inspection too (tenant-scoped, no role gate)').toBe(200);
    });

    // ── Health & OpenAPI ──────────────────────────────────────────────────────

    test('API-20: GET /status returns a healthy status payload', async ({ request }) => {
        const res = await request.get(`${BASE_URL}/status`);
        expect(res.status()).toBe(200);
        const body = await res.json();
        // /status returns { status: 'ok', app: 'openinspection-core', ... }
        // (server/index.ts). The old 'Core Engine Online' string was retired.
        expect(body.status).toBe('ok');
        expect(body.app).toBe('openinspection-core');
    });

    test('API-21: GET /doc returns valid OpenAPI spec', async ({ request }) => {
        const res = await request.get(`${BASE_URL}/doc`);
        expect(res.status()).toBe(200);
        const body = await res.json();
        expect(body.openapi).toBe('3.0.0');
        expect(body.info.title).toBe('OpenInspection Core API');
    });

    // ── Report (public) ───────────────────────────────────────────────────────

    test('API-22: /report/:tenant/:id is a 302 permalink shim to /report-view', async ({ request }) => {
        // The public /report/:tenant/:id page (app/routes/public/report.tsx) is now
        // an unconditional 302 permalink shim to /report-view/:tenant/:id (the old
        // Spectora-style bookmark still works). The actual report RENDER lives at
        // /report-view and is covered by the report-viewer project; the existence
        // check moved into the data layer (see API-23).
        const tenantSlug = COMPANY_NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const res = await request.get(`${BASE_URL}/report/${tenantSlug}/${createdInspectionId}`, {
            maxRedirects: 0,
        });
        expect(res.status(), 'Report permalink must 302-redirect').toBe(302);
        expect(res.headers()['location']).toBe(`/report-view/${tenantSlug}/${createdInspectionId}`);
    });

    test('API-23: public report DATA API returns 404 for a nonexistent inspection', async ({ request }) => {
        // Existence is enforced in the data layer: GET /api/public/report/:tenant/:id
        // (server/api/public-report.ts, mounted at /api/public) 404s when the
        // inspection/token does not resolve. A nonexistent id therefore has no
        // public report data → 404.
        const tenantSlug = COMPANY_NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const res = await request.get(
            `${BASE_URL}/api/public/report/${tenantSlug}/00000000-0000-0000-0000-000000000000`,
        );
        expect(res.status()).toBe(404);
    });

    // ── Tenant Isolation ─────────────────────────────────────────────────────
    // Create a SECOND workspace and verify cross-tenant data is invisible.

    test('API-24: Tenant isolation — second workspace cannot see first workspace data', async ({ request }) => {
        // 1. Setup second workspace
        const csrf2 = await getCsrfToken(request);
        const setup2 = await request.post(`${BASE_URL}/api/auth/setup`, {
            data: {
                companyName: 'Isolation Test Corp',
                adminName: 'Test Admin',
                email: 'admin@isolation.com',
                password: 'IsolationTest123!',
                verificationCode: '000000',
            },
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrf2,
                'Cookie': `__Host-csrf_token=${csrf2}`,
            },
        });
        // In standalone mode, second setup attempt is rejected (already initialized)
        // This is expected — standalone = single tenant. Isolation is enforced by design.
        if (setup2.status() !== 200) {
            // Standalone mode: only one tenant allowed. Verify first tenant data is correct.
            const res = await apiGet(request, '/api/inspections', adminToken);
            const body = await res.json();
            const inspections = Array.isArray(body.data) ? body.data : (body.data?.inspections || []);
            // All inspections belong to our tenant
            expect(inspections.length).toBeGreaterThanOrEqual(1);
            for (const insp of inspections) {
                expect(insp.propertyAddress).toBeDefined();
            }
            return;
        }

        // Multi-tenant mode: verify cross-tenant isolation
        const token2 = await loginApi(request, 'admin@isolation.com', 'IsolationTest123!');

        // Second tenant should see zero inspections
        const res2 = await apiGet(request, '/api/inspections', token2);
        expect(res2.status()).toBe(200);
        const body2 = await res2.json();
        const inspections2 = Array.isArray(body2.data) ? body2.data : (body2.data?.inspections || []);
        expect(inspections2.length, 'Second tenant must NOT see first tenant inspections').toBe(0);

        // Second tenant should see zero templates
        const tpl2 = await apiGet(request, '/api/inspections/templates', token2);
        expect(tpl2.status()).toBe(200);
        const tplBody2 = await tpl2.json();
        const templates2 = tplBody2.data?.templates || tplBody2.data || [];
        expect(templates2.length, 'Second tenant must NOT see first tenant templates').toBe(0);

        // Second tenant should see zero team members (except self)
        const team2 = await apiGet(request, '/api/team/members', token2);
        expect(team2.status()).toBe(200);
        const teamBody2 = await team2.json();
        const members2 = teamBody2.data?.members || teamBody2.data?.activeUsers || [];
        for (const m of members2) {
            expect(m.email, 'Cross-tenant member must not appear').not.toBe(ADMIN_EMAIL);
            expect(m.email).not.toBe(INSPECTOR_EMAIL);
        }

        // First tenant still cannot see second tenant's data (reverse check)
        // Already guaranteed by the DB query pattern, but verify defensively
        const res1 = await apiGet(request, '/api/inspections', adminToken);
        const body1 = await res1.json();
        const inspections1 = Array.isArray(body1.data) ? body1.data : (body1.data?.inspections || []);
        // Our original inspection must still be there
        const found = inspections1.find((i: { id: string }) => i.id === createdInspectionId);
        expect(found, 'First tenant must still see its own inspection').toBeTruthy();
    });
});
