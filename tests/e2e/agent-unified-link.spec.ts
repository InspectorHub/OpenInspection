/**
 * Agent unified link E2E (Spec 3 Task 8 — final task of the agent-unified-link
 * plan). Proves the core agent flows end to end in a real browser, mirroring
 * the harness/helpers of tests/e2e/role-aware-sending.spec.ts verbatim (same
 * login/seed/email-sink patterns) rather than reinventing them.
 *
 * Background (see the individual server files cited inline for full detail):
 *   - A report token issued to an agent-kind role (e.g. listing_agent) now
 *     renders the report directly instead of bouncing to the generic
 *     "Sign in to your portal" page — Task 6's loader agent-branch
 *     (app/lib/portal-exchange.ts's `isAgentToken` short-circuit).
 *   - Below the report, <AgentReportActions> (Task 3) shows either "Email me a
 *     sign-in link" (a global agent account already exists for the recipient
 *     email) or "Create your free agent account" (it doesn't).
 *   - "Email me a sign-in link" asks the server (POST /api/agent/magic-login/
 *     request, Task 2) to EMAIL a single-use magic-login link to the agent's
 *     own inbox — the link is never returned to the caller (#258 review #5), so
 *     a leaked/forwarded report link can't be replayed into a session. The agent
 *     opens the emailed link (GET /agent/magic-login?code=) to mint an agent JWT
 *     — a SEPARATE token family from the report token itself. The report token
 *     alone can NEVER mint that session.
 *   - "Create your free agent account" prefills /agent-signup?email=... (Task
 *     4) and, on conversion from a report link, lands the new agent on
 *     /agent-dashboard?welcome=<inspectionId> (Task 4c).
 *   - /agent-login (Task 5) is the agents' own front door: one-step
 *     email+password, or an email-only magic-link fallback using the SAME
 *     single-use code primitive as the report-link flow.
 *
 * A DELIBERATE workaround, mirrored from role-aware-sending.spec.ts's own
 * `toLocalNavUrl` note: any link minted via an RR action's IN-PROCESS
 * API_WORKER self-binding call (portal-inspection.tsx's "agent-magic-login"
 * action, agent/login.tsx's "link" action) is built off `getBaseUrl()`'s
 * fallback Host — that self-binding request never carries the real dev-server
 * Host header, so those links resolve to a base that this test's real browser
 * can't reach (see app/lib/api.server.ts's `http://localhost:8788` default,
 * not the actual :8789 wrangler dev port). Calling the SAME underlying public
 * API endpoints directly over a genuine top-level HTTP request (as this file
 * does via `request.post`/`request.get`) exercises the identical service code
 * (server/services/agent/magic-login.service.ts) and emails the sign-in link
 * built off the REAL request Host — the only difference from clicking the
 * on-page CTA is which HTTP client fires the request, not which server code runs.
 * The emitted link is then read back from the E2E email sink.
 *
 * Run: npm run test:e2e -- agent-unified-link
 */
import { test, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { csrfHeaders } from './helpers/csrf';

const BASE_URL = process.env.FRONTEND_URL || 'http://127.0.0.1:8789';
const NAV_TIMEOUT = 30000;

const ADMIN_EMAIL = 'admin@autotest.com';
const ADMIN_PASSWORD = 'Password123!';

const suffix = Date.now();
const REGISTERED_AGENT = {
  name: `Rae RegisteredAgentFixture ${suffix}`,
  email: `rae.registered.${suffix}@example.com`,
  password: 'AgentPass123!',
};
const UNREGISTERED_AGENT = {
  name: `Uma UnregisteredAgentFixture ${suffix}`,
  email: `uma.unregistered.${suffix}@example.com`,
  password: 'AgentPass456!',
};

// ─── Helpers (verbatim pattern from role-aware-sending.spec.ts) ────────────

/** Log in via POST /api/auth/login and return the __Host-inspector_token JWT. */
async function loginApi(request: APIRequestContext, email: string, password: string): Promise<string> {
  const { headers } = csrfHeaders();
  const res = await request.post(`${BASE_URL}/api/auth/login`, {
    data: { email, password },
    headers: { 'Content-Type': 'application/json', ...headers },
  });
  expect(res.status(), `login ${email}`).toBe(200);
  const cookie = res.headers()['set-cookie'] ?? '';
  const token = cookie.match(/__Host-inspector_token=([^;]+)/)?.[1] ?? '';
  expect(token, 'login must return an auth cookie').toBeTruthy();
  return token;
}

/**
 * POST helper with a small retry for the known `wrangler dev` transient:
 * "Your worker restarted mid-request. Please try sending the request
 * again." — same rationale as role-aware-sending.spec.ts's apiPost. Passing
 * an empty token is fine for public/unauthenticated endpoints (agent-signup,
 * agent-login, agent/login-link, agent/magic-login/request): those paths are
 * allowlisted past jwtAuthMiddleware BEFORE any Authorization header is read.
 */
async function apiPost(
  request: APIRequestContext,
  path: string,
  token: string,
  data: Record<string, unknown>,
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await request.post(`${BASE_URL}${path}`, {
      data,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    if (res.status() !== 503 || attempt === 2) return res;
    const body = await res.text().catch(() => '');
    if (!body.includes('worker restarted mid-request')) return res;
  }
  throw new Error('apiPost retry loop exited without returning');
}

async function apiGet(request: APIRequestContext, path: string, token: string) {
  return request.get(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

/** Extracts the first tokenized portal link (`...token=...`) from an email's HTML body. */
function extractPortalLink(html: string): string | null {
  const match = html.match(/https?:\/\/[^\s"'<>]*token=[^\s"'<>]+/);
  if (!match) return null;
  return match[0].replace(/&amp;/g, '&');
}

/** Extracts the `code=` value from an agent magic-login URL embedded in an email body. */
function extractMagicLoginCode(html: string): string | null {
  const match = html.match(/magic-login\?code=([^\s"'<>&]+)/);
  return match ? match[1] : null;
}

/**
 * Polls the E2E email sink a few times before giving up. The report-send and
 * signup emails are sent synchronously inside their handlers (sink already
 * populated by the time the triggering response returns), but the
 * agent-login-link email is deferred via `c.executionCtx.waitUntil` for
 * timing-equalization (server/api/agent/login.ts) — its actual send can land
 * a beat after the action's response reaches the browser.
 */
async function pollLastEmail(
  request: APIRequestContext,
  to: string,
): Promise<{ subject: string; html: string; text: string | null }> {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 10; attempt++) {
    const res = await request.get(`${BASE_URL}/api/__test__/last-email?to=${encodeURIComponent(to)}`);
    lastStatus = res.status();
    if (lastStatus === 200) return (await res.json()).data;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`sink never captured an email to ${to} (last status ${lastStatus})`);
}

async function newFreshPage(page: Page): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await page.context().browser()!.newContext();
  const freshPage = await context.newPage();
  return { page: freshPage, close: () => context.close() };
}

// ─── Shared state ────────────────────────────────────────────────────────────

let adminToken = '';
let buyerAgentRoleProfileId = '';
let templateId = '';

let registeredAgentContactId = '';
let inspectionAId = '';
/** Set by test 1 — the registered agent's durable report link, reused by test 4. */
let registeredPortalUrl = '';

let unregisteredAgentContactId = '';
let inspectionBId = '';

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe.serial('Agent unified link (Spec 3 Task 8)', () => {
  test.beforeAll(async ({ request }) => {
    adminToken = await loginApi(request, ADMIN_EMAIL, ADMIN_PASSWORD);

    // Role profiles are seeded per tenant by seedRoleProfiles during POST
    // /api/auth/setup (the `api` project this project depends on) — same
    // lookup pattern as role-aware-sending.spec.ts. Deliberately buyer_agent,
    // NOT listing_agent: server/services/agent/referral.ts's listReferrals
    // (which /agent-dashboard reads) associates an agent with an inspection
    // ONLY through the buyer_agent inspection_people row (see its
    // getAgentReferralFilter + the buyer_agent-scoped contactRoleProfiles
    // join) — a listing_agent-keyed person never surfaces in referrals, even
    // though it's still kind: 'agent' for token/capability purposes.
    const rolesRes = await apiGet(request, '/api/role-profiles', adminToken);
    expect(rolesRes.status(), 'role profiles must be listable').toBe(200);
    const roles = ((await rolesRes.json()).data ?? []) as Array<{ id: string; key: string; label: string }>;
    const buyerAgentRole = roles.find((r) => r.key === 'buyer_agent');
    expect(buyerAgentRole, 'buyer_agent role profile must be seeded').toBeTruthy();
    buyerAgentRoleProfileId = buyerAgentRole!.id;

    const richItem = (id: string, label: string) => ({
      id,
      label,
      type: 'rich' as const,
      ratingOptions: ['Inspected', 'Repair'],
      tabs: { information: [], limitations: [], defects: [] },
    });
    const tplRes = await apiPost(request, '/api/inspections/templates', adminToken, {
      name: `Agent-Unified-Link Template ${suffix}`,
      schema: {
        schemaVersion: 2,
        sections: [{ id: 's_general', title: 'General', items: [richItem('roof', 'Roof')] }],
      },
    });
    expect(tplRes.status(), 'template must be created').toBe(201);
    templateId = (await tplRes.json()).data?.template?.id as string;
    expect(templateId, 'no template id returned').toBeTruthy();

    // --- Scenario 1 fixture: a listing agent contact who ALREADY has a
    // global agent account, on a published inspection. ---
    const regContactRes = await apiPost(request, '/api/contacts', adminToken, {
      type: 'agent',
      name: REGISTERED_AGENT.name,
      email: REGISTERED_AGENT.email,
    });
    expect(regContactRes.status(), 'registered agent contact must be created').toBe(201);
    registeredAgentContactId = (await regContactRes.json()).data?.contact?.id as string;
    expect(registeredAgentContactId, 'no contact id returned').toBeTruthy();

    const insARes = await apiPost(request, '/api/inspections', adminToken, {
      propertyAddress: `200 Agent Unified Link Ave ${suffix}`,
      clientName: 'Agent Link Client A',
      clientEmail: `agent-link-client-a.${suffix}@example.com`,
      templateId,
    });
    expect(insARes.status(), 'inspection A must be created').toBe(201);
    inspectionAId = (await insARes.json()).data?.inspection?.id as string;
    expect(inspectionAId, 'no inspection id returned').toBeTruthy();

    const addRegAgentRes = await apiPost(request, `/api/inspections/${inspectionAId}/people`, adminToken, {
      contactId: registeredAgentContactId,
      roleProfileId: buyerAgentRoleProfileId,
    });
    expect(addRegAgentRes.status(), 'registered agent must be added to inspection A').toBe(201);

    const completeARes = await apiPost(request, `/api/inspections/${inspectionAId}/complete`, adminToken, {});
    expect(completeARes.status(), 'inspection A must complete').toBe(200);
    const publishARes = await apiPost(request, `/api/inspections/${inspectionAId}/publish`, adminToken, {});
    expect(publishARes.status(), 'inspection A report must publish').toBe(200);

    // Register the global agent account BEFORE any report-context probe, so
    // scenario 1 finds hasAccount: true. Public endpoint — empty token is
    // fine (isAgentPublic allowlists this path before any auth check).
    const signupRes = await apiPost(request, '/api/agent-signup', '', {
      email: REGISTERED_AGENT.email,
      password: REGISTERED_AGENT.password,
      name: REGISTERED_AGENT.name,
    });
    expect(signupRes.status(), 'registered agent global account must be created').toBe(200);

    // --- Scenario 2 fixture: a listing agent contact with NO global agent
    // account, on its own published inspection. ---
    const unregContactRes = await apiPost(request, '/api/contacts', adminToken, {
      type: 'agent',
      name: UNREGISTERED_AGENT.name,
      email: UNREGISTERED_AGENT.email,
    });
    expect(unregContactRes.status(), 'unregistered agent contact must be created').toBe(201);
    unregisteredAgentContactId = (await unregContactRes.json()).data?.contact?.id as string;
    expect(unregisteredAgentContactId, 'no contact id returned').toBeTruthy();

    const insBRes = await apiPost(request, '/api/inspections', adminToken, {
      propertyAddress: `201 Agent Unified Link Ave ${suffix}`,
      clientName: 'Agent Link Client B',
      clientEmail: `agent-link-client-b.${suffix}@example.com`,
      templateId,
    });
    expect(insBRes.status(), 'inspection B must be created').toBe(201);
    inspectionBId = (await insBRes.json()).data?.inspection?.id as string;
    expect(inspectionBId, 'no inspection id returned').toBeTruthy();

    const addUnregAgentRes = await apiPost(request, `/api/inspections/${inspectionBId}/people`, adminToken, {
      contactId: unregisteredAgentContactId,
      roleProfileId: buyerAgentRoleProfileId,
    });
    expect(addUnregAgentRes.status(), 'unregistered agent must be added to inspection B').toBe(201);

    const completeBRes = await apiPost(request, `/api/inspections/${inspectionBId}/complete`, adminToken, {});
    expect(completeBRes.status(), 'inspection B must complete').toBe(200);
    const publishBRes = await apiPost(request, `/api/inspections/${inspectionBId}/publish`, adminToken, {});
    expect(publishBRes.status(), 'inspection B report must publish').toBe(200);
  });

  test('Scenario 1 — registered agent: report link renders + "Email me a sign-in link" -> emailed code -> authenticated /agent-dashboard', async ({
    page,
    request,
  }) => {
    const sendRes = await apiPost(request, `/api/inspections/${inspectionAId}/send-report-pdf`, adminToken, {
      recipients: [{ contactId: registeredAgentContactId, roleKey: 'buyer_agent' }],
    });
    expect(sendRes.status(), 'send-report-pdf to the registered agent').toBe(200);

    const email = await pollLastEmail(request, REGISTERED_AGENT.email);
    expect(String(email.html)).toContain('token=');
    const portalUrl = extractPortalLink(String(email.html));
    expect(portalUrl, 'registered agent email must contain a tokenized portal link').toBeTruthy();
    registeredPortalUrl = portalUrl!;

    const { page: freshPage, close } = await newFreshPage(page);
    try {
      await freshPage.goto(portalUrl!, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT });

      // Task 6: an agent-kind report token renders the report directly — NOT
      // the generic "Sign in to your portal" bounce (the pre-Task-6 behavior
      // for a non-client role — see role-aware-sending.spec.ts's own header
      // comment for why that WAS correct there, before this branch existed).
      await expect(freshPage.getByRole('heading', { name: 'Sign in to your portal' })).toHaveCount(0);
      await expect(freshPage.getByTestId('agent-report-actions')).toBeVisible({ timeout: 10000 });

      const workspaceCta = freshPage.getByTestId('agent-report-workspace-cta');
      await expect(workspaceCta).toBeVisible();
      await expect(workspaceCta).toHaveText('Email me a sign-in link');

      // Drive the SAME exchange the CTA's click posts through
      // (POST /api/agent/magic-login/request) directly over a real top-level
      // request — see the file header for why this, not a UI click, is the
      // robust way to prove the redeem in this harness. The endpoint EMAILS the
      // single-use sign-in link to the agent's own inbox (never returns it), so
      // it answers { sent: true } and we fetch the link from the email sink —
      // this is the takeover-hardening from #258 review #5.
      const reportToken = new URL(portalUrl!).searchParams.get('token');
      expect(reportToken, 'portal link must carry ?token=').toBeTruthy();

      const magicRes = await request.post(`${BASE_URL}/api/agent/magic-login/request`, {
        data: { tenant: 'e2e-agent-unified-link', inspectionId: inspectionAId, token: reportToken },
        headers: { 'Content-Type': 'application/json' },
      });
      expect(magicRes.status(), 'magic-login/request for a registered agent').toBe(200);
      const magicBody = await magicRes.json();
      expect(magicBody.data?.sent, 'request must report { sent: true } (link is emailed, never returned)').toBe(true);

      // The sign-in link email lands AFTER the report email already in the sink
      // (deferred via waitUntil), so poll until the latest email carries a
      // magic-login code rather than the report link.
      let code: string | null = null;
      for (let attempt = 0; attempt < 15; attempt++) {
        const em = await pollLastEmail(request, REGISTERED_AGENT.email);
        code = extractMagicLoginCode(String(em.html));
        if (code) break;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      expect(code, 'the emailed sign-in link must contain a magic-login code').toBeTruthy();

      await freshPage.goto(`${BASE_URL}/agent/magic-login?code=${code}`, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT });
      expect(freshPage.url()).toContain('/agent-dashboard');
      await expect(freshPage.getByRole('heading', { name: 'Agent Dashboard' })).toBeVisible({ timeout: 10000 });
      await expect(freshPage.getByTestId(`referral-row-${inspectionAId}`)).toBeVisible({ timeout: 10000 });
    } finally {
      await close();
    }
  });

  test('Scenario 2 — unregistered agent: report link renders + signup CTA converts -> welcome on /agent-dashboard', async ({
    page,
    request,
  }) => {
    const sendRes = await apiPost(request, `/api/inspections/${inspectionBId}/send-report-pdf`, adminToken, {
      recipients: [{ contactId: unregisteredAgentContactId, roleKey: 'buyer_agent' }],
    });
    expect(sendRes.status(), 'send-report-pdf to the unregistered agent').toBe(200);

    const email = await pollLastEmail(request, UNREGISTERED_AGENT.email);
    const portalUrl = extractPortalLink(String(email.html));
    expect(portalUrl, 'unregistered agent email must contain a tokenized portal link').toBeTruthy();

    const { page: freshPage, close } = await newFreshPage(page);
    try {
      await freshPage.goto(portalUrl!, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT });

      await expect(freshPage.getByTestId('agent-report-actions')).toBeVisible({ timeout: 10000 });
      const signupCta = freshPage.getByTestId('agent-report-signup-cta');
      await expect(signupCta).toBeVisible();
      await expect(signupCta).toHaveText('Create your free agent account');
      const href = await signupCta.getAttribute('href');
      expect(href).toContain('/agent-signup?email=');
      expect(decodeURIComponent(href!)).toContain(UNREGISTERED_AGENT.email);

      await signupCta.click();
      await freshPage.waitForURL(/\/agent-signup/, { timeout: NAV_TIMEOUT });

      // Task 4 — email prefilled from the CTA's ?email= query param.
      await expect(freshPage.getByLabel('Work email')).toHaveValue(UNREGISTERED_AGENT.email);

      await freshPage.getByLabel('Full name').fill(UNREGISTERED_AGENT.name);
      await freshPage.getByLabel('Password').fill(UNREGISTERED_AGENT.password);
      await freshPage.getByRole('button', { name: 'Create account' }).click();

      // Task 4c — a converting agent lands on /agent-dashboard?welcome=<id>,
      // with that inspection highlighted in their referrals.
      await freshPage.waitForURL(/\/agent-dashboard\?welcome=/, { timeout: NAV_TIMEOUT });
      await expect(
        freshPage.getByText("Welcome! Here's the inspection you were just added to."),
      ).toBeVisible({ timeout: 10000 });
      const row = freshPage.getByTestId(`referral-row-${inspectionBId}`);
      await expect(row).toBeVisible({ timeout: 10000 });
      await expect(row).toHaveAttribute('data-welcome-highlight', 'true');
    } finally {
      await close();
    }
  });

  test('Scenario 3 — /agent-login: password one-step login, then email-me-a-link fallback', async ({ page }) => {
    await page.goto(`${BASE_URL}/agent-login`, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT });
    await expect(page.getByRole('heading', { name: 'Agent sign in' })).toBeVisible({ timeout: 10000 });

    const passwordForm = page.locator('form').filter({ has: page.getByRole('button', { name: 'Log In' }) });
    await passwordForm.getByLabel('Email address').fill(REGISTERED_AGENT.email);
    await passwordForm.getByLabel('Password').fill(REGISTERED_AGENT.password);
    await passwordForm.getByRole('button', { name: 'Log In' }).click();

    // Task 5 — one step, no email round-trip.
    await page.waitForURL(/\/agent-dashboard/, { timeout: NAV_TIMEOUT });
    await expect(page.getByRole('heading', { name: 'Agent Dashboard' })).toBeVisible({ timeout: 10000 });

    // Back to /agent-login for the magic-link fallback (public page, no
    // auth gate — works regardless of the current session).
    await page.goto(`${BASE_URL}/agent-login`, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT });
    const linkForm = page
      .locator('form')
      .filter({ has: page.getByRole('button', { name: 'Email me a sign-in link instead' }) });
    await linkForm.getByLabel('Email address').fill(REGISTERED_AGENT.email);
    await linkForm.getByRole('button', { name: 'Email me a sign-in link instead' }).click();

    await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible({ timeout: 10000 });

    const email = await pollLastEmail(page.context().request, REGISTERED_AGENT.email);
    const code = extractMagicLoginCode(String(email.html));
    expect(code, 'login-link email must contain a magic-login code').toBeTruthy();

    // Build the redeem URL against BASE_URL directly rather than trusting the
    // email's own origin — see the file header: this link was minted via the
    // RR action's in-process self-binding call, whose Host resolves to the
    // getApiUrl() default, not this real dev-server port.
    await page.goto(`${BASE_URL}/agent/magic-login?code=${code}`, {
      waitUntil: 'networkidle',
      timeout: NAV_TIMEOUT,
    });
    expect(page.url()).toContain('/agent-dashboard');
    await expect(page.getByRole('heading', { name: 'Agent Dashboard' })).toBeVisible({ timeout: 10000 });
  });

  test('Scenario 4 — security: the report link alone never authenticates /agent-dashboard, and a redeemed code fails on reuse', async ({
    page,
    request,
  }) => {
    // Part A — open the durable report link (no redeem), then try to reach
    // /agent-dashboard directly in that same, still-unauthenticated context.
    const { page: freshPage, close } = await newFreshPage(page);
    try {
      await freshPage.goto(registeredPortalUrl, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT });
      await expect(freshPage.getByTestId('agent-report-actions')).toBeVisible({ timeout: 10000 });

      await freshPage.goto(`${BASE_URL}/agent-dashboard`, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT });
      // requireToken() (app/lib/session.server.ts) finds no session/cookie —
      // the report token was never exchanged for one — and bounces to /login.
      expect(freshPage.url()).toContain('/login');
      await expect(freshPage.getByRole('heading', { name: 'Agent Dashboard' })).toHaveCount(0);
    } finally {
      await close();
    }

    // Part B — a redeemed magic-login code fails on second use. Mint a FRESH
    // code (independent of any consumed by earlier scenarios) from the same
    // durable report token, then redeem it twice.
    const reportToken = new URL(registeredPortalUrl).searchParams.get('token');
    expect(reportToken, 'registeredPortalUrl must still carry ?token=').toBeTruthy();

    // Earlier scenarios already emailed this agent a sign-in code, and the sink
    // returns the LATEST email — so capture that stale code first and then wait
    // for THIS request's fresh code to supersede it (the link is emailed now,
    // never returned — #258 review #5).
    let prevCode: string | null = null;
    try {
      prevCode = extractMagicLoginCode(String((await pollLastEmail(request, REGISTERED_AGENT.email)).html));
    } catch {
      prevCode = null;
    }

    const magicRes = await request.post(`${BASE_URL}/api/agent/magic-login/request`, {
      data: { tenant: 'e2e-agent-unified-link', inspectionId: inspectionAId, token: reportToken },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(magicRes.status()).toBe(200);
    expect((await magicRes.json()).data?.sent, 'request must report { sent: true }').toBe(true);

    let code: string | null = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      const em = await pollLastEmail(request, REGISTERED_AGENT.email);
      const c = extractMagicLoginCode(String(em.html));
      if (c && c !== prevCode) { code = c; break; }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    expect(code, 'a fresh magic-login code must be emailed').toBeTruthy();
    const loginUrl = `${BASE_URL}/agent/magic-login?code=${code}`;

    const first = await request.get(loginUrl, { maxRedirects: 0 });
    expect(first.status(), 'first redeem must succeed').toBe(302);
    expect(first.headers()['location']).toContain('/agent-dashboard');
    expect(first.headers()['set-cookie'] ?? '', 'first redeem must mint the session cookie').toContain(
      '__Host-inspector_token',
    );

    const second = await request.get(loginUrl, { maxRedirects: 0 });
    expect(second.status(), 'second redeem of the SAME code must fail').toBe(302);
    expect(second.headers()['location']).toContain('/agent-login');
    expect(second.headers()['location']).toContain('error=expired_link');
    expect(second.headers()['set-cookie'], 'second redeem must NOT mint a cookie').toBeUndefined();
  });

  // TODO(agent-unified-link): SaaS OAuth E2E needs mocked-OIDC + portal
  // harness; core tenant-null SSO handoff is unit-covered by
  // tests/unit/portal/agent-sso-handoff.spec.ts. Not built here per the Task 8
  // brief (best-effort, skip rather than construct a mock-OIDC/portal harness
  // from scratch).
  test.skip('Scenario 5 — SaaS Google-OAuth agent-mode -> tenant-null SSO -> /agent-dashboard (needs mocked-OIDC + portal harness)', async () => {
    // Intentionally empty — see TODO above.
  });
});
