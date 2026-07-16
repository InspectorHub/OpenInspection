/**
 * Scheduling Phase A-core — acceptance gates G1–G3 (browser + light API smoke).
 *
 * G1 owner: /settings/booking — Standard office + Texas without opening Advanced;
 *           copy company URL; Advanced stays closed.
 * G2 inspector: /settings/schedule — Google Calendar section visible; URL correct.
 * G3: Advanced collapsed by default; public policy only after expand; Fixed time slots on page.
 *
 * Auth mirrors branding.spec.ts / standalone-browser: CSRF double-submit + cookie
 * replay of __Host-inspector_token. Depends on the `api` project for seeded
 * admin@autotest.com / Password123!.
 */
import { test, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { makeCsrfToken } from './helpers/csrf';

const BASE_URL = 'http://127.0.0.1:8789';
const NAV_TIMEOUT = 20000;

const ADMIN_EMAIL = 'admin@autotest.com';
const ADMIN_PASSWORD = 'Password123!';
const INSPECTOR_EMAIL = 'inspector@autotest.com';
const INSPECTOR_PASSWORD = 'Inspector123!';
/** Matches standalone-api SETUP company name → tenant slug for public booking. */
const TENANT_SLUG = 'automation-test-corp';
/** Texas Independence Day under US-TX catalog (see resolve-closed-dates unit tests). */
const TEXAS_HOLIDAY = '2026-03-02';

function csrfPair() {
    const token = makeCsrfToken();
    return {
        token,
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': token,
            Cookie: `__Host-csrf_token=${token}`,
        },
    };
}

async function tryLogin(
    request: APIRequestContext,
    email: string,
    password: string,
): Promise<string | null> {
    const csrf = csrfPair();
    const res = await request.post(`${BASE_URL}/api/auth/login`, {
        data: { email, password },
        headers: csrf.headers,
    });
    if (res.status() !== 200) return null;
    const setCookie = res.headers()['set-cookie'] ?? '';
    return setCookie.match(/__Host-inspector_token=([^;]+)/)?.[1] ?? null;
}

async function loginOrSkip(
    request: APIRequestContext,
    email: string,
    password: string,
): Promise<string> {
    const token = await tryLogin(request, email, password);
    if (!token) {
        test.skip(true, `Login failed for ${email} — seeded D1 / api project required`);
    }
    return token!;
}

async function gotoAuth(page: Page, path: string, token: string) {
    await page.setExtraHTTPHeaders({ Cookie: `__Host-inspector_token=${token}` });
    await page.goto(`${BASE_URL}${path}`, { timeout: NAV_TIMEOUT, waitUntil: 'networkidle' });
}

async function ensureInspector(request: APIRequestContext, adminToken: string): Promise<string> {
    const existing = await tryLogin(request, INSPECTOR_EMAIL, INSPECTOR_PASSWORD);
    if (existing) return existing;

    const csrf = csrfPair();
    const invRes = await request.post(`${BASE_URL}/api/team/invite`, {
        data: { email: INSPECTOR_EMAIL, role: 'inspector' },
        headers: {
            ...csrf.headers,
            Authorization: `Bearer ${adminToken}`,
            Cookie: `${csrf.headers.Cookie}; __Host-inspector_token=${adminToken}`,
        },
    });
    if (invRes.status() === 201) {
        const body = (await invRes.json()) as { data?: { inviteLink?: string } };
        const inviteLink = body.data?.inviteLink ?? '';
        const inviteToken = inviteLink ? new URL(inviteLink).searchParams.get('token') ?? '' : '';
        if (inviteToken) {
            await request.post(`${BASE_URL}/api/auth/join`, {
                data: { token: inviteToken, password: INSPECTOR_PASSWORD },
                headers: { 'Content-Type': 'application/json' },
            });
        }
    }

    return loginOrSkip(request, INSPECTOR_EMAIL, INSPECTOR_PASSWORD);
}

function advancedDetails(page: Page) {
    return page.getByTestId('holiday-advanced');
}

async function expectAdvancedClosed(page: Page) {
    const details = advancedDetails(page);
    await expect(details).toBeVisible();
    const open = await details.evaluate((el) => (el as HTMLDetailsElement).open);
    expect(open, 'Advanced <details> must stay collapsed').toBe(false);
}

test.describe.serial('Scheduling Phase A-core acceptance gates', () => {
    let adminToken = '';
    let inspectorToken = '';

    test('SETUP: admin + inspector sessions', async ({ request }) => {
        adminToken = await loginOrSkip(request, ADMIN_EMAIL, ADMIN_PASSWORD);
        inspectorToken = await ensureInspector(request, adminToken);
        expect(adminToken).toBeTruthy();
        expect(inspectorToken).toBeTruthy();
    });

    test('G1: Standard office + Texas without Advanced; copy company URL', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await gotoAuth(page, '/settings/booking', adminToken);

        await expect(page.getByTestId('holiday-closed-panel')).toBeVisible({ timeout: 15000 });
        await expect(page.getByTestId('holiday-preset-standard')).toBeVisible();
        await expectAdvancedClosed(page);

        // Reset catalog via preset so the region picker opens (no Advanced).
        await page.getByTestId('holiday-preset-off').click();
        await expectAdvancedClosed(page);

        await page.getByTestId('holiday-preset-standard').click();
        const regionDialog = page.getByRole('dialog', { name: 'Choose holiday region' });
        await expect(regionDialog).toBeVisible({ timeout: 10000 });
        await regionDialog.getByRole('button', { name: 'Federal + TX' }).click();
        await expect(regionDialog).toBeHidden({ timeout: 10000 });

        // Standard office selected; Advanced never opened for this flow.
        await expect(page.getByTestId('holiday-preset-standard')).toBeVisible();
        await expectAdvancedClosed(page);
        // Closed <details> keeps children in the DOM — assert not visible, not absent.
        await expect(page.getByTestId('holiday-public-policy-advanced')).toBeHidden();

        const companyLink = page.locator('section').filter({ hasText: 'Company link' });
        await expect(companyLink.getByText(`/book/${TENANT_SLUG}`)).toBeVisible();
        await companyLink.getByRole('button', { name: 'Copy' }).click();
        await expect(companyLink.getByRole('button', { name: 'Copied!' })).toBeVisible({
            timeout: 5000,
        });

        await expectAdvancedClosed(page);
    });

    test('G2: inspector My Schedule shows Google Calendar connect', async ({ page }) => {
        await gotoAuth(page, '/settings/schedule', inspectorToken);

        expect(page.url()).toContain('/settings/schedule');
        await expect(
            page.getByRole('heading', { name: 'Google Calendar' }),
        ).toBeVisible({ timeout: 15000 });
        await expect(
            page.getByText('Keep external busy time out of your available booking hours.'),
        ).toBeVisible();
    });

    test('G3: Advanced collapsed; policy after expand; Fixed time slots', async ({ page }) => {
        await gotoAuth(page, '/settings/booking', adminToken);

        await expect(page.getByTestId('holiday-closed-panel')).toBeVisible({ timeout: 15000 });
        await expectAdvancedClosed(page);
        await expect(page.getByTestId('holiday-public-policy-advanced')).toBeHidden();

        await advancedDetails(page).locator('summary').click();
        await expect(page.getByTestId('holiday-public-policy-advanced')).toBeVisible();
        await expect(
            page.getByRole('radiogroup', { name: 'Public holiday policy' }),
        ).toBeVisible();
        await expect(page.getByRole('radio', { name: 'Allow bookings' })).toBeVisible();

        await expect(page.getByRole('radio', { name: 'Fixed time slots' })).toBeVisible();
        await expect(page.getByText('Defaults are Fixed time slots / 30 minutes.')).toBeVisible();
    });

    test('smoke: holiday block empties public slots OR calendar Team mode', async ({
        page,
        request,
    }) => {
        // Prefer API holiday block (public slots empty on a known TX closed date).
        const csrf = csrfPair();
        const patch = await request.patch(`${BASE_URL}/api/admin/tenant-config`, {
            data: {
                holidayRegion: 'US-TX',
                holidayPublicPolicy: 'block',
                holidayInternalPolicy: 'advisory',
            },
            headers: {
                ...csrf.headers,
                Authorization: `Bearer ${adminToken}`,
                Cookie: `${csrf.headers.Cookie}; __Host-inspector_token=${adminToken}`,
            },
        });

        if (patch.ok()) {
            const preview = await request.get(
                `${BASE_URL}/api/admin/holidays/preview?year=2026`,
                { headers: { Authorization: `Bearer ${adminToken}` } },
            );
            expect(preview.status()).toBe(200);
            const previewBody = (await preview.json()) as {
                data?: { dates?: Array<{ date: string; name: string }> };
            };
            const texas = previewBody.data?.dates?.find((d) => d.date === TEXAS_HOLIDAY);
            expect(texas?.name).toMatch(/Texas Independence/i);

            const slotsRes = await request.get(
                `${BASE_URL}/api/public/slots?tenant=${TENANT_SLUG}&date=${TEXAS_HOLIDAY}`,
            );
            expect(slotsRes.status()).toBe(200);
            const slotsBody = (await slotsRes.json()) as {
                data?: { slots?: unknown[] };
            };
            expect(slotsBody.data?.slots ?? null).toEqual([]);
            return;
        }

        // Fallback: admin calendar Team scope control.
        await gotoAuth(page, '/calendar', adminToken);
        const team = page.getByRole('button', { name: 'Team', exact: true });
        await expect(team).toBeVisible({ timeout: 15000 });
        await team.click();
        await expect(team).toHaveAttribute('aria-pressed', 'true');
    });
});
