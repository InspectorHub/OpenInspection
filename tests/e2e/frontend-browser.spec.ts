/**
 * React Router v7 Frontend Browser Tests (canonical page-render smoke)
 *
 * Live-selector page rendering, SPA navigation, and shared-ui checks against the
 * seeded-D1 worker. This is the canonical version of the former Alpine
 * standalone-browser smokes.
 *
 * Auth: the merged tests/e2e suite runs the built worker over plain HTTP on
 * 8789, where the browser can't set the __Host- cookie. We log in via the API
 * (CSRF double-submit) to capture the raw __Host-inspector_token JWT and replay
 * it as a cookie header (getToken() falls back to that cookie) — the same trick
 * as inspection-hub.spec.ts / standalone-browser.spec.ts.
 */
import { test, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { makeCsrfToken } from './helpers/csrf';

const BASE_URL = process.env.FRONTEND_URL || 'http://127.0.0.1:8789';
const NAV_TIMEOUT = 30000;

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@autotest.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Password123!';
const COMPANY_NAME = process.env.COMPANY_NAME || 'Automation Test Corp';

// --- Helpers ----------------------------------------------------------------

// CSRF here is a stateless double-submit (server/lib/middleware/csrf.ts): the
// client mints its own token and echoes it as both cookie + header. The server
// never issues the cookie, so there is nothing to fetch — see helpers/csrf.ts.
const getCsrfToken = (_request?: APIRequestContext): string => makeCsrfToken();

/** Log in via POST /api/auth/login and return the raw __Host-inspector_token JWT. */
async function loginApi(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<string> {
  const csrf = await getCsrfToken(request);
  const res = await request.post(`${BASE_URL}/api/auth/login`, {
    data: { email, password },
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrf,
      Cookie: `__Host-csrf_token=${csrf}`,
    },
  });
  expect(res.status(), `Login failed for ${email}: expected 200`).toBe(200);
  const setCookie = res.headers()['set-cookie'] ?? '';
  const match = setCookie.match(/__Host-inspector_token=([^;]+)/);
  const token = match?.[1] ?? '';
  expect(token, `No auth token returned for ${email}`).toBeTruthy();
  return token;
}

async function gotoAuth(page: Page, path: string, token: string) {
  await page.setExtraHTTPHeaders({ Cookie: `__Host-inspector_token=${token}` });
  await page.goto(`${BASE_URL}${path}`, {
    timeout: NAV_TIMEOUT,
    waitUntil: 'networkidle',
  });
}

// --- Shared state -----------------------------------------------------------

let adminToken = '';

// Jargon patterns to reject across all pages
const JARGON = [
  'Deploy Workflow',
  'Dispatch',
  'Authorize Completion',
  'Logic Schema',
  'Personnel',
  'Temporal Allocation',
  'Digital Mail',
  'Synchronizing Registry',
  'Analytical Synthesis',
  'Protocol Interface',
  'System Config',
  'Operational Hub',
  'Document Registry',
  'Internal Reference Name',
  'Schedule Analysis',
  'Legal Name',
];

// --- Tests ------------------------------------------------------------------

test.describe.serial('React Router v7 Frontend Browser Tests', () => {
  // -- Auth Setup ------------------------------------------------------------

  test('SETUP: Ensure workspace + admin, then log in', async ({ request }) => {
    // Idempotent workspace init so this project is self-sufficient (globalSetup
    // wipes D1; no ordering guarantee vs the api project).
    const csrf = await getCsrfToken(request);
    await request.post(`${BASE_URL}/api/auth/setup`, {
      data: {
        companyName: COMPANY_NAME,
        adminName: 'Test Admin',
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        verificationCode: '000000',
      },
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrf,
        Cookie: `__Host-csrf_token=${csrf}`,
      },
    });
    adminToken = await loginApi(request, ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  // -- Login Page ------------------------------------------------------------

  test('UI-01: Login page renders correctly', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`, { timeout: NAV_TIMEOUT, waitUntil: 'domcontentloaded' });
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  // -- Dashboard -------------------------------------------------------------

  test('UI-02: Dashboard renders main content', async ({ page }) => {
    await gotoAuth(page, '/inspections', adminToken);
    // Sidebar link to the inspections hub is present (app/components/Sidebar.tsx
    // WORKSPACE_ITEMS render NavLinks → a[href="/inspections"]).
    await expect(
      page.locator('aside a[href="/inspections"], nav a[href="/inspections"]'),
    ).toBeVisible({ timeout: 10000 });
  });

  test('UI-03: Dashboard shows inspections list', async ({ page }) => {
    await gotoAuth(page, '/inspections', adminToken);
    // Wait for inspection rows or "No inspections" empty state
    await page.waitForSelector('[class*="NEEDS ATTENTION"], [class*="THIS WEEK"], [class*="No inspections"], h1', {
      timeout: 10000,
    });
  });

  // -- SPA Navigation --------------------------------------------------------

  test('SPA-01: Sidebar navigation does not trigger full page reload', async ({
    page,
  }) => {
    await gotoAuth(page, '/inspections', adminToken);
    await page.waitForLoadState('networkidle');

    // Record a marker on window; a full page reload wipes it.
    await page.evaluate(() => {
      (window as any).__spa_nav_marker = true;
    });

    // Click the live sidebar Library link (app/components/Sidebar.tsx:86-97 —
    // <NavLink to="/library"> → a[href="/library"]). Assert unconditionally:
    // no `if (count>0)` guard, so a missing link fails the test.
    const sidebarLink = page.locator('aside a[href="/library"], nav a[href="/library"]');
    await expect(sidebarLink.first()).toBeVisible({ timeout: 10000 });
    await sidebarLink.first().click();
    await page.waitForURL('**/library', { timeout: 10000 });

    // Marker survives → client-side (SPA) navigation, not a full reload.
    const marker = await page.evaluate(() => (window as any).__spa_nav_marker);
    expect(marker, 'Full page reload detected during SPA navigation').toBe(true);
  });

  test('SPA-02: Browser back/forward works with SPA navigation', async ({
    page,
  }) => {
    await gotoAuth(page, '/inspections', adminToken);
    await page.waitForLoadState('networkidle');

    // No direct-goto fallback: the SPA transition itself must work, or fail.
    const sidebarLink = page.locator('aside a[href="/library"], nav a[href="/library"]');
    await expect(sidebarLink.first()).toBeVisible({ timeout: 10000 });
    await sidebarLink.first().click();
    await page.waitForURL('**/library', { timeout: 10000 });
    expect(page.url()).toContain('/library');

    await page.goBack();
    await page.waitForURL('**/inspections', { timeout: 10000 });
    expect(page.url()).toContain('/inspections');
  });

  // -- Shared-UI Components --------------------------------------------------

  test('SHARED-UI-01: PageHeader component renders on pages', async ({
    page,
  }) => {
    await gotoAuth(page, '/inspections', adminToken);
    const header = page.locator('h1, [data-testid="page-header"], header h1');
    await expect(header.first()).toBeVisible({ timeout: 10000 });
  });

  test('SHARED-UI-02: Sidebar component renders navigation items', async ({
    page,
  }) => {
    await gotoAuth(page, '/inspections', adminToken);
    const navLinks = page.locator('aside a, nav[aria-label] a');
    expect(await navLinks.count()).toBeGreaterThan(0);
  });

  // -- Templates Page --------------------------------------------------------

  test('UI-06: Templates page loads', async ({ page }) => {
    await gotoAuth(page, '/library/templates', adminToken);
    // B3: assert the live authed <main> shell instead of content.length>500.
    await expect(page.getByRole('main')).toBeVisible({ timeout: 10000 });
  });

  // -- Team Page -------------------------------------------------------------

  test('UI-08: Team page loads', async ({ page }) => {
    await gotoAuth(page, '/team', adminToken);
    await expect(page.getByRole('main')).toBeVisible({ timeout: 10000 });
  });

  // -- Settings Page ---------------------------------------------------------

  test('UI-10: Settings page loads', async ({ page }) => {
    await gotoAuth(page, '/settings', adminToken);
    await expect(page.getByRole('main')).toBeVisible({ timeout: 10000 });
  });

  // -- Full Jargon Scan ------------------------------------------------------

  test('UI-16: No sci-fi jargon on any authenticated page', async ({
    page,
  }) => {
    const pagesToCheck = [
      '/inspections',
      '/library/templates',
      '/team',
      '/settings',
    ];

    for (const path of pagesToCheck) {
      await gotoAuth(page, path, adminToken);
      await page.waitForTimeout(500);
      const text = (await page.textContent('body')) || '';
      for (const jargon of JARGON) {
        expect(text, `"${jargon}" found on ${path}`).not.toContain(jargon);
      }
    }
  });
});
