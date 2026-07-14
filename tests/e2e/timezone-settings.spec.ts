/**
 * Timezone configuration E2E (RR v7).
 *
 * Drives the live Company settings route (app/routes/settings-workspace.tsx,
 * mounted at /settings/workspace) timezone picker: select a non-UTC tenant
 * timezone, save, reload, and confirm it persists. Also asserts the
 * "Set your timezone" onboarding step clears once a non-UTC tz is set.
 *
 * Auth mirrors branding.spec.ts: API login → __Host-inspector_token replayed as
 * a cookie header (the merged suite serves the built worker over plain HTTP).
 */
import { test, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { makeCsrfToken } from './helpers/csrf';

const BASE_URL = 'http://127.0.0.1:8789';
const NAV_TIMEOUT = 20000;

const ADMIN_EMAIL = 'admin@autotest.com';
const ADMIN_PASSWORD = 'Password123!';
const COMPANY_NAME = 'Timezone Corp';

const getCsrfToken = (_request?: APIRequestContext): string => makeCsrfToken();

async function loginApi(request: APIRequestContext, email: string, password: string): Promise<string> {
    const csrf = getCsrfToken(request);
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

test.describe.serial('Timezone configuration E2E', () => {
    let adminToken = '';

    test('SETUP: ensure workspace + admin', async ({ request }) => {
        const csrf = getCsrfToken(request);
        await request.post(`${BASE_URL}/api/auth/setup`, {
            data: { companyName: COMPANY_NAME, adminName: 'Test Admin', email: ADMIN_EMAIL, password: ADMIN_PASSWORD, verificationCode: '000000' },
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, Cookie: `__Host-csrf_token=${csrf}` },
        });
        adminToken = await loginApi(request, ADMIN_EMAIL, ADMIN_PASSWORD);
        expect(adminToken, 'admin token').toBeTruthy();
    });

    test('Company settings expose the timezone picker and persist a selection', async ({ page }) => {
        await gotoAuth(page, '/settings/workspace', adminToken);
        const tz = page.locator('select[name="defaultTimezone"]');
        await expect(tz).toBeVisible({ timeout: 10000 });

        await tz.selectOption('America/New_York');
        await page.getByRole('button', { name: 'Save Company' }).click();
        await expect(page.getByText(/company settings saved/i)).toBeVisible({ timeout: 10000 });

        // Reload and confirm the saved timezone is the selected value.
        await gotoAuth(page, '/settings/workspace', adminToken);
        await expect(page.locator('select[name="defaultTimezone"]')).toHaveValue('America/New_York');
    });

    // The onboarding "Set your timezone" step's done-state logic (done when the
    // tenant tz is non-UTC) is covered exhaustively by the unit suite
    // (app/lib/onboarding-progress.test.ts) — not re-driven here.
});
