/**
 * Role-aware report sending E2E (Spec 2 Task 8 — final task of the
 * role-aware-sending plan).
 *
 * Proves the MANUAL "Send report" modal (Task 7) end to end: a report can be
 * delivered to a NON-client role (the listing agent) with its OWN
 * role-keyed, tokenized portal link — not just to the primary client. This
 * is the synchronous path (`POST /{id}/send-report-pdf`), which the modal
 * posts to directly; the whole send happens inside the request/action, so
 * there is nothing to poll or await beyond the fetcher settling.
 *
 *   1. Seed a dedicated template + inspection via the API (NOT the shared
 *      `editor-seed` fixture — steps 3 below flip GLOBAL inspection/report
 *      status via /complete + /publish, which several editor-seed-dependent
 *      specs, e.g. inspection-lifecycle.spec.ts, assume stays in_progress).
 *   2. Add a listing agent (kind=agent, a non-client role) as a person via
 *      POST /{id}/people, alongside the inspection's own primary client.
 *   3. POST /{id}/complete then /{id}/publish to reach reportStatus=published
 *      (required before the hub's "Send report" button renders — see
 *      inspection-hub.tsx's reportPublished branch).
 *   4. Open the hub, click "Send report", select ONLY the listing agent,
 *      submit.
 *   5. Assert the E2E email sink recorded an email addressed to the listing
 *      agent (not the client) whose body contains a tokenized portal link,
 *      then follow that link with NO staff auth. Per Spec 3 (agent unified
 *      link) `capabilitiesForKind('agent')` now sets `selfRetrieveReport:
 *      true`, so the link lands on the report with the agent action banner
 *      (`agent-report-actions`) rather than the client "Sign in to your
 *      portal" gate. The role-aware SECURITY guarantee is preserved a layer
 *      down: the portal's `/exchange` route still refuses to mint a client
 *      `__Host-portal_session` cookie for an agent kind — it returns
 *      `agent: true` with no Set-Cookie (server/api/portal.ts) — so an
 *      agent's per-inspection token can view THIS report but can never unlock
 *      the client hub. Mirrors agent-unified-link.spec's fresh-open checks.
 *   6. A second case: a one-off email + role profile picked directly in the
 *      modal (no pre-existing `inspection_people` row), showing the
 *      recipient list generalizes beyond people already on the inspection.
 *   7. AUTO `report.published` delivery (the 5-min cron -> AutomationService.
 *      flush): grepping `server/api/test-hooks.ts` (the only application
 *      test-only router, mounted at `/api/__test__`) turns up no flush/
 *      scheduled-trigger poke — only `/last-email` (E2E_EMAIL_SINK-gated)
 *      exists. But `wrangler dev` itself exposes a debug-only route for this
 *      (its own startup banner prints "Scheduled Workers are not
 *      automatically triggered during local development... curl
 *      http://127.0.0.1:8789/cdn-cgi/handler/scheduled") — that invokes the
 *      REAL `server/scheduled.ts` `scheduled()` handler, i.e. the exact
 *      production cron body, not a stand-in. It does not exist outside
 *      `wrangler dev`, so it adds no production surface. We use it: the
 *      buyer_agent recipient rule is seeded ACTIVE by default (see
 *      server/services/automation/report-email.ts's header comment), and
 *      /complete (step 3) already fired the `report.published` trigger, so a
 *      buyer agent person added before /complete has a pending
 *      `automation_logs` row waiting for this flush.
 *
 * Run: npm run test:e2e -- role-aware-sending
 */
import { test, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { csrfHeaders } from './helpers/csrf';

const BASE_URL = process.env.FRONTEND_URL || 'http://127.0.0.1:8789';
const NAV_TIMEOUT = 30000;

const ADMIN_EMAIL = 'admin@autotest.com';
const ADMIN_PASSWORD = 'Password123!';

const suffix = Date.now();
const LISTING_AGENT = {
  name: `Rae ListingAgentFixture ${suffix}`,
  email: `rae.listing.${suffix}@example.com`,
};
const BUYER_AGENT = {
  name: `Bo BuyerAgentFixture ${suffix}`,
  email: `bo.buyer.${suffix}@example.com`,
};
const ONE_OFF_EMAIL = `oneoff.recipient.${suffix}@example.com`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
 * again." (a local-only miniflare isolate-recycle hiccup, distinct from any
 * app-level error — see docs/developers/05_testing.md's flake guidance and
 * playwright.config.ts's own CI-retries comment for the same class of local
 * dev-server flake). POST isn't auto-retried by the platform, so retry once
 * here rather than let a dev-server hiccup fail an otherwise-correct test.
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
  // Unreachable — the loop above always returns.
  throw new Error('apiPost retry loop exited without returning');
}

async function apiGet(request: APIRequestContext, path: string, token: string) {
  return request.get(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function gotoAuth(page: Page, path: string, token: string) {
  await page.setExtraHTTPHeaders({ Cookie: `__Host-inspector_token=${token}` });
  await page.goto(`${BASE_URL}${path}`, { timeout: NAV_TIMEOUT, waitUntil: 'networkidle' });
}

/** Extracts the first tokenized portal link (`...token=...`) from an email's HTML body. */
function extractPortalLink(html: string): string | null {
  const match = html.match(/https?:\/\/[^\s"'<>]*token=[^\s"'<>]+/);
  if (!match) return null;
  return match[0].replace(/&amp;/g, '&');
}

/**
 * Rebase a portal link onto BASE_URL's origin, keeping its path/query
 * (which carries the real minted token) verbatim. The email's own origin is
 * built server-side from `getBaseUrl()` off the REQUEST that triggered the
 * send — for the manual "Send report" action that request is the RR action's
 * in-process `API_WORKER` self-binding call, whose synthetic internal Host
 * resolves to a bare "localhost" (no port), not the real dev server address
 * Playwright drives. That is a pre-existing characteristic of the BFF's
 * self-binding plumbing (server/lib/url.ts getBaseUrl(), unrelated to this
 * plan's work) — not a defect this task should paper over by weakening the
 * `token=` assertion. Substituting only the origin still exercises the REAL
 * token minted for this recipient.
 */
function toLocalNavUrl(rawUrl: string): string {
  const u = new URL(rawUrl);
  const base = new URL(BASE_URL);
  return `${base.origin}${u.pathname}${u.search}`;
}

// ─── Shared state ────────────────────────────────────────────────────────────

let adminToken = '';
let inspectionId = '';
let propertyAddress = '';
let listingAgentRoleProfileId = '';
let oneOffRoleLabel = '';

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe.serial('Role-aware report sending (Spec 2 Task 8)', () => {
  test.beforeAll(async ({ request }) => {
    adminToken = await loginApi(request, ADMIN_EMAIL, ADMIN_PASSWORD);

    // Role profiles are seeded per tenant by seedRoleProfiles (server/lib/
    // people/default-role-profiles.ts) during POST /api/auth/setup (the `api`
    // project this project depends on). Resolve the ids we need by key.
    const rolesRes = await apiGet(request, '/api/role-profiles', adminToken);
    expect(rolesRes.status(), 'role profiles must be listable').toBe(200);
    const roles = ((await rolesRes.json()).data ?? []) as Array<{
      id: string;
      key: string;
      label: string;
    }>;
    const listingAgentRole = roles.find((r) => r.key === 'listing_agent');
    expect(listingAgentRole, 'listing_agent role profile must be seeded').toBeTruthy();
    listingAgentRoleProfileId = listingAgentRole!.id;
    const buyerAgentRole = roles.find((r) => r.key === 'buyer_agent');
    expect(buyerAgentRole, 'buyer_agent role profile must be seeded').toBeTruthy();
    const buyerAgentRoleProfileId = buyerAgentRole!.id;
    const attorneyRole = roles.find((r) => r.key === 'attorney');
    expect(attorneyRole, 'attorney role profile must be seeded').toBeTruthy();
    oneOffRoleLabel = attorneyRole!.label;

    // Contacts for the listing agent and buyer agent — both NON-client roles
    // (kind=agent).
    const contactRes = await apiPost(request, '/api/contacts', adminToken, {
      type: 'agent',
      name: LISTING_AGENT.name,
      email: LISTING_AGENT.email,
    });
    expect(contactRes.status(), 'listing agent contact must be created').toBe(201);
    const listingAgentContactId = (await contactRes.json()).data?.contact?.id as string;
    expect(listingAgentContactId, 'no contact id returned').toBeTruthy();

    const buyerAgentContactRes = await apiPost(request, '/api/contacts', adminToken, {
      type: 'agent',
      name: BUYER_AGENT.name,
      email: BUYER_AGENT.email,
    });
    expect(buyerAgentContactRes.status(), 'buyer agent contact must be created').toBe(201);
    const buyerAgentContactId = (await buyerAgentContactRes.json()).data?.contact?.id as string;
    expect(buyerAgentContactId, 'no contact id returned').toBeTruthy();

    // Dedicated template + inspection (see file header for why this doesn't
    // reuse the shared editor-seed inspection).
    const richItem = (id: string, label: string) => ({
      id,
      label,
      type: 'rich' as const,
      ratingOptions: ['Inspected', 'Repair'],
      tabs: { information: [], limitations: [], defects: [] },
    });
    const tplRes = await apiPost(request, '/api/inspections/templates', adminToken, {
      name: `Role-Aware-Sending Template ${suffix}`,
      schema: {
        schemaVersion: 2,
        sections: [{ id: 's_general', title: 'General', items: [richItem('roof', 'Roof')] }],
      },
    });
    expect(tplRes.status(), 'template must be created').toBe(201);
    const templateId = (await tplRes.json()).data?.template?.id as string;
    expect(templateId, 'no template id returned').toBeTruthy();

    propertyAddress = `100 Role Aware Sending Ave ${suffix}`;
    const insRes = await apiPost(request, '/api/inspections', adminToken, {
      propertyAddress,
      clientName: 'Role Sending Client',
      clientEmail: `role-sending-client.${suffix}@example.com`,
      templateId,
    });
    expect(insRes.status(), 'inspection must be created').toBe(201);
    inspectionId = (await insRes.json()).data?.inspection?.id as string;
    expect(inspectionId, 'no inspection id returned').toBeTruthy();

    // Add the listing agent AND the buyer agent as people on the inspection,
    // alongside the primary client the create call above already resolved.
    // Both must be attached BEFORE /complete below: that route fires the
    // report.published automation trigger synchronously, which resolves +
    // snapshots recipients for every ACTIVE rule at that instant (a person
    // added afterwards would never get a pending automation_logs row).
    const addPersonRes = await apiPost(request, `/api/inspections/${inspectionId}/people`, adminToken, {
      contactId: listingAgentContactId,
      roleProfileId: listingAgentRoleProfileId,
    });
    expect(addPersonRes.status(), 'listing agent must be added to the inspection').toBe(201);
    const addBuyerAgentRes = await apiPost(request, `/api/inspections/${inspectionId}/people`, adminToken, {
      contactId: buyerAgentContactId,
      roleProfileId: buyerAgentRoleProfileId,
    });
    expect(addBuyerAgentRes.status(), 'buyer agent must be added to the inspection').toBe(201);

    // Reach reportStatus=published. computePublishReadiness has nothing to
    // block on (no defects rated), and publishInspection only requires
    // inspection.status === completed — so /complete then /publish (both
    // with default bodies) is enough. /complete already fires the
    // report.published automation trigger (buyer_agent's rule is seeded
    // ACTIVE), enqueuing the pending automation_logs row the AUTO-delivery
    // test below flushes.
    const completeRes = await apiPost(request, `/api/inspections/${inspectionId}/complete`, adminToken, {});
    expect(completeRes.status(), 'inspection must complete').toBe(200);
    const publishRes = await apiPost(request, `/api/inspections/${inspectionId}/publish`, adminToken, {});
    expect(publishRes.status(), 'report must publish').toBe(200);
  });

  test('manual "Send report" -> the listing agent (a non-client role) gets their own tokenized link', async ({
    page,
    request,
  }) => {
    await gotoAuth(page, `/inspections/${inspectionId}`, adminToken);
    await expect(page.getByRole('heading', { name: 'Report', exact: true })).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: 'Send report', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Select ONLY the listing agent — the client (also listed) stays
    // unchecked, so a successful send with an email to the agent (and none
    // to the client) proves the recipient list is role-driven, not a
    // hardcoded client re-send.
    const listingAgentRow = dialog.locator('label').filter({ hasText: LISTING_AGENT.name });
    await expect(listingAgentRow).toBeVisible({ timeout: 10000 });
    await listingAgentRow.locator('input[type="checkbox"]').check();

    await dialog.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 10000 });

    // The sink captures the actual outbound send.
    const sink = await request.get(
      `${BASE_URL}/api/__test__/last-email?to=${encodeURIComponent(LISTING_AGENT.email)}`,
    );
    expect(sink.status(), 'sink must have captured an email to the listing agent').toBe(200);
    const { data } = await sink.json();
    expect(String(data.html)).toContain('token=');

    const portalUrl = extractPortalLink(String(data.html));
    expect(portalUrl, 'listing agent email must contain a tokenized portal link').toBeTruthy();

    // Follow the link with NO staff auth — a brand new context carries no
    // cookies at all. Per Spec 3 the agent unified link no longer bounces to the
    // client "Sign in to your portal" gate: an agent (selfRetrieveReport: true)
    // lands on the report with the agent action banner, while the portal
    // /exchange route still refuses to mint a client __Host-portal_session cookie
    // for an agent kind (it returns `agent: true`, no Set-Cookie) — so the client
    // hub stays locked. Mirrors agent-unified-link.spec's fresh-open assertions.
    const freshContext = await page.context().browser()!.newContext();
    try {
      const freshPage = await freshContext.newPage();
      await freshPage.goto(toLocalNavUrl(portalUrl!), { waitUntil: 'networkidle', timeout: NAV_TIMEOUT });
      await expect(freshPage.getByRole('heading', { name: 'Sign in to your portal' })).toHaveCount(0);
      await expect(freshPage.getByTestId('agent-report-actions')).toBeVisible({ timeout: 10000 });
    } finally {
      await freshContext.close();
    }
  });

  test('one-off email + role in the modal also gets its own tokenized link', async ({ page, request }) => {
    await gotoAuth(page, `/inspections/${inspectionId}`, adminToken);
    await page.getByRole('button', { name: 'Send report', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByPlaceholder('name@example.com').fill(ONE_OFF_EMAIL);
    // Not getByLabel('Role'): the people checkboxes' wrapping <label> text
    // (name + roleLabel + email) collides with a substring match against
    // "Role" for at least one seeded role label, so target the modal's only
    // <select> element directly (the one-off role picker is the sole select
    // control in this dialog).
    await dialog.locator('select').selectOption({ label: oneOffRoleLabel });

    await dialog.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 10000 });

    const sink = await request.get(`${BASE_URL}/api/__test__/last-email?to=${encodeURIComponent(ONE_OFF_EMAIL)}`);
    expect(sink.status(), 'sink must have captured an email to the one-off recipient').toBe(200);
    const { data } = await sink.json();
    expect(String(data.html)).toContain('token=');
  });

  test('AUTO report.published cron delivery -> the buyer agent gets a role-keyed link via the real scheduled() handler', async ({
    request,
  }) => {
    // wrangler dev's debug-only scheduled-trigger route invokes the actual
    // server/scheduled.ts scheduled() export (see file header) — this is the
    // same AutomationService.flush() call production's 5-min cron makes, not
    // a stand-in. The buyer_agent report.published rule is seeded ACTIVE, and
    // beforeAll already attached the buyer agent + fired /complete, so there
    // is a pending automation_logs row waiting to be flushed.
    const flushRes = await request.get(`${BASE_URL}/cdn-cgi/handler/scheduled`);
    expect(flushRes.ok(), 'the local scheduled-trigger endpoint must respond').toBeTruthy();

    const sink = await request.get(
      `${BASE_URL}/api/__test__/last-email?to=${encodeURIComponent(BUYER_AGENT.email)}`,
    );
    expect(sink.status(), 'sink must have captured the AUTO report.published email to the buyer agent').toBe(200);
    const { data } = await sink.json();
    expect(String(data.html)).toContain('token=');
    // The cron path (server/scheduled.ts) passes `env.APP_BASE_URL || ''` as
    // buildPortalUrl's base — unlike the manual send-report-pdf route, it has
    // no per-request Host header to fall back to. This standalone dev/test
    // deployment sets no APP_BASE_URL, so the minted link is origin-relative
    // (`/portal/<slug>/i/<id>?token=...`) rather than absolute — expected here,
    // not a defect (a real deploy always configures APP_BASE_URL). Match the
    // portal path + token param directly rather than requiring an absolute
    // http(s) URL (extractPortalLink, used by the manual-send case above).
    expect(String(data.html)).toMatch(/\/portal\/[^\s"'<>]*token=[^\s"'<>]+/);
  });
});
