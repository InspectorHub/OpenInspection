/**
 * Standalone Mobile Tests
 *
 * Validates the inspector-eval P0 mobile expectations on a real
 * 375x812 viewport (iPhone-class). Reuses the seed data created by
 * standalone-browser.spec.ts (SETUP test) so the test suite runs
 * after the browser project.
 *
 * Run: npx playwright test tests/standalone-mobile.spec.ts
 */
import { test, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { makeCsrfToken } from './helpers/csrf';
import { COMPANY_NAME } from './helpers/tenant-identity';

const BASE_URL = 'http://127.0.0.1:8789';
const NAV_TIMEOUT = 15000;

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
    expect(res.status()).toBe(200);
    const cookie = res.headers()['set-cookie'] ?? '';
    const match = cookie.match(/__Host-inspector_token=([^;]+)/);
    return match?.[1] ?? '';
}

async function gotoMobile(page: Page, path: string, token: string) {
    await page.setExtraHTTPHeaders({ 'Cookie': `__Host-inspector_token=${token}` });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${BASE_URL}${path}`, { timeout: NAV_TIMEOUT, waitUntil: 'networkidle' });
}

test.describe.serial('Standalone Mobile (iPhone 375x812)', () => {
    let adminToken = '';
    let inspectionId = '';

    test('SETUP: workspace + login + ensure 1 inspection exists', async ({ request }) => {
        // Idempotent setup so this project can run standalone (without depending on
        // the api project's SETUP test).
        const csrf = await getCsrfToken(request);
        await request.post(`${BASE_URL}/api/auth/setup`, {
            data: { companyName: COMPANY_NAME, adminName: 'Test Admin', email: ADMIN_EMAIL, password: ADMIN_PASSWORD, verificationCode: '000000' },
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, 'Cookie': `__Host-csrf_token=${csrf}` },
        });
        adminToken = await loginApi(request, ADMIN_EMAIL, ADMIN_PASSWORD);

        let res = await request.get(`${BASE_URL}/api/inspections`, {
            headers: { Authorization: `Bearer ${adminToken}` },
        });
        let list = (await res.json()).data || [];

        if (list.length === 0) {
            // Create a template + inspection so the mobile UI tests have something to render
            const tplRes = await request.post(`${BASE_URL}/api/inspections/templates`, {
                data: {
                    name: 'Mobile Test Template',
                    schema: {
                        schemaVersion: 2,
                        sections: [{
                            id: 's_general',
                            title: 'General',
                            items: [{
                                id: 'roof', label: 'Roof', type: 'rich',
                                ratingOptions: ['Inspected', 'Repair'],
                                tabs: { information: [], limitations: [], defects: [] },
                            }],
                        }],
                    },
                },
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
            });
            const tplId = (await tplRes.json()).data?.template?.id;
            await request.post(`${BASE_URL}/api/inspections`, {
                data: { propertyAddress: '742 Evergreen Terrace, Springfield', clientName: 'Homer Simpson', clientEmail: 'homer@springfield.com', templateId: tplId },
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
            });
            res = await request.get(`${BASE_URL}/api/inspections`, { headers: { Authorization: `Bearer ${adminToken}` } });
            list = (await res.json()).data || [];
        }

        expect(list.length, 'need at least one inspection').toBeGreaterThan(0);
        inspectionId = list[0].id;
    });

    test('M-01: Login renders without horizontal scroll', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 812 });
        await page.goto(`${BASE_URL}/login`, { timeout: NAV_TIMEOUT });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, 'no horizontal overflow').toBeLessThanOrEqual(1);
        await expect(page.locator('input[type="email"]')).toBeVisible();
        await expect(page.locator('input[type="password"]')).toBeVisible();
    });

    // M-02 deleted in the 2026-07 tests-reorg de-stale: keyed off the Alpine
    // `#inspectionsCardList` mount node (removed in the RR v7 migration). The
    // mobile/desktop responsive split is exercised request-agnostically by
    // public-pages-responsive.spec.ts.

    test('M-03: Sidebar collapses behind hamburger / mobile menu trigger exists', async ({ page }) => {
        await gotoMobile(page, '/inspections', adminToken);
        // Desktop sidebar `<aside class="...hidden lg:flex...">` should be hidden at 375px
        const aside = page.locator('aside').first();
        await expect(aside).toBeHidden();
    });

    // M-04 deleted in the 2026-07 tests-reorg de-stale: keyed off Alpine editor
    // markup (`[data-rating-row]`, `button[data-mic-target]` attached by the
    // retired voice-input.js) that no longer exists in the RR v7 editor.

    // M-05 deleted (2026-08 skip-debt clearance): an EMPTY skip placeholder
    // (`async () => {}`) for the Alpine mobile message FAB the RR migration
    // removed. It asserted nothing and could never be unskipped — it only
    // inflated the skip count. Coverage of the live editor-shell message FAB
    // belongs in a spec written against that shell.

    // M-06 deleted in the 2026-07 tests-reorg dedup: the /reports 301 redirect is
    // covered more strongly by inspector-portal.spec.ts (raw 301 + exact Location
    // + active-tab styling). A server-side redirect is viewport-independent, so
    // there is nothing mobile-specific left to assert.

    // M-07 deleted (2026-08-11): it asserted that /library/marketplace renders,
    // which stopped being true for standalone in the same round this spec last
    // ran green. The content marketplace is a hosted-only surface — the loader
    // throws 404 when `hasContentMarketplace` is false — so there is no
    // standalone page whose mobile layout could overflow.
    //
    // Deleted rather than rewritten for the reason M-06 was: a server-side gate
    // is viewport-independent, so nothing about it belongs in a mobile spec. The
    // assertion moved to standalone-api.spec.ts (API-25), where it is stronger —
    // it sends a VALID admin token, so a 404 can only be the capability and not
    // a permission.
    //
    // Worth noting how long this hid: the run that first exposed it had 151
    // specs that never executed, because globalSetup swallowed a failed
    // migration. This one was among them.
});
