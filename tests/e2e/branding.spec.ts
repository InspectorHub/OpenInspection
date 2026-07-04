/**
 * Branding / white-labeling E2E (RR v7).
 *
 * De-staled in the 2026-07 tests-reorg: the old spec drove the Alpine setup
 * wizard (#companyName / #adminEmail / #setupBtn), the Alpine settings form
 * (#primaryColor / #logoInput / #brandingBtn), and asserted the retired
 * `--color-primary` CSS var. All of those are gone in the RR v7 app. This
 * rebinds to the live Company settings route (app/routes/settings-workspace.tsx,
 * mounted at /settings/workspace) and the live design-system `--ih-primary`
 * token. The heavy logo-upload → R2 → booking-header propagation leg was dropped
 * (needs a real R2 round-trip that can't run deterministically in the seeded
 * suite) — see the TODO below.
 *
 * Auth: API login → __Host-inspector_token replayed as a cookie header (the
 * merged suite serves the built worker over plain HTTP; see other e2e specs).
 */
import { test, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { makeCsrfToken } from './helpers/csrf';

const BASE_URL = 'http://127.0.0.1:8789';
const NAV_TIMEOUT = 20000;

// Single-tenant standalone allows exactly one workspace, initialized by the
// `api` project's SETUP (admin@autotest.com). Branding logs in as that shared
// admin — a second admin can't be created — and asserts the live company
// settings + design-system token surface.
const ADMIN_EMAIL = 'admin@autotest.com';
const ADMIN_PASSWORD = 'Password123!';
const COMPANY_NAME = 'Branding Corp';

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
            Cookie: `__Host-csrf_token=${csrf}`,
        },
    });
    expect(res.status(), 'Login failed: expected 200').toBe(200);
    const setCookie = res.headers()['set-cookie'] ?? '';
    return setCookie.match(/__Host-inspector_token=([^;]+)/)?.[1] ?? '';
}

async function gotoAuth(page: Page, path: string, token: string) {
    await page.setExtraHTTPHeaders({ Cookie: `__Host-inspector_token=${token}` });
    await page.goto(`${BASE_URL}${path}`, { timeout: NAV_TIMEOUT, waitUntil: 'networkidle' });
}

test.describe.serial('Branding System E2E', () => {
    let adminToken = '';

    test('SETUP: ensure workspace + admin', async ({ request }) => {
        const csrf = await getCsrfToken(request);
        await request.post(`${BASE_URL}/api/auth/setup`, {
            data: { companyName: COMPANY_NAME, adminName: 'Test Admin', email: ADMIN_EMAIL, password: ADMIN_PASSWORD, verificationCode: '000000' },
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, Cookie: `__Host-csrf_token=${csrf}` },
        });
        adminToken = await loginApi(request, ADMIN_EMAIL, ADMIN_PASSWORD);
        expect(adminToken, 'admin token').toBeTruthy();
    });

    test('Company settings expose the live branding controls', async ({ page }) => {
        await gotoAuth(page, '/settings/workspace', adminToken);
        // Live company-name input (conform field name, settings-workspace.tsx:177).
        await expect(page.locator('input[name="companyName"]')).toBeVisible({ timeout: 10000 });
        // Live primary-color picker (settings-workspace.tsx:185-192).
        await expect(page.locator('input[type="color"][name="primaryColor"]')).toBeVisible();
        // Live save affordance (settings-workspace.tsx:366-369).
        await expect(page.getByRole('button', { name: 'Save Company' })).toBeVisible();
    });

    test('design-system --ih-primary token is injected on the document root', async ({ page }) => {
        await gotoAuth(page, '/settings/workspace', adminToken);
        // The retired `--color-primary` var was replaced by the DS token
        // `--ih-primary` (app/styles/tailwind.css). It must resolve to a real
        // color, not empty.
        const primary = await page.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue('--ih-primary').trim(),
        );
        expect(primary.length, '--ih-primary must resolve to a value').toBeGreaterThan(0);
    });

    // TODO(tests-reorg): re-add the logo-upload → R2 → booking-header
    // propagation leg. It needs a deterministic R2 round-trip (Settings →
    // Company logo upload via app/components/media-studio/LogoUploader, then
    // the nav/booking header logo). Reinstate once the seeded suite has a
    // stable R2 binding + fixture.
    test.skip('branding propagates a real uploaded logo to nav + booking header', async () => {});
});
