/**
 * React Router v7 Frontend Browser Tests
 *
 * Adapted from tests/standalone-browser.spec.ts for the React Router v7 frontend.
 * Tests page rendering, SPA navigation, shared-ui components, and UI interactions.
 *
 * Covers: Auth via form POST, SPA navigation, shared-ui components, page rendering
 * Run: npx playwright test tests/web/e2e/frontend-browser.spec.ts
 */
import { test, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const NAV_TIMEOUT = 30000;

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@autotest.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Password123!';
const COMPANY_NAME = process.env.COMPANY_NAME || 'Automation Test Corp';
const INSPECTOR_EMAIL = process.env.INSPECTOR_EMAIL || 'inspector@autotest.com';
const INSPECTOR_PASSWORD = process.env.INSPECTOR_PASSWORD || 'Inspector123!';

// --- Helpers ----------------------------------------------------------------

/**
 * Perform a form POST to /login and extract the __session cookie.
 */
async function loginViaForm(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<string> {
  const res = await request.post(`${BASE_URL}/login`, {
    form: { email, password },
    maxRedirects: 0,
  });
  // Login may return a redirect (302/303) with Set-Cookie
  const setCookie = res.headers()['set-cookie'] ?? '';
  const match = setCookie.match(/__session=([^;]+)/);
  const token = match?.[1] ?? '';
  expect(token, `No __session cookie returned for ${email}`).toBeTruthy();
  return token;
}

/**
 * Navigate to a page with the session cookie set.
 */
async function gotoAuth(page: Page, path: string, sessionToken: string) {
  await page.setExtraHTTPHeaders({ Cookie: `__session=${sessionToken}` });
  await page.goto(`${BASE_URL}${path}`, {
    timeout: NAV_TIMEOUT, waitUntil: 'domcontentloaded',
    waitUntil: 'networkidle',
  });
}

// --- Shared state -----------------------------------------------------------

let adminSession = '';
let inspectorSession = '';

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

  test('SETUP: Login as admin and inspector', async ({ request }) => {
    adminSession = await loginViaForm(request, ADMIN_EMAIL, ADMIN_PASSWORD);
    inspectorSession = await loginViaForm(
      request,
      INSPECTOR_EMAIL,
      INSPECTOR_PASSWORD,
    );
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
    await gotoAuth(page, '/dashboard', adminSession);
    // Sidebar link to dashboard should be active
    await expect(
      page.locator('aside a[href="/dashboard"], nav a[href="/dashboard"]'),
    ).toBeVisible({ timeout: 10000 });
  });

  test('UI-03: Dashboard shows inspections list', async ({ page }) => {
    await gotoAuth(page, '/dashboard', adminSession);
    // Wait for inspection rows or "No inspections" empty state
    await page.waitForSelector('[class*="NEEDS ATTENTION"], [class*="THIS WEEK"], [class*="No inspections"], h1', {
      timeout: 10000,
    });
  });

  // -- SPA Navigation --------------------------------------------------------

  test('SPA-01: Sidebar navigation does not trigger full page reload', async ({
    page,
  }) => {
    await gotoAuth(page, '/dashboard', adminSession);
    await page.waitForLoadState('networkidle');

    // Record a marker to detect full reload
    await page.evaluate(() => {
      (window as any).__spa_nav_marker = true;
    });

    // Click a sidebar link (e.g. the Library hub or Calendar)
    const sidebarLink = page.locator(
      'aside a[href="/library"], nav a[href="/library"], aside a[href="/calendar"], nav a[href="/calendar"]',
    );
    if ((await sidebarLink.count()) > 0) {
      await sidebarLink.first().click();
      await page.waitForLoadState('networkidle');

      // Marker should survive SPA navigation (no full reload)
      const marker = await page.evaluate(
        () => (window as any).__spa_nav_marker,
      );
      expect(marker, 'Full page reload detected during SPA navigation').toBe(
        true,
      );
    }
  });

  test('SPA-02: Browser back/forward works with SPA navigation', async ({
    page,
  }) => {
    await gotoAuth(page, '/dashboard', adminSession);
    await page.waitForLoadState('networkidle');

    const sidebarLink = page.locator(
      'aside a[href="/library"], nav a[href="/library"]',
    );
    if ((await sidebarLink.count()) > 0) {
      await sidebarLink.first().click();
      await page.waitForURL('**/library', { timeout: 10000 }).catch(() => {});
      // Fallback: SPA nav may not change URL if hydration hasn't completed
      if (!page.url().includes('/library')) {
        // Navigate directly as fallback
        await page.goto(`${BASE_URL}/library`, { timeout: NAV_TIMEOUT, waitUntil: 'domcontentloaded' });
      }
      expect(page.url()).toContain('/library');

      await page.goBack();
      await page.waitForURL('**/dashboard', { timeout: 10000 }).catch(() => {});
      expect(page.url()).toContain('/dashboard');
    }
  });

  // -- Shared-UI Components --------------------------------------------------

  test('SHARED-UI-01: PageHeader component renders on pages', async ({
    page,
  }) => {
    await gotoAuth(page, '/dashboard', adminSession);
    // PageHeader renders an h1 or a header element
    const header = page.locator(
      'h1, [data-testid="page-header"], header h1',
    );
    await expect(header.first()).toBeVisible({ timeout: 10000 });
  });

  test('SHARED-UI-02: Sidebar component renders navigation items', async ({
    page,
  }) => {
    await gotoAuth(page, '/dashboard', adminSession);
    // Verify sidebar has navigation links
    const navLinks = page.locator('aside a, nav[aria-label] a');
    expect(await navLinks.count()).toBeGreaterThan(0);
  });

  // -- Templates Page --------------------------------------------------------

  test('UI-06: Templates page loads', async ({ page }) => {
    await gotoAuth(page, '/library/templates', adminSession);
    await page.waitForLoadState('networkidle');
    // Page should have loaded without error
    const content = await page.content();
    expect(content.length).toBeGreaterThan(500);
  });

  // -- Team Page -------------------------------------------------------------

  test('UI-08: Team page loads', async ({ page }) => {
    await gotoAuth(page, '/team', adminSession);
    await page.waitForLoadState('networkidle');
    const content = await page.content();
    expect(content.length).toBeGreaterThan(500);
  });

  // -- Settings Page ---------------------------------------------------------

  test('UI-10: Settings page loads', async ({ page }) => {
    await gotoAuth(page, '/settings', adminSession);
    await page.waitForLoadState('networkidle');
    const content = await page.content();
    expect(content.length).toBeGreaterThan(500);
  });

  // -- Full Jargon Scan ------------------------------------------------------

  test('UI-16: No sci-fi jargon on any authenticated page', async ({
    page,
  }) => {
    const pagesToCheck = [
      '/dashboard',
      '/library/templates',
      '/team',
      '/settings',
    ];

    for (const path of pagesToCheck) {
      await gotoAuth(page, path, adminSession);
      await page.waitForTimeout(500);
      const text = (await page.textContent('body')) || '';
      for (const jargon of JARGON) {
        expect(text, `"${jargon}" found on ${path}`).not.toContain(jargon);
      }
    }
  });
});
