/**
 * Offline edit + auto-reconnect 2-Client Browser E2E (#181, PR-G)
 *
 * Proves the headline PR-G capability: offline buffering of field edits in the
 * local Y.Doc + automatic WebSocket reconnect (no page reload) + bidirectional
 * CRDT merge on reconnect. This is the online regression's complement — it
 * exercises the offline branches gated on `!navigator.onLine` and the
 * `window 'online'` / socket-close reconnect path in
 * `app/lib/collab/results-doc-connection.ts`.
 *
 * Scenario (two real clients = two browser contexts, both logged in, same
 * inspection editor, both synced):
 *   1. Establish a synced baseline: A edits notes, B converges (online path).
 *   2. A goes OFFLINE (`contextA.setOffline(true)`).
 *   3. A edits the item's NOTES (type + blur) → buffered into A's Y.Doc +
 *      IndexedDB; the WS send is skipped (socket not OPEN). B does NOT converge
 *      while A is offline (negative assertion within a short window).
 *   4. A comes back ONLINE (`contextA.setOffline(false)`) → the connection's
 *      `window 'online'` handler reopens the socket (no reload), the sync
 *      handshake flows A's buffered edit to the DO and on to B → B converges to
 *      A's offline value within a generous poll window (~15s; reconnect backoff
 *      starts ~1s). This proves auto-reconnect + offline buffering + merge.
 *
 * Notes (field data) is used deliberately — no file-input/selector complexity,
 * the most reliable offline assertion. The offline PHOTO-add stretch is covered
 * by unit tests (offline-capture/drain) and is intentionally NOT driven here.
 *
 * Auth + seeding mirror collab-editing.spec.ts exactly (self-issued CSRF login,
 * __Host- cookie replayed into the context cookie jar so it rides the ws:// upgrade).
 *
 * Run: npm run test:e2e -- collab-offline
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

// ─── Helpers (mirror collab-editing.spec.ts) ─────────────────────────────────

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
  const sqlFile = path.join(APP_DIR, '.collab-offline-e2e-seed.tmp.sql');
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
 * capturing the first collab WS the page opens. The __Host- cookie goes into the
 * context cookie jar (Secure; Chromium treats http://localhost as secure) so it
 * rides the ws:// upgrade — setExtraHTTPHeaders does NOT apply to WS handshakes.
 */
async function openEditorContext(
  browser: import('@playwright/test').Browser,
  token: string,
  inspectionId: string,
): Promise<{ context: BrowserContext; page: Page; collabWsUrl: Promise<string> }> {
  const context = await browser.newContext();
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
  await page.getByText('Roof', { exact: false }).first().click();
  await expect(page.locator('#notes-textarea')).toBeVisible({ timeout: 10000 });
}

/** Set the notes textarea value and blur (blur commits via onNotesBlur → commitNotes). */
async function setNotes(page: Page, value: string): Promise<void> {
  await page.locator('#notes-textarea').fill(value);
  await page.locator('#notes-textarea').blur();
}

// ─── Shared state ────────────────────────────────────────────────────────────

let adminToken = '';
let inspectionId = '';

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe.serial('Collab offline + auto-reconnect — 2-client browser E2E (#181 PR-G)', () => {
  test.beforeAll(async ({ request }) => {
    await seedAdminPassword();
    adminToken = await loginApi(request, ADMIN_EMAIL, ADMIN_PASSWORD);

    const tplRes = await apiPost(request, '/api/inspections/templates', adminToken, {
      name: 'Collab Offline E2E Template',
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
      propertyAddress: '2 Offline Ave, Resync City',
      clientName: 'Grace Hopper',
      clientEmail: 'grace@example.com',
      templateId,
    });
    expect(insRes.status()).toBe(201);
    inspectionId = (await insRes.json()).data?.inspection?.id;
    expect(inspectionId, 'No inspection id returned').toBeTruthy();
  });

  test('A offline-edits notes → reconnect auto-syncs → B converges (no reload)', async ({ browser }) => {
    const a = await openEditorContext(browser, adminToken, inspectionId);
    const b = await openEditorContext(browser, adminToken, inspectionId);

    try {
      // ── Both clients connect to the collab WS ────────────────────────────────
      const aWs = await a.collabWsUrl;
      const bWs = await b.collabWsUrl;
      const expectedSuffix = `/api/inspections/${inspectionId}/collab/ws`;
      expect(aWs, 'Client A collab WS URL').toContain(expectedSuffix);
      expect(bWs, 'Client B collab WS URL').toContain(expectedSuffix);

      await selectRoofItem(a.page);
      await selectRoofItem(b.page);

      // ── Step 1: establish a synced baseline over the online path ─────────────
      // Proves both clients are genuinely connected + converging BEFORE we go
      // offline, so the later offline assertion is unambiguous.
      const baseline = `online-baseline-${Date.now()}`;
      await setNotes(a.page, baseline);
      await expect
        .poll(async () => b.page.locator('#notes-textarea').inputValue(), {
          timeout: 10000,
          message: 'Baseline: B never received A\'s online notes edit',
        })
        .toBe(baseline);

      // ── Step 2: A goes OFFLINE ───────────────────────────────────────────────
      await a.context.setOffline(true);

      // ── Step 3: A edits notes while offline → buffered locally, NOT sent ──────
      const offlineValue = `offline-edit-${Date.now()}`;
      await setNotes(a.page, offlineValue);

      // A's own textarea reflects the local Y.Doc write immediately.
      await expect
        .poll(async () => a.page.locator('#notes-textarea').inputValue(), {
          timeout: 5000,
          message: 'A did not buffer its own offline notes edit locally',
        })
        .toBe(offlineValue);

      // Negative assertion: B must NOT converge while A is offline. B stays on the
      // baseline value for the whole window (no path for the edit to reach B yet).
      await expect
        .poll(async () => b.page.locator('#notes-textarea').inputValue(), {
          timeout: 3000,
          intervals: [300, 500, 700, 900],
          message: 'B should still show the baseline while A is offline',
        })
        .toBe(baseline);
      // Re-confirm explicitly: B has NOT yet seen the offline value.
      expect(
        await b.page.locator('#notes-textarea').inputValue(),
        'B leaked A\'s offline edit before reconnect',
      ).toBe(baseline);

      // ── Step 4: A comes back ONLINE → auto-reconnect (no reload) → B converges ─
      await a.context.setOffline(false);

      // Reconnect backoff starts ~1s; the window 'online' handler reopens
      // immediately; the sync handshake flows A's buffered edit to the DO and on
      // to B. Generous poll (~15s) to absorb backoff + DO debounce + WS RTT.
      await expect
        .poll(async () => b.page.locator('#notes-textarea').inputValue(), {
          timeout: 15000,
          intervals: [500, 1000, 1000, 1500, 2000, 2000, 3000],
          message: 'B never converged to A\'s offline edit after reconnect (auto-reconnect/merge failed)',
        })
        .toBe(offlineValue);

      // A still shows its own value too (sanity: no rollback on reconnect).
      expect(
        await a.page.locator('#notes-textarea').inputValue(),
        'A lost its offline edit after reconnect',
      ).toBe(offlineValue);
    } finally {
      // Best-effort: ensure A is back online before teardown.
      await a.context.setOffline(false).catch(() => { /* ignore */ });
      await a.context.close();
      await b.context.close();
    }
  });
});
