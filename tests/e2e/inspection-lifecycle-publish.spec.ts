/**
 * IA-29 / IA-30 regression guard — the order lifecycle does not gate report
 * publishing. Before this, `POST /publish` required inspections.status ===
 * 'completed' and the hub hid the publish affordance until then, but no surface
 * could mark an inspection completed, so publishing was unreachable — and no
 * test exercised the chain, which is exactly how the break survived to v1.0.0
 * (`rg "/complete" tests/` was empty).
 *
 * These two specs pin the decoupling: publishing is offered while the order is
 * still open, and marking fieldwork complete changes the order axis without
 * changing whether publishing is offered.
 *
 * Self-seeded (own template + inspection) rather than reusing the shared
 * editor-seed: this spec mutates order state (marks complete), and the
 * editor-seed inspection is read in parallel by the subsystem-a specs.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = process.env.FRONTEND_URL || 'http://127.0.0.1:8789';
const NAV_TIMEOUT = 30_000;
const ADMIN_EMAIL = process.env.TEST_EMAIL || 'admin@autotest.com';
const ADMIN_PASSWORD = process.env.TEST_PASSWORD || 'Password123!';

const __dirname = path.dirname(fileURLToPath(import.meta.url));


/** Reset the api-seeded admin's password in the LOCAL D1 for a deterministic login. */

async function loginApi(request: APIRequestContext, email: string, password: string): Promise<string> {
  const csrf = 'deadbeefdeadbeefdeadbeefdeadbeef';
  const res = await request.post(`${BASE_URL}/api/auth/login`, {
    data: { email, password },
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, Cookie: `__Host-csrf_token=${csrf}` },
  });
  expect(res.status(), `Login failed for ${email}: expected 200`).toBe(200);
  const token = (res.headers()['set-cookie'] ?? '').match(/__Host-inspector_token=([^;]+)/)?.[1] ?? '';
  expect(token, `No session cookie returned for ${email}`).toBeTruthy();
  return token;
}

async function apiPost(request: APIRequestContext, path: string, token: string, data: Record<string, unknown>) {
  return request.post(`${BASE_URL}${path}`, {
    data,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  });
}

async function gotoHubAuthed(page: Page, inspectionId: string, token: string) {
  await page.setExtraHTTPHeaders({ Cookie: `__Host-inspector_token=${token}` });
  await page.goto(`${BASE_URL}/inspections/${inspectionId}`, { timeout: NAV_TIMEOUT, waitUntil: 'networkidle' });
}

let token = '';
let inspectionId = '';

test.describe.serial('Publish is decoupled from order completion (IA-29 / IA-30)', () => {
  test.beforeAll(async ({ request }) => {
    // The admin password is already what POST /api/auth/setup wrote (both
    // sides use ADMIN_PASSWORD), so the local seedAdminPassword() that used to
    // run here re-hashed the same value onto the same row — at the cost of a
    // `wrangler d1 execute --local` that held the SQLite file lock and forced
    // workers:1 on the whole suite. The `api` project dependency guarantees
    // the row exists.
    token = await loginApi(request, ADMIN_EMAIL, ADMIN_PASSWORD);

    const richItem = (id: string, label: string) => ({
      id, label, type: 'rich' as const,
      ratingOptions: ['Inspected', 'Repair'],
      tabs: { information: [], limitations: [], defects: [] },
    });
    const tpl = await apiPost(request, '/api/inspections/templates', token, {
      name: 'Lifecycle Publish E2E Template',
      schema: { schemaVersion: 2, sections: [{ id: 's_general', title: 'General', items: [richItem('roof', 'Roof')] }] },
    });
    expect(tpl.status(), 'template creation must return 201').toBe(201);
    const templateId = (await tpl.json()).data?.template?.id as string | undefined;
    expect(templateId, 'template id must be returned').toBeTruthy();

    const insp = await apiPost(request, '/api/inspections', token, {
      propertyAddress: '1 Lifecycle Publish Street, Testville',
      clientName: 'Lifecycle Client',
      clientEmail: 'lifecycle@example.com',
      templateId,
    });
    expect(insp.status(), 'inspection creation must return 201').toBe(201);
    inspectionId = (await insp.json()).data?.inspection?.id as string;
    expect(inspectionId, 'inspection id must be returned').toBeTruthy();
  });

  test('offers publishing while the order is still open (never completed)', async ({ page }) => {
    await gotoHubAuthed(page, inspectionId, token);

    // The order is fresh — still `requested`, never marked complete — yet the
    // Report card offers publishing. That is the whole fix: the order axis does
    // not gate report delivery.
    await expect(page.getByRole('button', { name: /mark fieldwork complete/i })).toBeVisible({ timeout: NAV_TIMEOUT });
    await expect(page.getByRole('button', { name: /publish report/i })).toBeVisible();
  });

  test('marking fieldwork complete advances the order without affecting publish', async ({ page }) => {
    await gotoHubAuthed(page, inspectionId, token);

    // Baseline: publishable, and the order is still open.
    const completeBtn = page.getByRole('button', { name: /mark fieldwork complete/i });
    await expect(completeBtn).toBeVisible({ timeout: NAV_TIMEOUT });
    await expect(page.getByRole('button', { name: /publish report/i })).toBeVisible();

    // Advance the order axis. The button belongs to the lifecycle card and
    // disappears once the work is complete — a single-element signal for the
    // transition (the status label itself renders in both the header and the
    // card, so it is not a strict-mode-safe locator).
    await completeBtn.click();
    await expect(completeBtn).toBeHidden({ timeout: NAV_TIMEOUT });

    // The invariant: completing the order changed nothing about publishing.
    await expect(page.getByRole('button', { name: /publish report/i })).toBeVisible();
  });
});
