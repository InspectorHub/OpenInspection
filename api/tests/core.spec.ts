import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

const BASE = 'http://localhost:8789';

/** Fetch a CSRF token by visiting GET /login. Required for POST /api/auth/login. */
async function getCsrfToken(request: APIRequestContext): Promise<string> {
  const pageRes = await request.get(`${BASE}/login`);
  const setCookie = pageRes.headers()['set-cookie'] ?? '';
  const match = setCookie.match(/__Host-csrf_token=([^;]+)/);
  return match?.[1] ?? '';
}

// ─── Global Setup ─────────────────────────────────────────────────────────────
// Attempt to initialize the workspace. If the DB is empty, POST /setup creates
// it. If already set up (409), we note that we can't rely on the test credentials.
//
// Tests that require known credentials or a real tenantId use `setupToken`:
//   - setupToken is set only when setup returns 200 (fresh install)
//   - If 409 (pre-existing DB), those tests skip gracefully.

let setupToken = '';  // JWT from a fresh setup �?has the real tenantId in claims
let agentToken = '';  // JWT for an agent user, created in global beforeAll

const AGENT_EMAIL = 'agent.testuser@example.com';

test.beforeAll(async ({ request }) => {
  // ── 1. Initialize workspace ──────────────────────────────────────────────
  const res = await request.post(`${BASE}/setup`, {
    data: {
      companyName: 'Test Workspace',
      subdomain: 'dev',
      email: 'admin@example.com',
      password: 'testpassword123',
    },
    headers: { 'Content-Type': 'application/json' },
  });
  // 200 = first-time setup, 409 = already set up �?both are acceptable
  expect([200, 409]).toContain(res.status());
  if (res.status() !== 200) return;

  // Token now travels via the HttpOnly cookie only, not in the JSON body.
  const setupCookie = res.headers()['set-cookie'] ?? '';
  const setupMatch = setupCookie.match(/__Host-inspector_token=([^;]+)/);
  setupToken = setupMatch?.[1] ?? '';
  if (!setupToken) return;

  // ── 2. Create an agent user for agent CRM tests ──────────────────────────
  const invRes = await request.post(`${BASE}/api/admin/invite`, {
    data: { email: AGENT_EMAIL, role: 'agent' },
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${setupToken}` },
  });
  if (invRes.status() !== 201) return;
  const invBody = await invRes.json();
  const inviteToken = new URL(invBody.inviteLink).searchParams.get('token') ?? '';
  if (!inviteToken) return;

  await request.post(`${BASE}/api/auth/join`, {
    data: { token: inviteToken, password: 'agentpass99' },
    headers: { 'Content-Type': 'application/json' },
  });

  const csrf = await getCsrfToken(request);
  const loginRes = await request.post(`${BASE}/api/auth/login`, {
    data: { email: AGENT_EMAIL, password: 'agentpass99' },
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
  });
  if (loginRes.status() !== 200) return;
  const cookie = loginRes.headers()['set-cookie'] ?? '';
  const match = cookie.match(/__Host-inspector_token=([^;]+)/);
  agentToken = match?.[1] ?? '';
});

// ─── API Health ──────────────────────────────────────────────────────────────

test('GET /status returns engine online', async ({ request }) => {
  const res = await request.get(`${BASE}/status`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.status).toBe('Core Engine Online');
});

// ─── Public Pages ─────────────────────────────────────────────────────────────

test('homepage loads and shows booking CTA', async ({ page }) => {
  await page.goto(BASE);
  await expect(page).toHaveTitle(/OpenInspection|InspectorHub/i);
  // Booking CTA link should be present
  const bookLink = page.locator('a[href="/book"]').first();
  await expect(bookLink).toBeVisible();
});

test('booking page loads with inspector selector', async ({ page }) => {
  await page.goto(`${BASE}/book`);
  await expect(page.locator('body')).not.toContainText('Error');
  // Should render a form or booking UI �?not a blank page
  await expect(page.locator('body')).not.toBeEmpty();
});

test('demo report page loads', async ({ page }) => {
  await page.goto(`${BASE}/api/inspections/demo/report`);
  // Should render HTML, not a JSON error
  const contentType = (await page.request.get(`${BASE}/api/inspections/demo/report`))
    .headers()['content-type'];
  expect(contentType).toContain('text/html');
  await expect(page.locator('body')).not.toContainText('"error"');
});

// ─── Login Page ───────────────────────────────────────────────────────────────

test('GET /login renders HTML with email + password form', async ({ page }) => {
  await page.goto(`${BASE}/login`);
  const ct = (await page.request.get(`${BASE}/login`)).headers()['content-type'];
  expect(ct).toContain('text/html');
  await expect(page.locator('input[type="email"], input[name="email"]')).toBeVisible();
  await expect(page.locator('input[type="password"]')).toBeVisible();
});

test('POST /api/auth/login rejects wrong password', async ({ request }) => {
  const csrf = await getCsrfToken(request);
  const res = await request.post(`${BASE}/api/auth/login`, {
    data: { email: 'admin@example.com', password: 'definitely-wrong-password' },
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
  });
  expect(res.status()).toBe(401);
  const body = await res.json();
  expect(body).toHaveProperty('error');
});

test('POST /api/auth/login rejects missing fields', async ({ request }) => {
  const csrf = await getCsrfToken(request);
  const res = await request.post(`${BASE}/api/auth/login`, {
    data: { email: 'admin@example.com' },
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
  });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body).toHaveProperty('error');
});

test('POST /api/auth/login succeeds and sets inspector_token cookie', async ({ request }) => {
  // Only verifiable when setup just created the user with known credentials.
  // If the DB was pre-existing, we cannot guarantee which password was used.
  test.skip(!setupToken, 'Skipping: DB was pre-existing; run against a fresh DB to verify login success');

  // Double-submit CSRF: visit GET /login to mint a __Host-csrf_token cookie, then echo it.
  const pageRes = await request.get(`${BASE}/login`);
  const csrfSetCookie = pageRes.headers()['set-cookie'] ?? '';
  const csrfMatch = csrfSetCookie.match(/__Host-csrf_token=([^;]+)/);
  const csrf = csrfMatch?.[1] ?? '';
  expect(csrf).not.toBe('');

  const res = await request.post(`${BASE}/api/auth/login`, {
    data: { email: 'admin@example.com', password: 'testpassword123' },
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.success).toBe(true);
  expect(body.data?.redirect).toBe('/dashboard');
  // The raw JWT must NOT appear in the response body — authentication is cookie-only for
  // browser clients so the token can't leak to localStorage or JS-visible cookies.
  expect(body.data?.token).toBeUndefined();
  expect(body.token).toBeUndefined();
  const setCookie = res.headers()['set-cookie'];
  expect(setCookie).toBeDefined();
  expect(setCookie).toContain("__Host-inspector_token");
  expect(setCookie).toContain('HttpOnly');
  expect(setCookie).toContain('Secure');
});

test('POST /api/auth/login rejects request without CSRF token', async ({ request }) => {
  const res = await request.post(`${BASE}/api/auth/login`, {
    data: { email: 'anyone@example.com', password: 'whatever' },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status()).toBe(403);
});

// ─── Dashboard Auth Guard ─────────────────────────────────────────────────────

test('GET /dashboard redirects to /login without auth cookie', async ({ page }) => {
  await page.goto(`${BASE}/dashboard`);
  // After redirect, should land on login page
  expect(page.url()).toContain('/login');
});

test('GET /agent-dashboard redirects to /login without auth cookie', async ({ page }) => {
  await page.goto(`${BASE}/agent-dashboard`);
  expect(page.url()).toContain('/login');
});

// ─── Bot Protection ───────────────────────────────────────────────────────────

test('GET /book serves Cloudflare Turnstile script', async ({ page }) => {
  await page.goto(`${BASE}/book`);
  // The main layout always loads the Turnstile JS (widget only renders when TURNSTILE_SITE_KEY is set)
  const html = await page.content();
  expect(html).toContain('challenges.cloudflare.com/turnstile');
});

test('POST /api/public/book with invalid turnstileToken is accepted in dev tenant (Turnstile skipped for dev)', async ({ request }) => {
  // In the dev/demo tenant, bot verification is intentionally bypassed.
  // This test documents that behaviour �?bots cannot abuse a DB-backed tenant via this path.
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const res = await request.post(`${BASE}/api/public/book`, {
    data: {
      propertyAddress: '1 Bot Street',
      date: tomorrow.toISOString(),
      inspectorId: 'demo-inspector',
      clientName: 'Bot Test',
      clientEmail: 'bot@test.com',
      turnstileToken: 'INVALID_TOKEN',
    },
    headers: { 'Content-Type': 'application/json' },
  });
  // dev tenant returns success regardless of turnstile token
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.success).toBe(true);
});

// ─── Public Booking API ───────────────────────────────────────────────────────

test('GET /api/public/inspectors returns demo inspector in dev context', async ({ request }) => {
  const res = await request.get(`${BASE}/api/public/inspectors`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toHaveProperty('inspectors');
  expect(Array.isArray(body.inspectors)).toBe(true);
});

test('GET /api/public/availability returns slots for demo inspector', async ({ request }) => {
  const date = new Date();
  date.setDate(date.getDate() + 1); // tomorrow
  const dateStr = date.toISOString().split('T')[0];

  const res = await request.get(
    `${BASE}/api/public/availability/demo-inspector?date=${dateStr}`
  );
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toHaveProperty('slots');
  expect(Array.isArray(body.slots)).toBe(true);
});

test('POST /api/public/book rejects missing fields', async ({ request }) => {
  const res = await request.post(`${BASE}/api/public/book`, {
    data: {},
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body).toHaveProperty('error');
});

test('POST /api/public/book succeeds in dev context', async ({ request }) => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  const res = await request.post(`${BASE}/api/public/book`, {
    data: {
      propertyAddress: '123 Test Street',
      date: tomorrow.toISOString(),
      inspectorId: 'demo-inspector',
      clientName: 'Test Client',
      clientEmail: 'test@example.com',
    },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.success).toBe(true);
  expect(body.inspectionId).toBeDefined();
});

// ─── Protected API �?Auth Enforcement ────────────────────────────────────────

test('GET /api/inspections blocks unauthenticated requests', async ({ request }) => {
  const res = await request.get(`${BASE}/api/inspections`);
  expect(res.status()).toBe(401);
});

test('POST /api/inspections blocks unauthenticated requests', async ({ request }) => {
  const res = await request.post(`${BASE}/api/inspections`, {
    data: { propertyAddress: '123 Test', templateId: 'tmpl-1' },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status()).toBe(401);
});

test('PATCH /api/inspections/:id/results blocks unauthenticated requests', async ({ request }) => {
  const res = await request.patch(`${BASE}/api/inspections/some-id/results`, {
    data: { data: {} },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status()).toBe(401);
});

// ─── Report Agreement & Signing (demo) ───────────────────────────────────────

test('GET /api/inspections/demo/agreement returns agreement content', async ({ request }) => {
  const res = await request.get(`${BASE}/api/inspections/demo/agreement`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toHaveProperty('agreement');
  expect(body.agreement).toHaveProperty('content');
});

test('POST /api/inspections/demo/sign accepts signature', async ({ request }) => {
  const res = await request.post(`${BASE}/api/inspections/demo/sign`, {
    data: { signatureBase64: 'data:image/png;base64,iVBORw0KGgo=' },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.success).toBe(true);
});

// ─── Checkout (mock fallback when no Stripe key configured) ──────────────────

test('POST /api/inspections/demo/checkout returns mock URL (no Stripe key in dev)', async ({ request }) => {
  const res = await request.post(`${BASE}/api/inspections/demo/checkout`, {
    data: {},
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toHaveProperty('url');
  expect(body.url).toContain('payment-success-mock');
});

// ─── Stripe Webhook ───────────────────────────────────────────────────────────

test('POST /api/inspections/webhook/stripe rejects missing signature', async ({ request }) => {
  const res = await request.post(`${BASE}/api/inspections/webhook/stripe`, {
    data: '{}',
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body).toHaveProperty('error');
});

test('POST /api/inspections/webhook/stripe rejects invalid HMAC signature', async ({ request }) => {
  const res = await request.post(`${BASE}/api/inspections/webhook/stripe`, {
    data: '{"type":"checkout.session.completed"}',
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': 't=1234567890,v1=invalidsignature',
    },
  });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body).toHaveProperty('error');
});

// ─── Payment Success Redirect ─────────────────────────────────────────────────

test('GET /api/inspections/demo/payment-success-mock redirects to report', async ({ request }) => {
  // Follow redirects �?should end at the report URL
  const res = await request.get(`${BASE}/api/inspections/demo/payment-success-mock`);
  expect(res.status()).toBe(200);
  expect(res.url()).toContain('/report');
});

// ─── Join Page ────────────────────────────────────────────────────────────────

test('join page renders HTML', async ({ page }) => {
  await page.goto(`${BASE}/join`);
  const ct = (await page.request.get(`${BASE}/join`)).headers()['content-type'];
  expect(ct).toContain('text/html');
  await expect(page.locator('body')).not.toContainText('"error"');
});

// ─── Setup Wizard ─────────────────────────────────────────────────────────────

test('GET /setup renders HTML (form or redirect to dashboard)', async ({ request }) => {
  // Follows redirects by default �?either shows setup form or dashboard, never errors
  const res = await request.get(`${BASE}/setup`);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/html');
});

test('POST /setup rejects missing fields', async ({ request }) => {
  const res = await request.post(`${BASE}/setup`, {
    data: { companyName: 'Acme', subdomain: 'acme' }, // missing email + password
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body).toHaveProperty('error');
});

test('POST /setup rejects invalid subdomain characters', async ({ request }) => {
  const res = await request.post(`${BASE}/setup`, {
    data: {
      companyName: 'Acme',
      subdomain: 'INVALID SPACES!',
      email: 'admin@example.com',
      password: 'password123',
    },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body.error).toContain('Subdomain');
});

test('POST /setup returns 409 when setup is already complete', async ({ request }) => {
  // By the time this test runs, beforeAll has already seeded the DB.
  const res = await request.post(`${BASE}/setup`, {
    data: {
      companyName: 'Acme',
      subdomain: 'acme',
      email: 'admin2@example.com',
      password: 'password123',
    },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status()).toBe(409);
  const body = await res.json();
  expect(body).toHaveProperty('error');
});

// ─── Auth Enforcement �?Protected Endpoints ───────────────────────────────────

test('GET /api/admin/export blocks unauthenticated requests', async ({ request }) => {
  const res = await request.get(`${BASE}/api/admin/export`);
  expect(res.status()).toBe(401);
});

test('GET /api/agent/my-reports blocks unauthenticated requests', async ({ request }) => {
  const res = await request.get(`${BASE}/api/agent/my-reports`);
  expect(res.status()).toBe(401);
});

test('GET /api/agent/leaderboard blocks unauthenticated requests', async ({ request }) => {
  const res = await request.get(`${BASE}/api/agent/leaderboard`);
  expect(res.status()).toBe(401);
});

test('GET /api/agent/my-reports rejects requests with no role', async ({ request }) => {
  // Malformed JWT (unsigned) �?should be 401
  const res = await request.get(`${BASE}/api/agent/my-reports`, {
    headers: { Authorization: 'Bearer not.a.real.token' },
  });
  expect(res.status()).toBe(401);
});

// ─── Field-Level Merge (PATCH /results) ──────────────────────────────────────
// Creates a real inspection in the DB then patches results twice to verify
// that each PATCH merges fields rather than replacing the whole blob.
//
// Requires a valid JWT with a real tenantId �?only available from a fresh setup.
// Skips gracefully when the DB was pre-existing.

test.describe('field-level merge on inspection results', () => {
  let token = '';
  let inspectionId = '';

  test.beforeAll(async ({ request }) => {
    // We need a token with a tenantId that actually exists in the DB.
    // The setupToken from a fresh run has the real tenantId in its claims.
    if (!setupToken) return;
    token = setupToken;

    // Get the real templateId for this tenant (setup creates one)
    const tmplRes = await request.get(`${BASE}/api/inspections/templates`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (tmplRes.status() !== 200) return;
    const tmplBody = await tmplRes.json();
    const templateId = tmplBody.templates?.[0]?.id;
    if (!templateId) return;

    // Create an inspection with a real tenant + template
    const res = await request.post(`${BASE}/api/inspections`, {
      data: {
        propertyAddress: '99 Merge Lane',
        templateId,
      },
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });
    if (res.status() === 201) {
      const body = await res.json();
      inspectionId = body.inspection?.id ?? '';
    }
  });

  test('two PATCH results calls merge fields (last-write-wins per item)', async ({ request }) => {
    test.skip(!inspectionId, 'Skipping: no inspection created (DB was pre-existing; run against a fresh DB)');

    // First PATCH �?set field_a
    const r1 = await request.patch(`${BASE}/api/inspections/${inspectionId}/results`, {
      data: { data: { field_a: { status: 'Good', notes: 'First note' } } },
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    expect(r1.status()).toBe(200);

    // Second PATCH �?add field_b without repeating field_a
    const r2 = await request.patch(`${BASE}/api/inspections/${inspectionId}/results`, {
      data: { data: { field_b: { status: 'Monitor', notes: 'Second note' } } },
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    expect(r2.status()).toBe(200);

    // GET results �?both fields must be present
    const getRes = await request.get(`${BASE}/api/inspections/${inspectionId}/results`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(getRes.status()).toBe(200);
    const body = await getRes.json();
    expect(body.data).toHaveProperty('field_a');
    expect(body.data).toHaveProperty('field_b');
    expect(body.data.field_a.status).toBe('Good');
    expect(body.data.field_b.status).toBe('Monitor');
  });

  test('third PATCH overwrites existing field_a value (last-write-wins)', async ({ request }) => {
    test.skip(!inspectionId, 'Skipping: no inspection created (DB was pre-existing; run against a fresh DB)');

    // Overwrite field_a with updated value
    await request.patch(`${BASE}/api/inspections/${inspectionId}/results`, {
      data: { data: { field_a: { status: 'Defect', notes: 'Updated note' } } },
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });

    const getRes = await request.get(`${BASE}/api/inspections/${inspectionId}/results`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await getRes.json();
    // field_a updated, field_b preserved from previous test
    expect(body.data.field_a.status).toBe('Defect');
    expect(body.data).toHaveProperty('field_b');
  });
});

// ─── Availability Management �?Auth Enforcement ───────────────────────────────

test('GET /api/availability blocks unauthenticated requests', async ({ request }) => {
  const res = await request.get(`${BASE}/api/availability`);
  expect(res.status()).toBe(401);
});

test('PUT /api/availability blocks unauthenticated requests', async ({ request }) => {
  const res = await request.put(`${BASE}/api/availability`, {
    data: { slots: [] },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status()).toBe(401);
});

test('GET /api/availability/overrides blocks unauthenticated requests', async ({ request }) => {
  const res = await request.get(`${BASE}/api/availability/overrides`);
  expect(res.status()).toBe(401);
});

test('POST /api/availability/overrides blocks unauthenticated requests', async ({ request }) => {
  const res = await request.post(`${BASE}/api/availability/overrides`, {
    data: { date: '2026-12-25', isAvailable: false },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status()).toBe(401);
});

// ─── Availability Management �?Authenticated ─────────────────────────────────

test.describe('availability CRUD (authenticated)', () => {
  let token = '';
  let overrideId = '';

  test.beforeAll(async () => {
    token = setupToken;
  });

  test('PUT /api/availability replaces weekly schedule', async ({ request }) => {
    test.skip(!token, 'Skipping: requires fresh DB');
    const res = await request.put(`${BASE}/api/availability`, {
      data: {
        slots: [
          { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' },
          { dayOfWeek: 3, startTime: '09:00', endTime: '17:00' },
          { dayOfWeek: 5, startTime: '09:00', endTime: '13:00' },
        ],
      },
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.count).toBe(3);
  });

  test('GET /api/availability returns saved slots', async ({ request }) => {
    test.skip(!token, 'Skipping: requires fresh DB');
    const res = await request.get(`${BASE}/api/availability`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.availability)).toBe(true);
    expect(body.availability.length).toBe(3);
    expect(body.availability.every((s: { startTime: string; endTime: string }) => s.startTime && s.endTime)).toBe(true);
  });

  test('PUT /api/availability with empty slots clears the schedule', async ({ request }) => {
    test.skip(!token, 'Skipping: requires fresh DB');
    const res = await request.put(`${BASE}/api/availability`, {
      data: { slots: [] },
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(0);

    // Verify GET now returns empty
    const getRes = await request.get(`${BASE}/api/availability`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const getBody = await getRes.json();
    expect(getBody.availability.length).toBe(0);
  });

  test('PUT /api/availability rejects invalid dayOfWeek', async ({ request }) => {
    test.skip(!token, 'Skipping: requires fresh DB');
    const res = await request.put(`${BASE}/api/availability`, {
      data: { slots: [{ dayOfWeek: 9, startTime: '09:00', endTime: '17:00' }] },
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  test('PUT /api/availability rejects slot missing endTime', async ({ request }) => {
    test.skip(!token, 'Skipping: requires fresh DB');
    const res = await request.put(`${BASE}/api/availability`, {
      data: { slots: [{ dayOfWeek: 1, startTime: '09:00' }] },
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  test('POST /api/availability/overrides adds a block-out date', async ({ request }) => {
    test.skip(!token, 'Skipping: requires fresh DB');
    const res = await request.post(`${BASE}/api/availability/overrides`, {
      data: { date: '2026-12-25', isAvailable: false },
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.override.date).toBe('2026-12-25');
    expect(body.override.isAvailable).toBe(false);
    overrideId = body.override.id;
  });

  test('POST /api/availability/overrides rejects available slot without times', async ({ request }) => {
    test.skip(!token, 'Skipping: requires fresh DB');
    const res = await request.post(`${BASE}/api/availability/overrides`, {
      data: { date: '2026-12-26', isAvailable: true }, // missing startTime/endTime
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  test('POST /api/availability/overrides adds an extra availability slot', async ({ request }) => {
    test.skip(!token, 'Skipping: requires fresh DB');
    const res = await request.post(`${BASE}/api/availability/overrides`, {
      data: { date: '2026-12-26', isAvailable: true, startTime: '10:00', endTime: '14:00' },
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.override.isAvailable).toBe(true);
    expect(body.override.startTime).toBe('10:00');
  });

  test('GET /api/availability/overrides lists all overrides for the user', async ({ request }) => {
    test.skip(!token || !overrideId, 'Skipping: requires overrides from previous tests');
    const res = await request.get(`${BASE}/api/availability/overrides`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.overrides)).toBe(true);
    const found = body.overrides.find((o: { id: string; date: string }) => o.id === overrideId);
    expect(found).toBeDefined();
    expect(found.date).toBe('2026-12-25');
  });

  test('DELETE /api/availability/overrides/:id removes the override', async ({ request }) => {
    test.skip(!token || !overrideId, 'Skipping: requires overrides from previous tests');
    const res = await request.delete(`${BASE}/api/availability/overrides/${overrideId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  test('DELETE /api/availability/overrides/:id returns 404 after deletion', async ({ request }) => {
    test.skip(!token || !overrideId, 'Skipping: requires overrides from previous tests');
    const res = await request.delete(`${BASE}/api/availability/overrides/${overrideId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(404);
  });
});

// ─── Template CRUD �?Auth Enforcement ────────────────────────────────────────

test('POST /api/inspections/templates blocks unauthenticated requests', async ({ request }) => {
  const res = await request.post(`${BASE}/api/inspections/templates`, {
    data: { name: 'Test', schema: {} },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status()).toBe(401);
});

test('PUT /api/inspections/templates/:id blocks unauthenticated requests', async ({ request }) => {
  const res = await request.put(`${BASE}/api/inspections/templates/some-id`, {
    data: { name: 'Updated' },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status()).toBe(401);
});

test('DELETE /api/inspections/templates/:id blocks unauthenticated requests', async ({ request }) => {
  const res = await request.delete(`${BASE}/api/inspections/templates/some-id`);
  expect(res.status()).toBe(401);
});

// ─── Template CRUD �?Authenticated ───────────────────────────────────────────

test.describe('template CRUD (authenticated)', () => {
  let token = '';
  let newTemplateId = '';

  test.beforeAll(async () => {
    token = setupToken;
  });

  test('POST /api/inspections/templates creates a new template', async ({ request }) => {
    test.skip(!token, 'Skipping: requires fresh DB');
    const res = await request.post(`${BASE}/api/inspections/templates`, {
      data: {
        name: 'Commercial Building Inspection',
        schema: {
          sections: [
            {
              id: 'sec_lobby',
              title: 'Lobby',
              items: [{ id: 'item_entrance', title: 'Entrance Doors', type: 'condition' }],
            },
          ],
        },
      },
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.template).toHaveProperty('id');
    expect(body.template.name).toBe('Commercial Building Inspection');
    expect(body.template.version).toBe(1);
    newTemplateId = body.template.id;
  });

  test('POST /api/inspections/templates rejects missing schema', async ({ request }) => {
    test.skip(!token, 'Skipping: requires fresh DB');
    const res = await request.post(`${BASE}/api/inspections/templates`, {
      data: { name: 'Incomplete Template' }, // missing schema
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  test('GET /api/inspections/templates lists the new template', async ({ request }) => {
    test.skip(!token || !newTemplateId, 'Skipping: requires template from previous test');
    const res = await request.get(`${BASE}/api/inspections/templates`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    const found = body.templates.find((t: { id: string; version: number }) => t.id === newTemplateId);
    expect(found).toBeDefined();
    expect(found.version).toBe(1);
  });

  test('PUT /api/inspections/templates/:id updates name and bumps version', async ({ request }) => {
    test.skip(!token || !newTemplateId, 'Skipping: requires template from previous test');
    const res = await request.put(`${BASE}/api/inspections/templates/${newTemplateId}`, {
      data: { name: 'Commercial Building Inspection v2' },
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.template.name).toBe('Commercial Building Inspection v2');
    expect(body.template.version).toBe(2);
  });

  test('PUT /api/inspections/templates/:id returns 404 for unknown id', async ({ request }) => {
    test.skip(!token, 'Skipping: requires fresh DB');
    const res = await request.put(`${BASE}/api/inspections/templates/non-existent-id`, {
      data: { name: 'Ghost Template' },
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(404);
  });

  test('DELETE /api/inspections/templates/:id removes an unused template', async ({ request }) => {
    test.skip(!token || !newTemplateId, 'Skipping: requires template from previous test');
    const res = await request.delete(`${BASE}/api/inspections/templates/${newTemplateId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  test('DELETE /api/inspections/templates/:id returns 404 after deletion', async ({ request }) => {
    test.skip(!token || !newTemplateId, 'Skipping: requires template from previous test');
    const res = await request.delete(`${BASE}/api/inspections/templates/${newTemplateId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(404);
  });

  test('DELETE /api/inspections/templates/:id returns 409 when template is in use', async ({ request }) => {
    test.skip(!token, 'Skipping: requires fresh DB');

    // Get the default template created by setup
    const listRes = await request.get(`${BASE}/api/inspections/templates`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const { templates: tmplList } = await listRes.json();
    const defaultTemplate = tmplList[0];
    if (!defaultTemplate) return;

    // Create an inspection referencing the default template
    await request.post(`${BASE}/api/inspections`, {
      data: { propertyAddress: '42 Lock Lane', templateId: defaultTemplate.id },
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });

    // Attempt to delete the template �?should be blocked
    const delRes = await request.delete(`${BASE}/api/inspections/templates/${defaultTemplate.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(delRes.status()).toBe(409);
    const body = await delRes.json();
    expect(body.error).toContain('used by existing inspections');
  });
});

// ─── Team Invite & Join �?Validation ─────────────────────────────────────────

test('POST /api/auth/join rejects missing token', async ({ request }) => {
  const res = await request.post(`${BASE}/api/auth/join`, {
    data: { password: 'newpassword123' }, // missing token
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body).toHaveProperty('error');
});

test('POST /api/auth/join rejects invalid invite token', async ({ request }) => {
  const res = await request.post(`${BASE}/api/auth/join`, {
    data: { token: 'not-a-real-token', password: 'newpassword123' },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status()).toBe(404);
  const body = await res.json();
  expect(body).toHaveProperty('error');
});

test('POST /api/auth/join rejects short password', async ({ request }) => {
  const res = await request.post(`${BASE}/api/auth/join`, {
    data: { token: 'any-token', password: 'short' },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body).toHaveProperty('error');
});

// ─── Team Invite & Join �?Full Flow ──────────────────────────────────────────

test.describe('invite and join flow (authenticated)', () => {
  let token = '';
  let inviteToken = '';
  const joinEmail = `joiner.${Date.now()}@example.com`;

  test.beforeAll(async () => {
    token = setupToken;
  });

  test('POST /api/admin/invite creates an invite and returns a link', async ({ request }) => {
    test.skip(!token, 'Skipping: requires fresh DB');
    const res = await request.post(`${BASE}/api/admin/invite`, {
      data: { email: joinEmail, role: 'inspector' },
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.inviteLink).toContain('/join?token=');
    expect(body.expiresAt).toBeDefined();
    // Extract token from link
    inviteToken = new URL(body.inviteLink).searchParams.get('token') ?? '';
    expect(inviteToken).not.toBe('');
  });

  test('POST /api/admin/invite rejects invalid role', async ({ request }) => {
    test.skip(!token, 'Skipping: requires fresh DB');
    const res = await request.post(`${BASE}/api/admin/invite`, {
      data: { email: 'anyone@example.com', role: 'superuser' },
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(400);
  });

  test('POST /api/auth/join accepts the invite and creates the user', async ({ request }) => {
    test.skip(!inviteToken, 'Skipping: invite not created (requires fresh DB)');
    const res = await request.post(`${BASE}/api/auth/join`, {
      data: { token: inviteToken, password: 'securepass99' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.redirect).toBe('/dashboard');
    // httpOnly cookie set in response
    const cookie = res.headers()['set-cookie'];
    expect(cookie).toContain("__Host-inspector_token");
  });

  test('POST /api/auth/join rejects a second use of the same token', async ({ request }) => {
    test.skip(!inviteToken, 'Skipping: invite not created (requires fresh DB)');
    const res = await request.post(`${BASE}/api/auth/join`, {
      data: { token: inviteToken, password: 'anotherpass99' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('already been used');
  });

  test('new user from invite can log in with their password', async ({ request }) => {
    test.skip(!inviteToken, 'Skipping: invite not created (requires fresh DB)');
    const csrf = await getCsrfToken(request);
    const res = await request.post(`${BASE}/api/auth/login`, {
      data: { email: joinEmail, password: 'securepass99' },
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    const cookie = res.headers()['set-cookie'];
    expect(cookie).toContain("__Host-inspector_token");
  });
});

// ─── Google Calendar �?Auth Enforcement ───────────────────────────────────────

test('GET /api/calendar/connect returns 401 or 501 when not authenticated or GOOGLE_CLIENT_ID is not configured', async ({ request }) => {
  // JWT middleware fires first (no cookie) �?401. If somehow authenticated but no GOOGLE_CLIENT_ID �?501.
  const res = await request.get(`${BASE}/api/calendar/connect`);
  expect([401, 501, 302]).toContain(res.status());
});

test('DELETE /api/calendar/disconnect returns 401 without auth cookie', async ({ request }) => {
  const res = await request.delete(`${BASE}/api/calendar/disconnect`);
  expect(res.status()).toBe(401);
});

test('POST /api/calendar/sync returns 401 without auth cookie', async ({ request }) => {
  const res = await request.post(`${BASE}/api/calendar/sync`, {
    data: {},
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status()).toBe(401);
});

// ─── Admin M2M Endpoints �?Auth Enforcement ───────────────────────────────────
// These endpoints use Authorization: Bearer {JWT_SECRET} (shared secret), not a user JWT.

test('POST /api/admin/silo rejects request with no Authorization header', async ({ request }) => {
  const res = await request.post(`${BASE}/api/admin/silo`, {
    data: { tenantId: 'some-tenant', siloDbId: 'some-db' },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status()).toBe(401);
});

test('POST /api/admin/silo rejects request with wrong secret', async ({ request }) => {
  const res = await request.post(`${BASE}/api/admin/silo`, {
    data: { tenantId: 'some-tenant', siloDbId: 'some-db' },
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong-secret' },
  });
  expect(res.status()).toBe(401);
});

test('POST /api/admin/silo rejects missing tenantId with correct secret', async ({ request }) => {
  const res = await request.post(`${BASE}/api/admin/silo`, {
    data: { siloDbId: 'some-db' }, // missing tenantId
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fallback_secret_for_local_dev' },
  });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body).toHaveProperty('error');
});

test('POST /api/admin/connect rejects request with no Authorization header', async ({ request }) => {
  const res = await request.post(`${BASE}/api/admin/connect`, {
    data: { subdomain: 'test', stripeConnectAccountId: 'acct_123' },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status()).toBe(401);
});

test('POST /api/admin/connect rejects request with wrong secret', async ({ request }) => {
  const res = await request.post(`${BASE}/api/admin/connect`, {
    data: { subdomain: 'test', stripeConnectAccountId: 'acct_123' },
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong-secret' },
  });
  expect(res.status()).toBe(401);
});

test('POST /api/admin/connect rejects missing fields with correct secret', async ({ request }) => {
  const res = await request.post(`${BASE}/api/admin/connect`, {
    data: { subdomain: 'test' }, // missing stripeConnectAccountId
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fallback_secret_for_local_dev' },
  });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body).toHaveProperty('error');
});

// ─── Password Change �?Auth Enforcement ──────────────────────────────────────

test('POST /api/auth/change-password blocks unauthenticated requests', async ({ request }) => {
  const res = await request.post(`${BASE}/api/auth/change-password`, {
    data: { currentPassword: 'old', newPassword: 'newpassword123' },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status()).toBe(401);
});

// ─── Password Change �?Authenticated ─────────────────────────────────────────
// Uses a dedicated user created via invite so the main admin credentials stay intact.

test.describe('password change (authenticated)', () => {
  let token = '';
  let userToken = '';
  let inviteToken = '';
  const pwEmail = `pwchange.${Date.now()}@example.com`;
  const originalPassword = 'original99';
  const newPassword = 'changed99!';

  test.beforeAll(async ({ request }) => {
    token = setupToken;
    if (!token) return;

    // Create a user we can safely change password for
    const invRes = await request.post(`${BASE}/api/admin/invite`, {
      data: { email: pwEmail, role: 'inspector' },
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    if (invRes.status() !== 201) return;
    const invBody = await invRes.json();
    inviteToken = new URL(invBody.inviteLink).searchParams.get('token') ?? '';

    const joinRes = await request.post(`${BASE}/api/auth/join`, {
      data: { token: inviteToken, password: originalPassword },
      headers: { 'Content-Type': 'application/json' },
    });
    if (joinRes.status() !== 200) return;
    const csrf = await getCsrfToken(request);
    const loginRes = await request.post(`${BASE}/api/auth/login`, {
      data: { email: pwEmail, password: originalPassword },
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    });
    if (loginRes.status() !== 200) return;
    // Parse token from cookie set-cookie header
    const cookie = loginRes.headers()['set-cookie'] ?? '';
    const match = cookie.match(/__Host-inspector_token=([^;]+)/);
    userToken = match?.[1] ?? '';
  });

  test('POST /api/auth/change-password rejects wrong current password', async ({ request }) => {
    test.skip(!userToken, 'Skipping: user setup failed (requires fresh DB)');
    const res = await request.post(`${BASE}/api/auth/change-password`, {
      data: { currentPassword: 'wrongpassword', newPassword: 'newpass99!' },
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error).toContain('incorrect');
  });

  test('POST /api/auth/change-password rejects a new password that is too short', async ({ request }) => {
    test.skip(!userToken, 'Skipping: user setup failed (requires fresh DB)');
    const res = await request.post(`${BASE}/api/auth/change-password`, {
      data: { currentPassword: originalPassword, newPassword: 'short' },
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  test('POST /api/auth/change-password succeeds with correct current password', async ({ request }) => {
    test.skip(!userToken, 'Skipping: user setup failed (requires fresh DB)');
    const res = await request.post(`${BASE}/api/auth/change-password`, {
      data: { currentPassword: originalPassword, newPassword },
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  test('old password is rejected after change', async ({ request }) => {
    test.skip(!userToken, 'Skipping: user setup failed (requires fresh DB)');
    const csrf = await getCsrfToken(request);
    const res = await request.post(`${BASE}/api/auth/login`, {
      data: { email: pwEmail, password: originalPassword },
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    });
    expect(res.status()).toBe(401);
  });

  test('new password works after change', async ({ request }) => {
    test.skip(!userToken, 'Skipping: user setup failed (requires fresh DB)');
    const csrf = await getCsrfToken(request);
    const res = await request.post(`${BASE}/api/auth/login`, {
      data: { email: pwEmail, password: newPassword },
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});

// ─── Inspection CRUD �?Auth Enforcement ──────────────────────────────────────

test('GET /api/inspections blocks unauthenticated list', async ({ request }) => {
  const res = await request.get(`${BASE}/api/inspections`);
  expect(res.status()).toBe(401);
});

test('GET /api/inspections/inspectors blocks unauthenticated requests', async ({ request }) => {
  const res = await request.get(`${BASE}/api/inspections/inspectors`);
  expect(res.status()).toBe(401);
});

test('POST /api/inspections/:id/complete blocks unauthenticated requests', async ({ request }) => {
  const res = await request.post(`${BASE}/api/inspections/some-id/complete`);
  expect(res.status()).toBe(401);
});

// ─── Inspection CRUD �?Authenticated ─────────────────────────────────────────

test.describe('inspection CRUD (authenticated)', () => {
  let token = '';
  let templateId = '';
  let inspectionId = '';

  test.beforeAll(async ({ request }) => {
    token = setupToken;
    if (!token) return;
    const res = await request.get(`${BASE}/api/inspections/templates`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status() === 200) {
      const body = await res.json();
      templateId = body.templates?.[0]?.id ?? '';
    }
  });

  test('POST /api/inspections creates a new inspection', async ({ request }) => {
    test.skip(!token || !templateId, 'Skipping: requires fresh DB with template');
    const res = await request.post(`${BASE}/api/inspections`, {
      data: {
        propertyAddress: '7 Inspection Drive',
        clientName: 'Alice Buyer',
        clientEmail: 'alice@example.com',
        templateId,
      },
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.inspection).toHaveProperty('id');
    expect(body.inspection.status).toBe('draft');
    inspectionId = body.inspection.id;
  });

  test('GET /api/inspections returns list including new inspection', async ({ request }) => {
    test.skip(!token || !inspectionId, 'Skipping: requires inspection from previous test');
    const res = await request.get(`${BASE}/api/inspections`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.inspections)).toBe(true);
    const found = body.inspections.find((i: any) => i.id === inspectionId);
    expect(found).toBeDefined();
    expect(found.propertyAddress).toBe('7 Inspection Drive');
  });

  test('GET /api/inspections/:id returns inspection with template', async ({ request }) => {
    test.skip(!token || !inspectionId, 'Skipping: requires inspection from previous test');
    const res = await request.get(`${BASE}/api/inspections/${inspectionId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.inspection).toHaveProperty('id', inspectionId);
    expect(body.template).toHaveProperty('schema');
    expect(body.template.schema).toHaveProperty('sections');
  });

  test('GET /inspections/:id/form renders mobile field form HTML', async ({ page }) => {
    test.skip(!inspectionId, 'Skipping: requires inspection from previous test');
    await page.goto(`${BASE}/inspections/${inspectionId}/form`);
    const html = await page.content();
    // Form page must include the inspection ID somewhere (used by the JS client)
    expect(html).toContain(inspectionId);
  });

  test('POST /api/inspections/:id/complete marks inspection as completed', async ({ request }) => {
    test.skip(!token || !inspectionId, 'Skipping: requires inspection from previous test');
    const res = await request.post(`${BASE}/api/inspections/${inspectionId}/complete`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  test('GET /api/inspections/:id reflects completed status', async ({ request }) => {
    test.skip(!token || !inspectionId, 'Skipping: requires inspection from previous test');
    const res = await request.get(`${BASE}/api/inspections/${inspectionId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.inspection.status).toBe('completed');
  });
});

// ─── Admin Export �?Authenticated ────────────────────────────────────────────

test('GET /api/admin/export returns full tenant data for admin', async ({ request }) => {
  test.skip(!setupToken, 'Skipping: requires fresh DB');
  const res = await request.get(`${BASE}/api/admin/export`, {
    headers: { Authorization: `Bearer ${setupToken}` },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toHaveProperty('exportedAt');
  expect(body).toHaveProperty('tenantId');
  expect(Array.isArray(body.inspections)).toBe(true);
  expect(Array.isArray(body.templates)).toBe(true);
  expect(Array.isArray(body.agreements)).toBe(true);
});

// ─── Agent CRM �?Authenticated ────────────────────────────────────────────────

test('GET /api/agent/leaderboard returns empty leaderboard for fresh DB', async ({ request }) => {
  test.skip(!setupToken, 'Skipping: requires fresh DB');
  const res = await request.get(`${BASE}/api/agent/leaderboard`, {
    headers: { Authorization: `Bearer ${setupToken}` },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toHaveProperty('leaderboard');
  expect(Array.isArray(body.leaderboard)).toBe(true);
});

test.describe('agent my-reports (authenticated as agent)', () => {
  test('GET /api/agent/my-reports returns empty list for new agent', async ({ request }) => {
    test.skip(!agentToken, 'Skipping: agent setup failed (requires fresh DB)');
    const res = await request.get(`${BASE}/api/agent/my-reports`, {
      headers: { Authorization: `Bearer ${agentToken}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('agentId');
    expect(Array.isArray(body.reports)).toBe(true);
    expect(body.reports).toHaveLength(0);
  });
});

// ─── AI Comment Assist ────────────────────────────────────────────────────────

test('POST /api/ai/comment-assist blocks unauthenticated requests', async ({ request }) => {
  const res = await request.post(`${BASE}/api/ai/comment-assist`, {
    data: { itemLabel: 'Roof', currentNotes: 'Some rust', status: 'Defect' },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status()).toBe(401);
});

test('POST /api/ai/comment-assist returns 500 without GEMINI_API_KEY (missing key error)', async ({ request }) => {
  test.skip(!setupToken, 'Skipping: requires fresh DB');
  const res = await request.post(`${BASE}/api/ai/comment-assist`, {
    data: { text: 'Some rust on panel', context: 'Electrical Panel �?Defect' },
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${setupToken}` },
  });
  // 500 = GEMINI_API_KEY not set (throws "Gemini API Key missing"); 200 = key present and Gemini responded
  expect([200, 500]).toContain(res.status());
});

// ─── DELETE Inspection ────────────────────────────────────────────────────────

test('DELETE /api/inspections/:id blocks unauthenticated requests', async ({ request }) => {
  const res = await request.delete(`${BASE}/api/inspections/some-id`);
  expect(res.status()).toBe(401);
});

test.describe('DELETE /api/inspections/:id (authenticated)', () => {
  let token = '';
  let inspectionId = '';

  test.beforeAll(async ({ request }) => {
    token = setupToken;
    if (!token) return;
    const tmplRes = await request.get(`${BASE}/api/inspections/templates`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (tmplRes.status() !== 200) return;
    const { templates: tmplList } = await tmplRes.json();
    const templateId = tmplList?.[0]?.id;
    if (!templateId) return;

    const res = await request.post(`${BASE}/api/inspections`, {
      data: { propertyAddress: '99 Delete Road', templateId },
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    if (res.status() === 201) {
      const body = await res.json();
      inspectionId = body.inspection?.id ?? '';
    }
  });

  test('DELETE /api/inspections/:id removes the inspection', async ({ request }) => {
    test.skip(!inspectionId, 'Skipping: no inspection (requires fresh DB)');
    const res = await request.delete(`${BASE}/api/inspections/${inspectionId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  test('DELETE /api/inspections/:id returns 404 after deletion', async ({ request }) => {
    test.skip(!inspectionId, 'Skipping: no inspection (requires fresh DB)');
    const res = await request.delete(`${BASE}/api/inspections/${inspectionId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(404);
  });
});

// ─── Team Members ─────────────────────────────────────────────────────────────

test('GET /api/admin/members blocks unauthenticated requests', async ({ request }) => {
  const res = await request.get(`${BASE}/api/admin/members`);
  expect(res.status()).toBe(401);
});

test('GET /api/admin/members returns workspace members and invites', async ({ request }) => {
  test.skip(!setupToken, 'Skipping: requires fresh DB');
  const res = await request.get(`${BASE}/api/admin/members`, {
    headers: { Authorization: `Bearer ${setupToken}` },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body.members)).toBe(true);
  expect(Array.isArray(body.invites)).toBe(true);
  // The admin user created during setup must be in the members list
  const admin = body.members.find((m: any) => m.email === 'admin@example.com');
  expect(admin).toBeDefined();
});

// ─── Agreement Management (CRUD) ─────────────────────────────────────────────

test('GET /api/admin/agreements blocks unauthenticated requests', async ({ request }) => {
  const res = await request.get(`${BASE}/api/admin/agreements`);
  expect(res.status()).toBe(401);
});

test.describe('agreement CRUD (authenticated)', () => {
  let token = '';
  let agreementId = '';

  test.beforeAll(async () => {
    token = setupToken;
  });

  test('POST /api/admin/agreements creates a new agreement', async ({ request }) => {
    test.skip(!token, 'Skipping: requires fresh DB');
    const res = await request.post(`${BASE}/api/admin/agreements`, {
      data: {
        name: 'Standard Service Agreement',
        content: '## Agreement\n\nBy signing you accept the terms.',
      },
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.agreement).toHaveProperty('id');
    expect(body.agreement.name).toBe('Standard Service Agreement');
    expect(body.agreement.version).toBe(1);
    agreementId = body.agreement.id;
  });

  test('POST /api/admin/agreements rejects missing content', async ({ request }) => {
    test.skip(!token, 'Skipping: requires fresh DB');
    const res = await request.post(`${BASE}/api/admin/agreements`, {
      data: { name: 'Incomplete' }, // missing content
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(400);
  });

  test('GET /api/admin/agreements lists agreements', async ({ request }) => {
    test.skip(!token || !agreementId, 'Skipping: requires agreement from previous test');
    const res = await request.get(`${BASE}/api/admin/agreements`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.agreements)).toBe(true);
    const found = body.agreements.find((a: any) => a.id === agreementId);
    expect(found).toBeDefined();
  });

  test('PUT /api/admin/agreements/:id updates content and bumps version', async ({ request }) => {
    test.skip(!token || !agreementId, 'Skipping: requires agreement from previous test');
    const res = await request.put(`${BASE}/api/admin/agreements/${agreementId}`, {
      data: { content: '## Updated Agreement\n\nRevised terms.' },
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.agreement.version).toBe(2);
  });

  test('PUT /api/admin/agreements/:id returns 404 for unknown id', async ({ request }) => {
    test.skip(!token, 'Skipping: requires fresh DB');
    const res = await request.put(`${BASE}/api/admin/agreements/non-existent-id`, {
      data: { name: 'Ghost' },
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(404);
  });

  test('DELETE /api/admin/agreements/:id removes the agreement', async ({ request }) => {
    test.skip(!token || !agreementId, 'Skipping: requires agreement from previous test');
    const res = await request.delete(`${BASE}/api/admin/agreements/${agreementId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  test('DELETE /api/admin/agreements/:id returns 404 after deletion', async ({ request }) => {
    test.skip(!token || !agreementId, 'Skipping: requires agreement from previous test');
    const res = await request.delete(`${BASE}/api/admin/agreements/${agreementId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(404);
  });
});

// ─── Password Reset ───────────────────────────────────────────────────────────

test('POST /api/auth/forgot-password returns 200 for unknown email (no enumeration)', async ({ request }) => {
  const res = await request.post(`${BASE}/api/auth/forgot-password`, {
    data: { email: 'nobody@example.com' },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.success).toBe(true);
});

test('POST /api/auth/forgot-password rejects missing email', async ({ request }) => {
  const res = await request.post(`${BASE}/api/auth/forgot-password`, {
    data: {},
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status()).toBe(400);
});

test('POST /api/auth/reset-password rejects invalid token', async ({ request }) => {
  const res = await request.post(`${BASE}/api/auth/reset-password`, {
    data: { token: 'not-a-real-token', newPassword: 'newpassword123' },
    headers: { 'Content-Type': 'application/json' },
  });
  expect([400, 503]).toContain(res.status());
});

test('POST /api/auth/reset-password rejects short password', async ({ request }) => {
  const res = await request.post(`${BASE}/api/auth/reset-password`, {
    data: { token: 'some-token', newPassword: 'short' },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body).toHaveProperty('error');
});

test('POST /api/auth/forgot-password succeeds for known email', async ({ request }) => {
  test.skip(!setupToken, 'Skipping: requires fresh DB');
  const res = await request.post(`${BASE}/api/auth/forgot-password`, {
    data: { email: 'admin@example.com' },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.success).toBe(true);
});

// ─── Agent Referral Booking Flow ─────────────────────────────────────────────
// Books an inspection via the public booking API with an agentId, then verifies
// the referredByAgentId is stored and visible in the agent's my-reports.

test.describe('agent referral booking end-to-end', () => {
  let agentUserId = '';
  let referredInspectionId = '';

  test.beforeAll(async ({ request }) => {
    if (!agentToken || !setupToken) return;
    // Resolve agent's userId from their my-reports (returns agentId = JWT sub)
    const res = await request.get(`${BASE}/api/agent/my-reports`, {
      headers: { Authorization: `Bearer ${agentToken}` },
    });
    if (res.status() === 200) {
      const body = await res.json();
      agentUserId = body.agentId ?? '';
    }

    if (!agentUserId) return;

    // Create an inspection with referredByAgentId via the authenticated API so both
    // use the same real tenantId (the public /book API uses 'dev' subdomain as tenantId
    // in local dev, which would mismatch the JWT-scoped tenantId in my-reports).
    const tmplRes = await request.get(`${BASE}/api/inspections/templates`, {
      headers: { Authorization: `Bearer ${setupToken}` },
    });
    if (tmplRes.status() !== 200) return;
    const { templates: tmplList } = await tmplRes.json();
    const templateId = tmplList?.[0]?.id;
    if (!templateId) return;

    const res2 = await request.post(`${BASE}/api/inspections`, {
      data: {
        propertyAddress: '42 Referral Road',
        clientName: 'Referred Client',
        clientEmail: 'referred@example.com',
        templateId,
        referredByAgentId: agentUserId,
      },
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${setupToken}` },
    });
    if (res2.status() === 201) {
      const body2 = await res2.json();
      referredInspectionId = body2.inspection?.id ?? '';
    }
  });

  test('POST /api/inspections with referredByAgentId stores the agent reference', async ({ request }) => {
    test.skip(!referredInspectionId, 'Skipping: inspection not created (requires fresh DB)');
    const res = await request.get(`${BASE}/api/inspections/${referredInspectionId}`, {
      headers: { Authorization: `Bearer ${setupToken}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.inspection.referredByAgentId).toBe(agentUserId);
  });

  test('referred inspection appears in agent my-reports', async ({ request }) => {
    test.skip(!referredInspectionId || !agentToken, 'Skipping: no referred inspection (requires fresh DB)');
    const res = await request.get(`${BASE}/api/agent/my-reports`, {
      headers: { Authorization: `Bearer ${agentToken}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.reports)).toBe(true);
    const found = body.reports.find((r: any) => r.id === referredInspectionId);
    expect(found).toBeDefined();
    expect(found.referredByAgentId).toBe(agentUserId);
  });

  test('referred inspection appears in leaderboard', async ({ request }) => {
    test.skip(!referredInspectionId || !setupToken, 'Skipping: no referred inspection (requires fresh DB)');
    const res = await request.get(`${BASE}/api/agent/leaderboard`, {
      headers: { Authorization: `Bearer ${setupToken}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.leaderboard)).toBe(true);
    const entry = body.leaderboard.find((e: any) => e.agentId === agentUserId);
    expect(entry).toBeDefined();
    expect(entry.total).toBeGreaterThanOrEqual(1);
  });

  test('POST /api/public/book with agentId param is accepted (dev tenant skips Turnstile)', async ({ request }) => {
    // Verifies the agentId field is accepted without error in the public booking payload.
    // Note: in dev mode tenantId is the subdomain string 'dev'; agent lookups use the
    // real UUID from JWT, so cross-checking ownership requires authenticated endpoint (above).
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const res = await request.post(`${BASE}/api/public/book`, {
      data: {
        propertyAddress: '99 Agent Ave',
        date: tomorrow.toISOString(),
        inspectorId: 'demo-inspector',
        clientName: 'Agent Referred',
        clientEmail: 'agentref@example.com',
        agentId: 'any-agent-id',
      },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  test('GET /book?agent=<id> renders booking page (agent param captured by page JS)', async ({ page }) => {
    await page.goto(`${BASE}/book?agent=some-agent-id`);
    const html = await page.content();
    expect(html).not.toContain('"error"');
    await expect(page.locator('body')).not.toBeEmpty();
  });
});

// ─── Tenant Tier & Status (M2M) ───────────────────────────────────────────────

test('POST /api/admin/tenant-status rejects missing Authorization', async ({ request }) => {
  const res = await request.post(`${BASE}/api/admin/tenant-status`, {
    data: { subdomain: 'dev', status: 'active' },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status()).toBe(401);
});

test('POST /api/admin/tenant-status rejects wrong secret', async ({ request }) => {
  const res = await request.post(`${BASE}/api/admin/tenant-status`, {
    data: { subdomain: 'dev', status: 'active' },
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong-secret' },
  });
  expect(res.status()).toBe(401);
});

test('POST /api/admin/tenant-status rejects missing subdomain', async ({ request }) => {
  const res = await request.post(`${BASE}/api/admin/tenant-status`, {
    data: { status: 'active' },
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fallback_secret_for_local_dev' },
  });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body).toHaveProperty('error');
});

test.describe('tenant tier/status lifecycle (M2M)', () => {
  test('POST /api/admin/tenant-status updates status and tier', async ({ request }) => {
    test.skip(!setupToken, 'Skipping: requires fresh DB');

    // Promote to pro tier
    const res = await request.post(`${BASE}/api/admin/tenant-status`, {
      data: { subdomain: 'dev', status: 'active', tier: 'pro' },
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fallback_secret_for_local_dev' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    // Restore to free/active so subsequent tests are unaffected
    await request.post(`${BASE}/api/admin/tenant-status`, {
      data: { subdomain: 'dev', status: 'active', tier: 'free' },
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fallback_secret_for_local_dev' },
    });
  });

  test('POST /api/admin/tenant-status omitting tier leaves tier unchanged', async ({ request }) => {
    test.skip(!setupToken, 'Skipping: requires fresh DB');

    // Set status only �?tier should remain as-is
    const res = await request.post(`${BASE}/api/admin/tenant-status`, {
      data: { subdomain: 'dev', status: 'active' }, // no tier field
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fallback_secret_for_local_dev' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  // NOTE: The requireActiveSubscription 402 path cannot be exercised via localhost E2E tests
  // because all requests fall back to the 'dev' subdomain which always bypasses enforcement.
  // The 402 path is covered by the unit-level middleware logic and integration with real tenant
  // subdomains in production. The M2M endpoint that drives state changes is tested above.
  test('requireActiveSubscription: GET requests bypass enforcement even in past_due context', async ({ request }) => {
    test.skip(!setupToken, 'Skipping: requires fresh DB');

    // The dev subdomain bypasses tier guard. We verify that read endpoints remain accessible
    // regardless �?this documents the read-only access guarantee.
    await request.post(`${BASE}/api/admin/tenant-status`, {
      data: { subdomain: 'dev', status: 'past_due' },
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fallback_secret_for_local_dev' },
    });

    // GET requests should succeed regardless (dev subdomain bypass)
    const getRes = await request.get(`${BASE}/api/inspections`, {
      headers: { Authorization: `Bearer ${setupToken}` },
    });
    expect(getRes.status()).toBe(200);

    // Restore
    await request.post(`${BASE}/api/admin/tenant-status`, {
      data: { subdomain: 'dev', status: 'active', tier: 'free' },
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fallback_secret_for_local_dev' },
    });
  });
});

// ─── PATCH Inspection Metadata ────────────────────────────────────────────────

test('PATCH /api/inspections/:id blocks unauthenticated requests', async ({ request }) => {
  const res = await request.patch(`${BASE}/api/inspections/some-id`, {
    data: { propertyAddress: 'New Address' },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status()).toBe(401);
});

test.describe('PATCH /api/inspections/:id (authenticated)', () => {
  let token = '';
  let inspectionId = '';

  test.beforeAll(async ({ request }) => {
    token = setupToken;
    if (!token) return;
    const tmplRes = await request.get(`${BASE}/api/inspections/templates`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (tmplRes.status() !== 200) return;
    const { templates: tmplList } = await tmplRes.json();
    const templateId = tmplList?.[0]?.id;
    if (!templateId) return;

    const res = await request.post(`${BASE}/api/inspections`, {
      data: { propertyAddress: '1 Original Street', clientName: 'Original Client', templateId },
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    if (res.status() === 201) {
      const body = await res.json();
      inspectionId = body.inspection?.id ?? '';
    }
  });

  test('PATCH /api/inspections/:id updates propertyAddress and clientName', async ({ request }) => {
    test.skip(!inspectionId, 'Skipping: no inspection (requires fresh DB)');
    const res = await request.patch(`${BASE}/api/inspections/${inspectionId}`, {
      data: { propertyAddress: '99 Updated Ave', clientName: 'Updated Client' },
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.inspection.propertyAddress).toBe('99 Updated Ave');
    expect(body.inspection.clientName).toBe('Updated Client');
  });

  test('PATCH /api/inspections/:id rejects invalid status', async ({ request }) => {
    test.skip(!inspectionId, 'Skipping: no inspection (requires fresh DB)');
    const res = await request.patch(`${BASE}/api/inspections/${inspectionId}`, {
      data: { status: 'invalid-status' },
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(400);
  });

  test('PATCH /api/inspections/:id rejects empty body', async ({ request }) => {
    test.skip(!inspectionId, 'Skipping: no inspection (requires fresh DB)');
    const res = await request.patch(`${BASE}/api/inspections/${inspectionId}`, {
      data: {},
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(400);
  });

  test('PATCH /api/inspections/:id returns 404 for unknown id', async ({ request }) => {
    test.skip(!token, 'Skipping: requires fresh DB');
    const res = await request.patch(`${BASE}/api/inspections/nonexistent-id`, {
      data: { propertyAddress: 'Anywhere' },
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(404);
  });
});
