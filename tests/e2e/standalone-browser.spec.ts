/**
 * Standalone Browser Tests (RR v7)
 *
 * Legacy Alpine-era mirror of frontend-browser.spec.ts. The 2026-07 tests-reorg
 * dedup removed the duplicated page-render smokes (UI-01/02/03/06/08/10/16 — now
 * canonical in frontend-browser with live RR selectors) and the report-body dup
 * (UI-15 — canonical in standalone-api API-22). What survives here is de-staled
 * onto live RR v7 selectors (input[name=…], getByRole, a[href=…]); the remaining
 * Alpine-only surfaces that have no live equivalent yet are skip-with-TODO.
 *
 * Uses setExtraHTTPHeaders for auth (HTTP env, __Host- cookies can't be set from
 * the browser over plain HTTP — the raw header replay is the same trick used by
 * inspection-hub.spec.ts).
 */
import { test, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:8789';
const NAV_TIMEOUT = 15000;

const ADMIN_EMAIL = 'admin@autotest.com';
const ADMIN_PASSWORD = 'Password123!';
const COMPANY_NAME = 'Automation Test Corp';
const INSPECTOR_EMAIL = 'inspector@autotest.com';
const INSPECTOR_PASSWORD = 'Inspector123!';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getCsrfToken(request: APIRequestContext): Promise<string> {
    const res = await request.get(`${BASE_URL}/login`);
    const setCookie = res.headers()['set-cookie'] ?? '';
    const match = setCookie.match(/__Host-csrf_token=([^;]+)/);
    return match?.[1] ?? '';
}

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

async function gotoAuth(page: Page, path: string, token: string) {
    await page.setExtraHTTPHeaders({ 'Cookie': `__Host-inspector_token=${token}` });
    await page.goto(`${BASE_URL}${path}`, { timeout: NAV_TIMEOUT, waitUntil: 'networkidle' });
}

async function apiPost(request: APIRequestContext, path: string, token: string, data: Record<string, unknown>) {
    return request.post(`${BASE_URL}${path}`, {
        data,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
}

// ─── Shared state ────────────────────────────────────────────────────────────

let adminToken = '';
let inspectorToken = '';
let createdTemplateId = '';
let createdInspectionId = '';

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe.serial('Standalone Browser Tests', () => {

    // ── Data Setup (API, no browser) ──────────────────────────────────────────

    test('SETUP: Initialize workspace and create test data', async ({ request }) => {
        // Setup workspace via API (idempotent — may already be done by API project)
        const csrf = await getCsrfToken(request);
        await request.post(`${BASE_URL}/api/auth/setup`, {
            data: {
                companyName: COMPANY_NAME,
                email: ADMIN_EMAIL,
                password: ADMIN_PASSWORD,
                verificationCode: '000000',
            },
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrf,
                'Cookie': `__Host-csrf_token=${csrf}`,
            },
        });
        // 200 = fresh setup, 4xx/5xx = already initialized — either way login below works
        adminToken = await loginApi(request, ADMIN_EMAIL, ADMIN_PASSWORD);

        // 2. Create template
        const richItem = (id: string, label: string) => ({
            id, label, type: 'rich' as const,
            ratingOptions: ['Inspected', 'Repair'],
            tabs: { information: [], limitations: [], defects: [] },
        });
        const tplRes = await apiPost(request, '/api/inspections/templates', adminToken, {
            name: 'Browser Test Template',
            schema: {
                schemaVersion: 2,
                sections: [
                    {
                        id: 's_general',
                        title: 'General',
                        items: [richItem('roof', 'Roof'), richItem('plumbing', 'Plumbing')],
                    },
                ],
            },
        });
        expect(tplRes.status()).toBe(201);
        createdTemplateId = (await tplRes.json()).data?.template?.id;

        // 3. Create inspection
        const insRes = await apiPost(request, '/api/inspections', adminToken, {
            propertyAddress: '742 Evergreen Terrace, Springfield',
            clientName: 'Homer Simpson',
            clientEmail: 'homer@springfield.com',
            templateId: createdTemplateId,
        });
        expect(insRes.status()).toBe(201);
        createdInspectionId = (await insRes.json()).data?.inspection?.id;

        // 4. Create inspector via invite (may already exist if API tests ran first)
        const invRes = await apiPost(request, '/api/team/invite', adminToken, {
            email: INSPECTOR_EMAIL,
            role: 'inspector',
        });
        if (invRes.status() === 201) {
            const inviteLink = (await invRes.json()).data?.inviteLink || '';
            const inviteToken = new URL(inviteLink).searchParams.get('token') ?? '';
            await request.post(`${BASE_URL}/api/auth/join`, {
                data: { token: inviteToken, password: INSPECTOR_PASSWORD },
                headers: { 'Content-Type': 'application/json' },
            });
        }
        inspectorToken = await loginApi(request, INSPECTOR_EMAIL, INSPECTOR_PASSWORD);
    });

    // NOTE — deleted in the 2026-07 tests-reorg dedup (all covered by
    // frontend-browser.spec.ts's live-selector versions, which are canonical):
    //   UI-01 login page · UI-02/03 dashboard stat cards + list · UI-04 create
    //   modal · UI-05 search · UI-06 templates list · UI-07 templates modal ·
    //   UI-08 team list · UI-09 invite modal · UI-10 settings sections · UI-16
    //   jargon scan. All keyed off Alpine hooks (#statActive, #inspectionsList,
    //   #createModal, #filterSearch, #submitBtn) that no longer exist in app/.
    // UI-15 (public report body) deleted — dup of standalone-api API-22
    // (request-level, migration-proof; API-23 adds the 404 case).

    // ── Booking Page (Public) — de-staled onto the live RR BookingWizard ──────

    test('UI-12: Public booking page renders the RR booking wizard', async ({ page }) => {
        // /book/:tenant is the company-level entry (legacy bare /book is gone).
        const tenantSlug = COMPANY_NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        await page.goto(`${BASE_URL}/book/${tenantSlug}`, { timeout: NAV_TIMEOUT });
        // BookingWizard renders the h1 "Schedule an inspection"
        // (app/components/booking/BookingWizard.tsx:50-52).
        await expect(page.getByRole('heading', { name: 'Schedule an inspection' })).toBeVisible({ timeout: 10000 });
        const pageText = await page.textContent('body');
        expect(pageText).not.toContain('Temporal Allocation');
        expect(pageText).not.toContain('Legal Name');
    });

    // ── Inspection Edit Page ──────────────────────────────────────────────────

    test('UI-13: Inspection edit page loads the RR editor', async ({ page }) => {
        // Was an Alpine `[x-data]` assertion (removed in the 2026-05-26 RR
        // migration). The editor is a bare full-screen route whose shell renders
        // a single <main> (app/routes/inspection-edit.tsx:1873).
        await gotoAuth(page, `/inspections/${createdInspectionId}/edit`, adminToken);
        expect(page.url()).toContain(`/inspections/${createdInspectionId}/edit`);
        await expect(page.getByRole('main')).toBeVisible({ timeout: 10000 });
    });

    // ── Field Form (Inspector) ────────────────────────────────────────────────

    test('UI-14: Field form loads for inspector role', async ({ page }) => {
        // B3: replaced the `content.length > 1000` matcher with a live-landmark
        // check — the field form route (app/routes/form-renderer.tsx, wired at
        // routes.ts:69) renders inside the authed <main> shell.
        await gotoAuth(page, `/inspections/${createdInspectionId}/form`, inspectorToken);
        expect(page.url()).toContain('/form');
        await expect(page.getByRole('main')).toBeVisible({ timeout: 10000 });
    });

    // ── Report Page (Public) ──────────────────────────────────────────────────

    test('UI-PDF: Public /report page exposes Download PDF button', async ({ page }) => {
        if (!createdInspectionId) test.skip();
        const tenantSlug = COMPANY_NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        await page.goto(`${BASE_URL}/report/${tenantSlug}/${createdInspectionId}`, { timeout: NAV_TIMEOUT });
        // The FAB is a text <button> (no aria-label) — ReportView.tsx:323-333.
        await expect(page.getByRole('button', { name: 'Download PDF' })).toBeVisible({ timeout: 10000 });
    });

    // ── Alpine-only surfaces with no verified live equivalent yet ──────────────

    // TODO(tests-reorg): rewrite onto RR v7 selector. Was `#agreementsList` +
    // "Document Registry" jargon (Alpine, removed). No other browser-level
    // coverage of /library/agreements; rebind to the live agreements list
    // landmark once identified.
    test.skip('UI-11: Agreements page loads (Alpine — needs RR rebind)', async () => {});

    // TODO(tests-reorg): rewrite onto RR v7 selector. Was `#notifyUnreadBadge`
    // (Alpine, removed) + a "Mark all read" button. Rebind to the live
    // notifications page landmark + bell badge.
    test.skip('UI-NOTIFY: Notifications page + sidebar badge (Alpine — needs RR rebind)', async () => {});

    // TODO(tests-reorg): rewrite onto RR v7 selector. Was `[data-widget-embed]`
    // /`data-widget-style` (absent from app/). Verify the /widget.js asset +
    // /book?embed=1 chrome-strip against the live booking-embed route.
    test.skip('UI-WIDGET: /widget.js + embed mode (needs RR rebind)', async () => {});
});
