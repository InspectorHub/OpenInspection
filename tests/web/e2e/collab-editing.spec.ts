/**
 * 2-Client Collaborative-Editing Browser E2E (#181)
 *
 * Validates the now-default-ON, UNCONDITIONAL collab editor end-to-end in a real
 * browser (production-shape workerd via `npm run dev`). Two independent browser
 * contexts = two real clients (separate cookies + separate IndexedDB), both
 * logged in, both open the SAME inspection's editor:
 *
 *   1. Both connect to the collab WebSocket (…/collab/ws) — proves the
 *      unconditional wiring + the authorized route + the Durable Object.
 *   2. A → B propagation: edit notes in A; B sees the new value with no reload
 *      (WS round-trip through the DO).
 *   3. Persistence: reload A; the edit survives (DO storage + sync).
 *
 * Version restore convergence (the clock button → Save version now → restore) is
 * deliberately NOT driven here — it is already covered by the workers tests and
 * is too selector-fragile to assert reliably via UI. See the task report.
 *
 * Auth: POST /api/auth/login with a self-issued CSRF double-submit pair (the
 * middleware only checks header === cookie), capturing __Host-inspector_token
 * from Set-Cookie. That raw JWT is a Bearer token for API seeding AND replayable
 * as the cookie for browser navigation (same trick as inspection-hub.spec.ts).
 * The __Host- cookie can't be set from the browser over plain HTTP, so we replay
 * it via context.setExtraHTTPHeaders.
 *
 * Run: npm run test:e2e -- collab-editing
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';

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

/** Reset the known admin's password in LOCAL D1 so the login below is deterministic. */
async function seedAdminPassword(): Promise<void> {
  const hash = await hashPassword(ADMIN_PASSWORD);
  const sql = `UPDATE users SET password_hash='${hash}' WHERE email='${ADMIN_EMAIL.replace(/'/g, "''")}';`;
  const sqlFile = path.join(APP_DIR, '.collab-e2e-seed.tmp.sql');
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

async function apiPost(
  request: APIRequestContext,
  p: string,
  token: string,
  data: Record<string, unknown>,
) {
  return request.post(`${BASE_URL}${p}`, {
    data,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  });
}

/**
 * Open the inspection editor in a fresh context with the auth cookie replayed,
 * capturing every WebSocket the page opens. Returns the context, page, and a
 * promise that resolves with the first collab WS URL seen.
 */
async function openEditorContext(
  browser: import('@playwright/test').Browser,
  token: string,
  inspectionId: string,
): Promise<{ context: BrowserContext; page: Page; collabWsUrl: Promise<string> }> {
  const context = await browser.newContext();
  // Put the JWT in the browser's own cookie jar (not just an extra HTTP header):
  // setExtraHTTPHeaders does NOT apply to the WebSocket upgrade handshake, so the
  // collab WS would arrive unauthenticated (401, null tenant) and fall back to an
  // isolated single-client doc. Chromium treats http://localhost as a secure
  // context, so a Secure `__Host-`-prefixed cookie IS sent over ws://localhost.
  await context.addCookies([
    {
      name: '__Host-inspector_token',
      value: token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
    },
  ]);
  const page = await context.newPage();

  const collabWsUrl = new Promise<string>((resolve) => {
    page.on('websocket', (ws) => {
      if (ws.url().includes('/collab/ws')) resolve(ws.url());
    });
  });

  await page.goto(`${BASE_URL}/inspections/${inspectionId}/edit`, {
    timeout: NAV_TIMEOUT,
    waitUntil: 'domcontentloaded',
  });
  return { context, page, collabWsUrl };
}

/** Select the seeded "Roof" item and wait for the notes textarea to mount. */
async function selectRoofItem(page: Page): Promise<void> {
  // ItemList renders each item as a clickable row containing the label text.
  await page.getByText('Roof', { exact: false }).first().click();
  await expect(page.locator('#notes-textarea')).toBeVisible({ timeout: 10000 });
}

// ─── Shared state ────────────────────────────────────────────────────────────

let adminToken = '';
let inspectionId = '';

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe.serial('Collab editing — 2-client browser E2E (#181)', () => {
  test.beforeAll(async ({ request }) => {
    await seedAdminPassword();
    adminToken = await loginApi(request, ADMIN_EMAIL, ADMIN_PASSWORD);

    // Seed a template with one rich (editable) item + an inspection from it.
    const tplRes = await apiPost(request, '/api/inspections/templates', adminToken, {
      name: 'Collab E2E Template',
      schema: {
        schemaVersion: 2,
        sections: [
          {
            id: 's_general',
            title: 'General',
            items: [
              {
                id: 'roof',
                label: 'Roof',
                type: 'rich',
                ratingOptions: ['Inspected', 'Repair'],
                tabs: { information: [], limitations: [], defects: [] },
              },
            ],
          },
        ],
      },
    });
    expect(tplRes.status()).toBe(201);
    const templateId = (await tplRes.json()).data?.template?.id;
    expect(templateId, 'No template id returned').toBeTruthy();

    const insRes = await apiPost(request, '/api/inspections', adminToken, {
      propertyAddress: '1 Collab Way, Realtime City',
      clientName: 'Ada Lovelace',
      clientEmail: 'ada@example.com',
      templateId,
    });
    expect(insRes.status()).toBe(201);
    inspectionId = (await insRes.json()).data?.inspection?.id;
    expect(inspectionId, 'No inspection id returned').toBeTruthy();
  });

  test('steps 1–3: both clients connect, A→B propagates, edit persists', async ({ browser }) => {
    // ── Step 1: two independent clients both open the editor + connect WS ──────
    const a = await openEditorContext(browser, adminToken, inspectionId);
    const b = await openEditorContext(browser, adminToken, inspectionId);

    try {
      const aWs = await a.collabWsUrl;
      const bWs = await b.collabWsUrl;
      const expectedSuffix = `/api/inspections/${inspectionId}/collab/ws`;
      expect(aWs, 'Client A collab WS URL').toContain(expectedSuffix);
      expect(bWs, 'Client B collab WS URL').toContain(expectedSuffix);
      expect(aWs.startsWith('ws://') || aWs.startsWith('wss://')).toBe(true);

      // Both select the same item so both have the notes textarea mounted.
      await selectRoofItem(a.page);
      await selectRoofItem(b.page);

      // ── Step 2: A edits notes → B sees it with no reload (WS round-trip) ─────
      const propagated = `collab-propagation-${Date.now()}`;
      await a.page.locator('#notes-textarea').fill(propagated);
      // Blur commits the notes write through the Y.Doc (onNotesBlur → commitNotes).
      await a.page.locator('#notes-textarea').blur();

      // B's textarea is bound to the same finding via the Y.Doc projection; the
      // DO debounces but propagation is sub-second. Poll up to ~10s.
      await expect
        .poll(async () => b.page.locator('#notes-textarea').inputValue(), {
          timeout: 10000,
          message: 'Client B never received A\'s notes edit over the collab WS',
        })
        .toBe(propagated);

      // ── Step 3: reload A → the edit survives (DO storage + resync) ───────────
      await a.page.reload({ timeout: NAV_TIMEOUT, waitUntil: 'domcontentloaded' });
      await selectRoofItem(a.page);
      await expect
        .poll(async () => a.page.locator('#notes-textarea').inputValue(), {
          timeout: 10000,
          message: 'Reloaded client A did not see the persisted notes edit',
        })
        .toBe(propagated);
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });
});
