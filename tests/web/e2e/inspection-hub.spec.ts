/**
 * Inspection Hub E2E (#111)
 *
 * Two browser specs that exercise the read-only inspection hub landing and
 * the /reports → Published-tab retirement redirect.
 *
 *   1. A dashboard row's address link opens the hub at /inspections/{id}
 *      (no /edit suffix), rendering the six status blocks + "Open editor".
 *   2. /reports 301-redirects to /dashboard?workflow=published and the
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
 * Run: npm run test:e2e -- inspection-hub
 * (playwright.config.ts boots `npm run dev` on http://localhost:8787 and
 *  reuses an already-running server outside CI.)
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = process.env.FRONTEND_URL || 'http://localhost:8787';
const NAV_TIMEOUT = 30000;

const ADMIN_EMAIL = process.env.TEST_EMAIL || 'admin@example.com';
const ADMIN_PASSWORD = process.env.TEST_PASSWORD || 'testpassword123';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, '..', '..', '..');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** PBKDF2-SHA256 (100k iters, 16-byte salt) — matches server/lib/password.ts. */
async function hashPassword(password: string): Promise<string> {
  const toHex = (b: Uint8Array) =>
    Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    key,
    256,
  );
  return `pbkdf2:${toHex(salt)}:${toHex(new Uint8Array(bits))}`;
}

/**
 * Reset the known admin's password in the LOCAL D1 so the form login below is
 * deterministic regardless of how the dev DB was previously seeded. Uses the
 * repo's wrangler shim (config resolution + Windows-safe exec).
 */
async function seedAdminPassword(): Promise<void> {
  const hash = await hashPassword(ADMIN_PASSWORD);
  const sql = `UPDATE users SET password_hash='${hash}' WHERE email='${ADMIN_EMAIL.replace(/'/g, "''")}';`;
  const sqlFile = path.join(APP_DIR, '.hub-e2e-seed.tmp.sql');
  writeFileSync(sqlFile, sql, 'utf8');
  try {
    execFileSync(
      process.execPath,
      [path.join(APP_DIR, 'scripts', 'wrangler.mjs'), 'd1', 'execute', 'DB', '--local', '--file', sqlFile],
      { cwd: APP_DIR, stdio: ['ignore', 'ignore', 'inherit'] },
    );
  } finally {
    rmSync(sqlFile, { force: true });
  }
}

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

test.describe.serial('Inspection Hub (#111)', () => {
  test.beforeAll(async ({ request }) => {
    // Deterministic local seed → known credentials for the form login.
    await seedAdminPassword();
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
    await gotoAuth(page, '/dashboard', adminToken);

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
    // curl -L) so we pin the exact 301 → /dashboard?workflow=published target.
    const res = await request.get(`${BASE_URL}/reports`, {
      headers: { Cookie: `__Host-inspector_token=${adminToken}` },
      maxRedirects: 0,
    });
    expect(res.status()).toBe(301);
    expect(res.headers()['location']).toBe('/dashboard?workflow=published');

    // (b) The redirect target renders the Published tab as active. (Asserting
    // this on a direct browser nav avoids a Chromium quirk where a header set
    // via setExtraHTTPHeaders is dropped on a server-side-followed redirect.)
    await gotoAuth(page, '/dashboard?workflow=published', adminToken);
    expect(page.url()).toMatch(/\/dashboard\?workflow=published$/);

    // The TabStrip's active tab is the only button styled with the primary
    // border+text tokens (border-ih-primary text-ih-primary).
    const publishedTab = page.locator('button', { hasText: 'Published' });
    await expect(publishedTab.first()).toBeVisible({ timeout: 10000 });
    await expect(publishedTab.first()).toHaveClass(/text-ih-primary/);
    await expect(publishedTab.first()).toHaveClass(/border-ih-primary/);
  });
});
