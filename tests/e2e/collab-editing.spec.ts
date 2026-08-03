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
 * as the cookie for browser navigation (same trick as inspector-portal.spec.ts).
 * The __Host- cookie can't be set from the browser over plain HTTP, so we replay
 * it via context.setExtraHTTPHeaders.
 *
 * Run: npm run test:e2e -- collab-editing
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';
import { awaitEditorInteractive } from './helpers/editor-ready';

// Must be `localhost` (not 127.0.0.1): the auth cookie is added with
// domain 'localhost', and Chromium only treats http://localhost as a secure
// context — required for the Secure `__Host-` cookie to ride the ws:// upgrade.
const BASE_URL = process.env.FRONTEND_URL || 'http://localhost:8789';
const NAV_TIMEOUT = 30000;

const ADMIN_EMAIL = process.env.TEST_EMAIL || 'admin@autotest.com';
const ADMIN_PASSWORD = process.env.TEST_PASSWORD || 'Password123!';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Helpers ─────────────────────────────────────────────────────────────────


/** Reset the known admin's password in LOCAL D1 so the login below is deterministic. */

async function loginApi(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<string> {
  const csrf = 'deadbeefdeadbeefdeadbeefdeadbeef';
  // The collab specs churn WebSocket + Durable Object connections; a stale
  // keep-alive socket to the shared wrangler-dev worker can be reset
  // (read ECONNRESET) on the next HTTP request, flaking this beforeAll login.
  // Retry ONLY on transient connection errors — a real 401/429/assertion still
  // throws immediately, so we never mask a genuine auth break.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
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
    } catch (err) {
      lastErr = err;
      if (!/ECONNRESET|ECONNREFUSED|socket hang up|EPIPE/i.test(String((err as Error)?.message ?? err))) throw err;
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
  }
  throw lastErr;
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
  // A single click is not enough: ItemList's rows are server-rendered, so the
  // row is clickable on screen before React has attached its handler, and the
  // first click can land on nothing. The helper retries the (idempotent)
  // selection until the pane actually opens.
  await awaitEditorInteractive(page, 'Roof');
}

// ─── Shared state ────────────────────────────────────────────────────────────

let adminToken = '';
let inspectionId = '';

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe.serial('Collab editing — 2-client browser E2E (#181)', () => {
  test.beforeAll(async ({ request }) => {
    // The admin password is already what POST /api/auth/setup wrote (both
    // sides use ADMIN_PASSWORD), so the local seedAdminPassword() that used to
    // run here re-hashed the same value onto the same row — at the cost of a
    // `wrangler d1 execute --local` that held the SQLite file lock and forced
    // workers:1 on the whole suite. The `api` project dependency guarantees
    // the row exists.
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
