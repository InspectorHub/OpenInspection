/**
 * Standalone Browser Tests
 *
 * Tests page rendering, UI interactions, and terminology via Playwright browser.
 * Uses setExtraHTTPHeaders for auth (HTTP env, __Host- cookies don't work in browser).
 *
 * Covers: Page rendering, UI components, form interactions, terminology/jargon checks
 * Run: npx playwright test tests/standalone-browser.spec.ts
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

// Jargon patterns to reject across all pages
const JARGON = [
    'Deploy Workflow', 'Dispatch', 'Authorize Completion', 'Logic Schema',
    'Personnel', 'Temporal Allocation', 'Digital Mail', 'Synchronizing Registry',
    'Analytical Synthesis', 'Protocol Interface', 'System Config', 'Operational Hub',
    'Document Registry', 'Internal Reference Name', 'Schedule Analysis', 'Legal Name',
];

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
        const tplRes = await apiPost(request, '/api/inspections/templates', adminToken, {
            name: 'Browser Test Template',
            schema: JSON.stringify([
                { id: 'roof', label: 'Roof', type: 'pass_fail' },
                { id: 'plumbing', label: 'Plumbing', type: 'pass_fail' },
            ]),
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

    // ── Login Page ────────────────────────────────────────────────────────────

    test('UI-01: Login page renders correctly', async ({ page }) => {
        await page.goto(`${BASE_URL}/login`, { timeout: NAV_TIMEOUT });
        await expect(page.locator('#email')).toBeVisible();
        await expect(page.locator('#password')).toBeVisible();
        await expect(page.locator('#submitBtn')).toBeVisible();
    });

    // ── Dashboard ─────────────────────────────────────────────────────────────

    test('UI-02: Dashboard renders stat cards', async ({ page }) => {
        await gotoAuth(page, '/dashboard', adminToken);
        for (const id of ['statActive', 'statProgress', 'statReview', 'statCompleted']) {
            await expect(page.locator(`#${id}`), `Stat card #${id} missing`).toBeVisible({ timeout: 10000 });
        }
        await expect(page.locator('#inspectionsList')).toBeVisible();
        await expect(page.locator('#filterSearch')).toBeVisible();
        await expect(page.locator('button:has-text("New Inspection")')).toBeVisible();
    });

    test('UI-03: Dashboard shows created inspection', async ({ page }) => {
        await gotoAuth(page, '/dashboard', adminToken);
        await page.waitForSelector('#inspectionsList tr:not(#loadingRow)', { timeout: 10000 });
        const row = page.locator('#inspectionsList tr', { hasText: '742 Evergreen Terrace' });
        await expect(row.first()).toBeVisible();
    });

    test('UI-04: Dashboard create modal has correct field labels', async ({ page }) => {
        await gotoAuth(page, '/dashboard', adminToken);
        await page.waitForSelector('#inspectionsList', { timeout: 10000 });
        await page.click('button:has-text("New Inspection")');
        await expect(page.locator('#createModal')).toBeVisible({ timeout: 5000 });

        await expect(page.locator('#propAddress')).toBeVisible();
        await expect(page.locator('#clientName')).toBeVisible();
        await expect(page.locator('#clientEmail')).toBeVisible();
        await expect(page.locator('#templateId')).toBeVisible();
        await expect(page.locator('#inspectorId')).toBeVisible();
        await expect(page.locator('#submitInsBtn')).toContainText('Create Inspection');
    });

    test('UI-05: Dashboard search filters inspections', async ({ page }) => {
        await gotoAuth(page, '/dashboard', adminToken);
        await page.waitForSelector('#inspectionsList tr:not(#loadingRow)', { timeout: 10000 });

        await page.fill('#filterSearch', 'Evergreen');
        await page.waitForTimeout(600); // debounce
        const match = page.locator('#inspectionsList tr', { hasText: 'Evergreen' });
        await expect(match.first()).toBeVisible();
    });

    // ── Templates Page ────────────────────────────────────────────────────────

    test('UI-06: Templates page shows created template', async ({ page }) => {
        await gotoAuth(page, '/templates', adminToken);
        await page.waitForSelector('#templatesList tr:not(#loadingRow)', { timeout: 10000 });
        const row = page.locator('#templatesList tr', { hasText: 'Browser Test Template' });
        await expect(row.first()).toBeVisible();
    });

    test('UI-07: Templates page uses standard terminology', async ({ page }) => {
        await gotoAuth(page, '/templates', adminToken);
        const createBtn = page.locator('button:has-text("New Template"), button:has-text("Create Template")');
        await expect(createBtn.first()).toBeVisible();

        await createBtn.first().click();
        await expect(page.locator('#createModal')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#submitTplBtn')).toContainText('Create Template');
    });

    // ── Team Page ─────────────────────────────────────────────────────────────

    test('UI-08: Team page loads members', async ({ page }) => {
        await gotoAuth(page, '/team', adminToken);
        await page.waitForSelector('#membersList tr', { timeout: 10000 });

        const rows = page.locator('#membersList tr');
        expect(await rows.count()).toBeGreaterThanOrEqual(1);

        const pageText = await page.locator('#membersList').textContent();
        expect(pageText).not.toContain('Synchronizing');
    });

    test('UI-09: Team invite modal uses standard terms', async ({ page }) => {
        await gotoAuth(page, '/team', adminToken);
        await page.waitForSelector('#membersList', { timeout: 10000 });

        await page.click('#openInviteModalBtn');
        await expect(page.locator('#inviteModal')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#inviteEmail')).toBeVisible();
        await expect(page.locator('#inviteRole')).toBeVisible();

        const roleTexts = await page.locator('#inviteRole option').allTextContents();
        expect(roleTexts).toContain('Admin');
        expect(roleTexts).toContain('Inspector');
        expect(roleTexts).toContain('Office Staff');
        for (const text of roleTexts) {
            expect(text, `Role "${text}" must not contain jargon`).not.toMatch(/Architect|Analysis Ops|Workflow/i);
        }
        await expect(page.locator('#submitInviteBtn')).toContainText('Send Invitation');
    });

    // ── Settings Page ─────────────────────────────────────────────────────────

    test('UI-10: Settings page has all sections', async ({ page }) => {
        await gotoAuth(page, '/settings', adminToken);
        await expect(page.locator('#siteName')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('#primaryColor')).toBeVisible();
        await expect(page.locator('#saveBrandingBtn')).toBeVisible();
        await expect(page.locator('#currentPassword')).toBeVisible();
        await expect(page.locator('#newPassword')).toBeVisible();
        await expect(page.locator('#confirmPassword')).toBeVisible();

        const headings = await page.locator('h2').allTextContents();
        for (const h of headings) {
            expect(h, `Settings heading "${h}" has jargon`).not.toMatch(/Protocol|Deploy|System Config/i);
        }
    });

    // ── Agreements Page ───────────────────────────────────────────────────────

    test('UI-11: Agreements page loads and uses standard terms', async ({ page }) => {
        await gotoAuth(page, '/agreements', adminToken);
        await expect(page.locator('#agreementsList')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('button:has-text("New Agreement")')).toBeVisible();

        const loadingText = await page.locator('#agreementsList').textContent();
        expect(loadingText).not.toContain('Document Registry');
    });

    // ── Booking Page (Public) ─────────────────────────────────────────────────

    test('UI-12: Booking page renders with standard terminology', async ({ page }) => {
        await page.goto(`${BASE_URL}/book`, { timeout: NAV_TIMEOUT });

        await expect(page.locator('#bookingForm')).toBeVisible();
        await expect(page.locator('input[name="address"]')).toBeVisible();
        await expect(page.locator('input[name="clientName"]')).toBeVisible();
        await expect(page.locator('input[name="clientEmail"]')).toBeVisible();
        await expect(page.locator('input[name="date"]')).toBeVisible();
        await expect(page.locator('#submitBtn')).toBeVisible();

        const pageText = await page.textContent('body');
        expect(pageText).not.toContain('Temporal Allocation');
        expect(pageText).not.toContain('Digital Mail');
        expect(pageText).not.toContain('Legal Name');
        expect(pageText).not.toContain('Schedule Analysis');
        await expect(page.locator('#submitBtn')).toContainText('Submit Request');
    });

    // ── Inspection Edit Page ──────────────────────────────────────────────────

    test('UI-13: Inspection edit page loads with Alpine data', async ({ page }) => {
        await gotoAuth(page, `/inspections/${createdInspectionId}/edit`, adminToken);
        expect(page.url()).toContain(`/inspections/${createdInspectionId}/edit`);
        await expect(page.locator('[x-data]')).toBeVisible({ timeout: 10000 });
        await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    });

    // ── Field Form (Inspector) ────────────────────────────────────────────────

    test('UI-14: Field form loads for inspector role', async ({ page }) => {
        await gotoAuth(page, `/inspections/${createdInspectionId}/form`, inspectorToken);
        expect(page.url()).toContain('/form');
        const content = await page.content();
        expect(content.length, 'Form page must have substantial content').toBeGreaterThan(1000);
    });

    // ── Report Page (Public) ──────────────────────────────────────────────────

    test('UI-15: Report page renders for valid inspection', async ({ page }) => {
        const res = await page.goto(`${BASE_URL}/report/${createdInspectionId}`, { timeout: NAV_TIMEOUT });
        expect(res?.status(), 'Report must return 200').toBe(200);
        const content = await page.content();
        expect(content).toContain('742 Evergreen Terrace');
    });

    // ── Full Jargon Scan ──────────────────────────────────────────────────────

    test('UI-16: No sci-fi jargon on any authenticated page', async ({ page }) => {
        const pagesToCheck = ['/dashboard', '/templates', '/team', '/settings', '/agreements'];

        for (const path of pagesToCheck) {
            await gotoAuth(page, path, adminToken);
            await page.waitForTimeout(500);
            const text = await page.textContent('body') || '';
            for (const jargon of JARGON) {
                expect(text, `"${jargon}" found on ${path}`).not.toContain(jargon);
            }
        }
    });
});
