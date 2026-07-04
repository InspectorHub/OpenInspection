/**
 * Cloud E2E Tests (Cloudflare HTTPS) — prod-target smoke.
 *
 * Env-guarded: only collected when CLOUD_BASE_URL is set (see the `cloud`
 * project in playwright.config.ts). Runs against a deployed HTTPS instance
 * where __Host- cookies and HSTS actually apply.
 *
 * 2026-07 tests-reorg (user decision 2026-07-04): the RBAC / cookie / logout
 * cases were DELETED as duplicates of the request-level standalone-api suite,
 * which is migration-proof and asserts exact 302/Location:
 *   - CLOUD-04/05/06 inspector RBAC  ⊂ standalone-api API-16/17/18
 *   - CLOUD-02 login-sets-cookie     ≈ standalone-api API-02
 *   - CLOUD-07 logout                ≈ standalone-api API-13
 *   - CLOUD-01 setup wizard / CLOUD-03 cross-page session — Alpine #email/
 *     #submitBtn flows, covered by the standalone suite.
 * Only the genuinely cloud-only checks remain: security headers (need HTTPS)
 * and the __Host- cookie Secure/HttpOnly flags (can't be set over local HTTP).
 *
 * Run: CLOUD_BASE_URL=https://your-core.workers.dev npx playwright test
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.CLOUD_BASE_URL || 'https://openinspection-api.important-new.workers.dev';
const NAV_TIMEOUT = 20000;

const ADMIN_EMAIL = process.env.CLOUD_ADMIN_EMAIL || 'admin@cloudtest.com';
const ADMIN_PASSWORD = process.env.CLOUD_ADMIN_PASSWORD || 'CloudTest123!';

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe.serial('Cloud E2E Tests (HTTPS)', () => {

    // ── Security Headers (cloud-only — HSTS requires HTTPS) ────────────────────

    test('CLOUD-08: Response includes security headers', async ({ page }) => {
        const res = await page.goto(`${BASE_URL}/login`, { timeout: NAV_TIMEOUT });
        const headers = res!.headers();

        expect(headers['x-content-type-options']).toBe('nosniff');
        expect(headers['x-frame-options']).toBe('DENY');
        expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
        expect(headers['content-security-policy']).toBeTruthy();
        expect(headers['strict-transport-security']).toContain('max-age=');
    });

    // ── __Host- cookie flags (cloud-only — the __Host- prefix + Secure flag
    //    can only be set over real HTTPS) ─────────────────────────────────────

    test('CLOUD-COOKIE: login sets a Secure, HttpOnly __Host-inspector_token', async ({ page }) => {
        await page.goto(`${BASE_URL}/login`, { timeout: NAV_TIMEOUT });
        // Live RR v7 login form (app/routes/login.tsx): conform field names +
        // a type=submit button — NOT the retired Alpine #email/#submitBtn.
        await page.fill('input[name="email"]', ADMIN_EMAIL);
        await page.fill('input[name="password"]', ADMIN_PASSWORD);
        await page.click('button[type="submit"]');
        await page.waitForURL('**/inspections', { timeout: NAV_TIMEOUT });

        const cookies = await page.context().cookies();
        const authCookie = cookies.find((c) => c.name === '__Host-inspector_token');
        expect(authCookie, '__Host-inspector_token cookie must be set').toBeTruthy();
        expect(authCookie!.secure, 'Cookie must have Secure flag').toBe(true);
        expect(authCookie!.httpOnly, 'Cookie must have HttpOnly flag').toBe(true);
    });
});
