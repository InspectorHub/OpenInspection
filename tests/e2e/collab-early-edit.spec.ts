/**
 * Early-edit sync race — regression test.
 *
 * An edit typed immediately after opening the editor (before the collab
 * handshake — generation frame + step1/step2 exchange — settles) used to be
 * silently dropped from sync: the local Y.Doc kept it, the Durable Object
 * never saw it. Root cause: the edit's doc write seeds the finding's
 * structure locally (getOrSeedItem) while the server seeds the identical
 * structure from the template, and the Yjs merge keeps ONE seed subtree
 * (higher clientID wins) and deletes the other's edits — a coin flip on
 * random clientIDs (the pre-fix repro lost the edit ~1 in 4 runs).
 *
 * The fix queues doc writes in useFindings until the first sync lands, so
 * they land on the server-seeded structure. This spec types the notes
 * IMMEDIATELY — deliberately NO handshake wait (the wait in
 * wave1c-chrome-verify.spec.ts was the workaround this fix removes) — and
 * asserts a second client sees the text, which only happens if it reached
 * the DO, plus a reload of the first client for persistence. It runs the
 * flow 3 times (fresh inspection each) because a single attempt only fails
 * ~1 in 4 without the fix.
 *
 * Run: npm run test:e2e -- collab-early-edit
 */
import { test, expect } from '@playwright/test';
import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';
import { awaitEditorInteractive } from './helpers/editor-ready';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './helpers/tenant-identity';

// Must be `localhost` (not 127.0.0.1): the auth cookie is added with
// domain 'localhost', and Chromium only treats http://localhost as a secure
// context — required for the Secure `__Host-` cookie to ride the ws:// upgrade.
const BASE_URL = process.env.FRONTEND_URL || 'http://localhost:8789';
const NAV_TIMEOUT = 30000;

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
 * Open the inspection editor in a fresh context with the auth cookie replayed.
 * Returns the context and page.
 */
async function openEditorContext(
  browser: import('@playwright/test').Browser,
  token: string,
  inspectionId: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  // Put the JWT in the browser's own cookie jar (not just an extra HTTP header): setExtraHTTPHeaders does NOT apply to the WebSocket upgrade handshake, so the collab WS would arrive unauthenticated (401, null tenant) and fall back to an isolated single-client doc. Chromium treats http://localhost as a secure context, so a Secure `__Host-`-prefixed cookie IS sent over ws://localhost.
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

  await page.goto(`${BASE_URL}/inspections/${inspectionId}/edit`, {
    timeout: NAV_TIMEOUT,
    waitUntil: 'domcontentloaded',
  });
  return { context, page };
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
let templateId = '';

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe.serial('Collab early edit — pre-handshake edit reaches the server', () => {
  test.beforeAll(async ({ request }) => {
    adminToken = await loginApi(request, ADMIN_EMAIL, ADMIN_PASSWORD);

    // Seed a template with one rich (editable) item; each attempt creates a
    // fresh inspection from it (a fresh DO, fresh clientIDs — the coin flip
    // is per handshake).
    const tplRes = await apiPost(request, '/api/inspections/templates', adminToken, {
      name: 'Collab Early-Edit Template',
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
    templateId = (await tplRes.json()).data?.template?.id;
    expect(templateId, 'No template id returned').toBeTruthy();
  });

  test('an edit typed before the handshake settles reaches the DO (3 attempts)', async ({ browser, request }) => {
    test.setTimeout(180000);
    const run = Date.now();

    for (let attempt = 1; attempt <= 3; attempt++) {
      const insRes = await apiPost(request, '/api/inspections', adminToken, {
        propertyAddress: `Early Edit Way ${attempt}, Testville`,
        clientName: 'Early Client',
        clientEmail: 'early@example.com',
        templateId,
      });
      expect(insRes.status()).toBe(201);
      const inspectionId = (await insRes.json()).data?.inspection?.id;
      expect(inspectionId, 'No inspection id returned').toBeTruthy();

      const text = `early-edit-${run}-${attempt}`;
      const a = await openEditorContext(browser, adminToken, inspectionId);
      const b = await openEditorContext(browser, adminToken, inspectionId);

      try {
        await selectRoofItem(a.page);

        // THE REGRESSION: fill + blur IMMEDIATELY — no handshake wait.
        // Before the fix this edit was lost ~1 in 4 runs (the local doc kept
        // it, the DO never saw it).
        await a.page.locator('#notes-textarea').fill(text);
        await a.page.locator('#notes-textarea').blur();

        // B is a separate client (own IndexedDB, own doc): it can only see
        // the text if it reached the DO.
        await selectRoofItem(b.page);
        await expect
          .poll(async () => b.page.locator('#notes-textarea').inputValue(), {
            timeout: 30000,
            message: `Attempt ${attempt}: client B never received the pre-handshake edit (the DO never saw it)`,
          })
          .toBe(text);

        // Persistence: reload A; the edit survives (DO storage + resync).
        await a.page.reload({ timeout: NAV_TIMEOUT, waitUntil: 'domcontentloaded' });
        await selectRoofItem(a.page);
        await expect
          .poll(async () => a.page.locator('#notes-textarea').inputValue(), {
            timeout: 10000,
            message: `Attempt ${attempt}: reloaded client A did not see the persisted early edit`,
          })
          .toBe(text);
      } finally {
        await a.context.close();
        await b.context.close();
      }
    }
  });
});
