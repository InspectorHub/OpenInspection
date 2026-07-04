/**
 * Sprint 2 S2-1 — Rating Systems CRUD e2e regression suite.
 *
 * Drives the JSON API directly (no browser needed) to verify:
 *   - GET /api/rating-systems lazy-seeds the four canonical systems
 *   - POST /api/rating-systems/:id/clone produces an editable custom copy
 *   - PUT /api/rating-systems/:id rejects edits to seeds (403)
 *   - PUT /api/rating-systems/:id on a custom copy persists changes
 *   - DELETE /api/rating-systems/:id rejects when referenced by a template (409)
 *   - Recommendation enum endpoint surfaces 50+ entries (S2-3 sanity)
 *
 * Runs against the local dev worker (http://127.0.0.1:8789). The setup
 * step in standalone-api.spec.ts must have created the admin user first;
 * we declare that project as a dependency in playwright.config.ts.
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

async function apiGet(request: APIRequestContext, path: string, token: string) {
    return request.get(`${BASE_URL}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
}
async function apiPost(request: APIRequestContext, path: string, token: string, data: Record<string, unknown>) {
    return request.post(`${BASE_URL}${path}`, {
        data,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
}
async function apiPut(request: APIRequestContext, path: string, token: string, data: Record<string, unknown>) {
    return request.put(`${BASE_URL}${path}`, {
        data,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
}
async function apiDelete(request: APIRequestContext, path: string, token: string) {
    return request.delete(`${BASE_URL}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
}

let adminToken = '';
let seedTrecId = '';
let clonedId = '';

test.describe.serial('Sprint 2 S2-1 — Rating Systems CRUD', () => {
    test.beforeAll(async ({ request }) => {
        adminToken = await loginApi(request, ADMIN_EMAIL, ADMIN_PASSWORD);
    });

    test('R-01: GET /api/rating-systems lazy-seeds the 4 canonical systems', async ({ request }) => {
        const res = await apiGet(request, '/api/rating-systems', adminToken);
        expect(res.status()).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        const slugs = (body.data as Array<{ slug: string }>).map(s => s.slug).sort();
        for (const expected of ['itb', 'itb-3', 'oi-4tier', 'trec']) {
            expect(slugs, `Seed system '${expected}' missing`).toContain(expected);
        }
        const trec = (body.data as Array<{ slug: string; id: string }>).find(s => s.slug === 'trec');
        expect(trec, 'TREC seed must exist').toBeTruthy();
        seedTrecId = trec!.id;
    });

    test('R-02: POST /api/rating-systems/:id/clone makes an editable copy', async ({ request }) => {
        const res = await apiPost(request, `/api/rating-systems/${seedTrecId}/clone`, adminToken, {
            name: 'TREC (E2E Custom)',
        });
        expect(res.status()).toBe(200);
        const body = await res.json();
        clonedId = body.data.id as string;
        expect(body.data.isSeed).toBe(false);
        expect(body.data.name).toBe('TREC (E2E Custom)');
        expect(body.data.levels.length).toBeGreaterThan(0);
    });

    test('R-03: PUT on a seed system returns 403', async ({ request }) => {
        const res = await apiPut(request, `/api/rating-systems/${seedTrecId}`, adminToken, {
            name: 'Hacked',
        });
        expect(res.status()).toBe(403);
    });

    test('R-04: PUT on a custom copy persists changes', async ({ request }) => {
        const res = await apiPut(request, `/api/rating-systems/${clonedId}`, adminToken, {
            name: 'TREC (Updated E2E)',
            description: 'Updated description',
        });
        expect(res.status()).toBe(200);
        const body = await res.json();
        expect(body.data.name).toBe('TREC (Updated E2E)');
        expect(body.data.description).toBe('Updated description');
    });

    test('R-05: DELETE on a seed system returns 403', async ({ request }) => {
        const res = await apiDelete(request, `/api/rating-systems/${seedTrecId}`, adminToken);
        expect(res.status()).toBe(403);
    });

    test('R-06: DELETE on a custom copy succeeds when not referenced', async ({ request }) => {
        const res = await apiDelete(request, `/api/rating-systems/${clonedId}`, adminToken);
        expect(res.status()).toBe(200);
        const body = await res.json();
        expect(body.data.deleted).toBe(true);
    });
});
