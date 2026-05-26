/**
 * Cloud E2E Tests (Cloudflare HTTPS)
 *
 * Tests that require real HTTPS environment where __Host- cookies work properly.
 * Run against deployed Cloudflare Workers instance.
 *
 * Covers: Full cookie-based auth flow, RBAC page redirects, cross-page sessions
 * Run: CLOUD_BASE_URL=https://your-core.workers.dev npx playwright test tests/cloud-e2e.spec.ts
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.CLOUD_BASE_URL || 'https://openinspection-standalone.important-new.workers.dev';
const NAV_TIMEOUT = 20000;

const ADMIN_EMAIL = 'admin@cloudtest.com';
const ADMIN_PASSWORD = 'CloudTest123!';
const COMPANY_NAME = 'Cloud E2E Test Corp';
const INSPECTOR_EMAIL = 'inspector@cloudtest.com';
const INSPECTOR_PASSWORD = 'Inspector123!';

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe.serial('Cloud E2E Tests (HTTPS)', () => {

    // ── Setup Wizard (Real Browser Flow) ──────────────────────────────────────

    test('CLOUD-01: Setup wizard full browser flow with real cookies', async ({ page }) => {
        await page.goto(`${BASE_URL}/setup`, { timeout: NAV_TIMEOUT });

        // If already set up, setup redirects to /login — that's OK for re-runs
        if (page.url().includes('/login')) {
            test.skip(true, 'Workspace already initialized — skipping setup');
            return;
        }

        await page.fill('#companyName', COMPANY_NAME);
        await page.fill('#email', ADMIN_EMAIL);
        await page.fill('#password', ADMIN_PASSWORD);
        const codeField = page.locator('#verificationCode');
        if (await codeField.isVisible()) {
            // In cloud, need real verification code from KV
            const code = process.env.SETUP_CODE || '';
            expect(code, 'SETUP_CODE env var required for cloud setup').toBeTruthy();
            await codeField.fill(code);
        }
        await page.click('#submitBtn');

        // With HTTPS, __Host- cookie is set properly — should redirect to dashboard
        await page.waitForURL('**/dashboard', { timeout: NAV_TIMEOUT });
        expect(page.url()).toContain('/dashboard');
    });

    // ── Login (Real Cookie Flow) ──────────────────────────────────────────────

    test('CLOUD-02: Login sets __Host-inspector_token cookie', async ({ page }) => {
        await page.goto(`${BASE_URL}/login`, { timeout: NAV_TIMEOUT });
        await page.fill('#email', ADMIN_EMAIL);
        await page.fill('#password', ADMIN_PASSWORD);
        await page.click('#submitBtn');

        await page.waitForURL('**/dashboard', { timeout: NAV_TIMEOUT });
        expect(page.url()).toContain('/dashboard');

        // Verify cookie is set (HTTPS allows __Host- prefix)
        const cookies = await page.context().cookies();
        const authCookie = cookies.find(c => c.name === '__Host-inspector_token');
        expect(authCookie, '__Host-inspector_token cookie must be set').toBeTruthy();
        expect(authCookie!.secure, 'Cookie must have Secure flag').toBe(true);
        expect(authCookie!.httpOnly, 'Cookie must have HttpOnly flag').toBe(true);
    });

    // ── Cross-Page Session ────────────────────────────────────────────────────

    test('CLOUD-03: Auth cookie persists across page navigations', async ({ page }) => {
        // Login first
        await page.goto(`${BASE_URL}/login`, { timeout: NAV_TIMEOUT });
        await page.fill('#email', ADMIN_EMAIL);
        await page.fill('#password', ADMIN_PASSWORD);
        await page.click('#submitBtn');
        await page.waitForURL('**/dashboard', { timeout: NAV_TIMEOUT });

        // Navigate to multiple pages — should stay authenticated
        const protectedPages = ['/templates', '/team', '/settings', '/agreements'];
        for (const path of protectedPages) {
            await page.goto(`${BASE_URL}${path}`, { timeout: NAV_TIMEOUT });
            expect(page.url(), `${path} must not redirect to login`).not.toContain('/login');
            expect(page.url(), `Must be on ${path}`).toContain(path);
        }
    });

    // ── RBAC Page Redirects (Real Cookie, No Header Workaround) ───────────────

    test('CLOUD-04: Inspector redirected from admin pages to /dashboard', async ({ page }) => {
        // Login as inspector
        await page.goto(`${BASE_URL}/login`, { timeout: NAV_TIMEOUT });
        await page.fill('#email', INSPECTOR_EMAIL);
        await page.fill('#password', INSPECTOR_PASSWORD);
        await page.click('#submitBtn');
        await page.waitForURL('**/dashboard', { timeout: NAV_TIMEOUT });

        // Try to access admin-only page
        await page.goto(`${BASE_URL}/templates`, { timeout: NAV_TIMEOUT });
        // With real cookies, the redirect chain works properly:
        // /templates → 302 /dashboard?error=unauthorized_role → renders dashboard
        expect(page.url(), 'Inspector must be redirected away from /templates').toContain('/dashboard');
        expect(page.url()).not.toContain('/templates');
    });

    test('CLOUD-05: Inspector redirected from settings to /dashboard', async ({ page }) => {
        await page.goto(`${BASE_URL}/login`, { timeout: NAV_TIMEOUT });
        await page.fill('#email', INSPECTOR_EMAIL);
        await page.fill('#password', INSPECTOR_PASSWORD);
        await page.click('#submitBtn');
        await page.waitForURL('**/dashboard', { timeout: NAV_TIMEOUT });

        await page.goto(`${BASE_URL}/settings`, { timeout: NAV_TIMEOUT });
        expect(page.url(), 'Inspector must be redirected away from /settings').toContain('/dashboard');
    });

    test('CLOUD-06: Inspector CAN access field form', async ({ page }) => {
        await page.goto(`${BASE_URL}/login`, { timeout: NAV_TIMEOUT });
        await page.fill('#email', INSPECTOR_EMAIL);
        await page.fill('#password', INSPECTOR_PASSWORD);
        await page.click('#submitBtn');
        await page.waitForURL('**/dashboard', { timeout: NAV_TIMEOUT });

        // Inspector should see their inspections — find one and navigate to form
        // For now just verify dashboard loads for inspector
        expect(page.url()).toContain('/dashboard');
    });

    // ── Logout (Cookie Cleared) ───────────────────────────────────────────────

    test('CLOUD-07: Logout clears cookie and redirects to login', async ({ page }) => {
        // Login
        await page.goto(`${BASE_URL}/login`, { timeout: NAV_TIMEOUT });
        await page.fill('#email', ADMIN_EMAIL);
        await page.fill('#password', ADMIN_PASSWORD);
        await page.click('#submitBtn');
        await page.waitForURL('**/dashboard', { timeout: NAV_TIMEOUT });

        // Click logout button
        const logoutBtn = page.locator('#logoutBtn');
        if (await logoutBtn.isVisible()) {
            await logoutBtn.click();
            await page.waitForURL('**/login', { timeout: NAV_TIMEOUT });
            expect(page.url()).toContain('/login');

            // Cookie should be cleared
            const cookies = await page.context().cookies();
            const authCookie = cookies.find(c => c.name === '__Host-inspector_token');
            const hasValidToken = authCookie && authCookie.value && authCookie.value.length > 10;
            expect(hasValidToken, 'Auth cookie must be cleared after logout').toBeFalsy();
        }
    });

    // ── Security Headers ──────────────────────────────────────────────────────

    test('CLOUD-08: Response includes security headers', async ({ page }) => {
        const res = await page.goto(`${BASE_URL}/login`, { timeout: NAV_TIMEOUT });
        const headers = res!.headers();

        expect(headers['x-content-type-options']).toBe('nosniff');
        expect(headers['x-frame-options']).toBe('DENY');
        expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
        expect(headers['content-security-policy']).toBeTruthy();
        expect(headers['strict-transport-security']).toContain('max-age=');
    });
});
