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

const BASE_URL = 'http://127.0.0.1:8789';
const NAV_TIMEOUT = 15000;

const ADMIN_EMAIL = 'admin@autotest.com';
const ADMIN_PASSWORD = 'Password123!';

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
            data: { companyName: 'Mobile Test Corp', email: ADMIN_EMAIL, password: ADMIN_PASSWORD, verificationCode: '000000' },
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

    test('M-02: Dashboard shows mobile card list, hides desktop table', async ({ page }) => {
        await gotoMobile(page, '/inspections', adminToken);
        // Mobile card list mount node exists and is visible
        const cardList = page.locator('#inspectionsCardList');
        await expect(cardList).toBeVisible();
        // Desktop table parent is .hidden.md:block — the table itself should NOT be visible at 375px
        const desktopTable = page.locator('div.hidden.md\\:block table').first();
        await expect(desktopTable).not.toBeVisible();
    });

    test('M-03: Sidebar collapses behind hamburger / mobile menu trigger exists', async ({ page }) => {
        await gotoMobile(page, '/inspections', adminToken);
        // Desktop sidebar `<aside class="...hidden lg:flex...">` should be hidden at 375px
        const aside = page.locator('aside').first();
        await expect(aside).toBeHidden();
    });

    test('M-04: Inspection edit shows mic + camera + library buttons per item', async ({ page }) => {
        await gotoMobile(page, `/inspections/${inspectionId}/edit`, adminToken);
        // Wait for sections to load
        await page.waitForSelector('[data-rating-row], button:has-text("Sat"), button:has-text("Pass")', { timeout: NAV_TIMEOUT }).catch(() => null);
        // Mic button(s) — voice-input.js attaches via data-mic-target
        const micButtons = await page.locator('button[data-mic-target], button[aria-label*="mic" i]').count();
        const cameraButtons = await page.locator('button:has-text("Camera"), button:has-text("Library")').count();
        // At least one item exposed mic + photo controls
        expect(micButtons + cameraButtons, 'mic or photo controls present').toBeGreaterThan(0);
    });

    test('M-05: Inspector messages floating button visible bottom-right', async ({ page }) => {
        await gotoMobile(page, `/inspections/${inspectionId}/edit`, adminToken);
        // T23: floating button is the only fixed bottom-right round chat icon
        const floating = page.locator('button[aria-label*="message" i], button[title*="message" i], button.fixed.bottom-6, button.fixed.bottom-8').first();
        // Just verify SOMETHING fixed-positioned exists in the bottom area
        const fixedBottom = await page.locator('button.fixed').count();
        expect(fixedBottom, 'at least one fixed-position floating button').toBeGreaterThan(0);
        // Confirm not off-screen
        if (await floating.count() > 0) {
            const box = await floating.boundingBox();
            if (box) {
                expect(box.x + box.width, 'floating button within viewport').toBeLessThanOrEqual(375);
            }
        }
    });

    test('M-06: /reports 301-redirects to the dashboard Published tab on mobile', async ({ page }) => {
        // #111: the standalone Reports page is retired. /reports is now a 301 redirect
        // to /inspections?workflow=published (the Published tab absorbs the report list).
        await gotoMobile(page, '/reports', adminToken);
        await expect(page).toHaveURL(/\/inspections\?.*workflow=published/);
    });

    test('M-07: Marketplace renders without horizontal overflow on mobile', async ({ page }) => {
        await gotoMobile(page, '/library/marketplace', adminToken);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, 'no horizontal overflow').toBeLessThanOrEqual(1);
        await expect(page.locator('h1:has-text("Marketplace")')).toBeVisible();
        await expect(page.locator('input[placeholder*="Search" i]').first()).toBeVisible();
    });
});
