/**
 * Inspector Portal E2E (#111)
 *
 * Two browser specs that exercise the read-only inspector portal landing and
 * the /reports → Published-tab retirement redirect.
 *
 *   1. A dashboard row's address link opens the hub at /inspections/{id}
 *      (no /edit suffix), rendering the six status blocks + "Open editor".
 *   2. /reports 301-redirects to /inspections?workflow=published and the
 *      TabStrip lands on the active "Published" tab.
 *
 * Auth: POST /api/auth/login with a self-issued CSRF double-submit pair
 * (the middleware only checks the header equals the cookie — no server-stored
 * value), capturing __Host-inspector_token from the Set-Cookie. That raw JWT
 * is both a Bearer token for API seeding AND replayable as the cookie for
 * browser navigation (getToken() falls back to it). The __Host- cookie can't
 * be set from the browser over plain HTTP, so we replay it via
 * setExtraHTTPHeaders (same trick as tests/standalone-browser.spec.ts).
 *
 * Seed: beforeAll resets a known admin password in local D1, logs in, and
 * creates one template + one inspection so spec 1 always has a row to click.
 *
 * Run: npm run test:e2e -- inspector-portal
 * (playwright.config.ts boots `npm run dev` on http://localhost:8787 and
 *  reuses an already-running server outside CI.)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = process.env.FRONTEND_URL || 'http://127.0.0.1:8789';
const NAV_TIMEOUT = 30000;

const ADMIN_EMAIL = process.env.TEST_EMAIL || 'admin@autotest.com';
const ADMIN_PASSWORD = process.env.TEST_PASSWORD || 'Password123!';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Helpers ─────────────────────────────────────────────────────────────────


/**
 * Reset the known admin's password in the LOCAL D1 so the form login below is
 * deterministic regardless of how the dev DB was previously seeded. Uses the
 * repo's wrangler shim (config resolution + Windows-safe exec).
 */

/**
 * Log in via POST /api/auth/login with a self-issued CSRF double-submit pair
 * and return the __Host-inspector_token JWT from the Set-Cookie.
 */
async function loginApi(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<string> {
  const csrf = 'deadbeefdeadbeefdeadbeefdeadbeef';
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
  expect(token, `No session cookie returned for ${email}`).toBeTruthy();
  return token;
}

async function gotoAuth(page: Page, path: string, token: string) {
  await page.setExtraHTTPHeaders({ Cookie: `__Host-inspector_token=${token}` });
  await page.goto(`${BASE_URL}${path}`, {
    timeout: NAV_TIMEOUT,
    waitUntil: 'networkidle',
  });
}

async function apiPost(
  request: APIRequestContext,
  path: string,
  token: string,
  data: Record<string, unknown>,
) {
  return request.post(`${BASE_URL}${path}`, {
    data,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
}

// ─── Shared state ────────────────────────────────────────────────────────────

let adminToken = '';
let inspectionId = '';

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe.serial('Inspector Portal (#111)', () => {
  test.beforeAll(async ({ request }) => {
    // Deterministic local seed → known credentials for the form login.
    // The admin password is already what POST /api/auth/setup wrote (both
    // sides use ADMIN_PASSWORD), so the local seedAdminPassword() that used to
    // run here re-hashed the same value onto the same row — at the cost of a
    // `wrangler d1 execute --local` that held the SQLite file lock and forced
    // workers:1 on the whole suite. The `api` project dependency guarantees
    // the row exists.
    adminToken = await loginApi(request, ADMIN_EMAIL, ADMIN_PASSWORD);

    // Seed a template + one inspection so spec 1 always has a row to click.
    const richItem = (id: string, label: string) => ({
      id,
      label,
      type: 'rich' as const,
      ratingOptions: ['Inspected', 'Repair'],
      tabs: { information: [], limitations: [], defects: [] },
    });
    const tplRes = await apiPost(
      request,
      '/api/inspections/templates',
      adminToken,
      {
        name: 'Hub E2E Template',
        schema: {
          schemaVersion: 2,
          sections: [
            { id: 's_general', title: 'General', items: [richItem('roof', 'Roof')] },
          ],
        },
      },
    );
    expect(tplRes.status()).toBe(201);
    const templateId = (await tplRes.json()).data?.template?.id;
    expect(templateId, 'No template id returned').toBeTruthy();

    const insRes = await apiPost(request, '/api/inspections', adminToken, {
      propertyAddress: '742 Evergreen Terrace, Springfield',
      clientName: 'Homer Simpson',
      clientEmail: 'homer@springfield.com',
      templateId,
    });
    expect(insRes.status()).toBe(201);
    inspectionId = (await insRes.json()).data?.inspection?.id;
    expect(inspectionId, 'No inspection id returned').toBeTruthy();
  });

  test('dashboard row opens hub', async ({ page }) => {
    await gotoAuth(page, '/inspections', adminToken);

    // The row's address is wrapped in a Link to /inspections/{id} (no /edit) —
    // click the link for the inspection we seeded.
    const rowLink = page.locator(`a[href="/inspections/${inspectionId}"]`);
    await expect(rowLink.first()).toBeVisible({ timeout: 10000 });
    await rowLink.first().click();

    // Lands on the hub: /inspections/{uuid} exactly, never the /edit editor.
    await page.waitForURL(`**/inspections/${inspectionId}`, { timeout: 10000 });
    expect(page.url()).toMatch(new RegExp(`/inspections/${inspectionId}$`));
    expect(page.url()).not.toContain('/edit');

    // All six status blocks render (h2 headings inside the cards).
    for (const heading of ['People', 'Schedule', 'Services', 'Agreement', 'Invoice', 'Report']) {
      await expect(
        page.getByRole('heading', { name: heading, exact: true }),
        `Missing "${heading}" block heading`,
      ).toBeVisible({ timeout: 10000 });
    }

    // The header "Open editor" affordance is present (the only deep-link into
    // the legacy /edit editor from the read-only hub).
    await expect(page.getByRole('link', { name: 'Open editor' })).toBeVisible();
  });

  test('/reports redirects to published tab', async ({ request, page }) => {
    // (a) /reports issues the retirement redirect. Assert the raw response
    // (the request context re-sends our auth header across the hop, like
    // curl -L) so we pin the exact 301 → /inspections?workflow=published target.
    const res = await request.get(`${BASE_URL}/reports`, {
      headers: { Cookie: `__Host-inspector_token=${adminToken}` },
      maxRedirects: 0,
    });
    expect(res.status()).toBe(301);
    expect(res.headers()['location']).toBe('/inspections?workflow=published');

    // (b) The redirect target renders the Published tab as active. (Asserting
    // this on a direct browser nav avoids a Chromium quirk where a header set
    // via setExtraHTTPHeaders is dropped on a server-side-followed redirect.)
    await gotoAuth(page, '/inspections?workflow=published', adminToken);
    expect(page.url()).toMatch(/\/inspections\?workflow=published$/);

    // The TabStrip's active tab is the only button styled with the primary
    // border+text tokens (border-ih-primary text-ih-primary).
    const publishedTab = page.locator('button', { hasText: 'Published' });
    await expect(publishedTab.first()).toBeVisible({ timeout: 10000 });
    await expect(publishedTab.first()).toHaveClass(/text-ih-primary/);
    await expect(publishedTab.first()).toHaveClass(/border-ih-primary/);
  });
});
