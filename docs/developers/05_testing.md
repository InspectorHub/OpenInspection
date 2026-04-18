# Testing Guide

## Overview

Tests are end-to-end (E2E) Playwright tests that run against a live local dev server. There are no unit tests â€?the codebase is small enough that E2E coverage is sufficient.

All tests live in `tests/core.spec.ts`. Authentication uses real JWT tokens obtained through `POST /setup` and `POST /api/auth/login` in the global `beforeAll` hook â€?no separate JWT helper file.

**Current coverage: 128 tests, 128 passing.**

---

## Prerequisites

- Dev server must be running before tests start
- Node.js 18+
- Local D1 migrations applied (`npm run db:migrate`)

---

## Running Tests

In two terminals:

**Terminal 1 â€?start the dev server:**
```bash
cd apps/core
npm run dev
```

**Terminal 2 â€?run the tests:**
```bash
cd apps/core
npm run test:e2e
```

For a full run (all 128 tests), start from a **fresh database**:

```bash
rm -rf .wrangler/state/v3/d1
npm run db:migrate
npm run dev
# then in another terminal:
npx playwright test
```

---

## Test Architecture

### Global Setup

`beforeAll` in `core.spec.ts` does three things:

1. **Initialises the workspace** â€?`POST /setup` with known credentials. Returns `setupToken` (JWT) on first run (HTTP 200), or skips credential-dependent tests if DB is pre-seeded (HTTP 409).
2. **Creates an agent user** â€?invites and joins a test agent, stores `agentToken` for agent CRM tests.
3. All describe blocks that need auth use `setupToken` or `agentToken` directly â€?no mock tokens.

### Stateful Test Blocks

Tests with create-then-verify dependencies are grouped in `test.describe` blocks with shared variables:

```typescript
test.describe('agreement CRUD (authenticated)', () => {
  let agreementId = '';

  test('POST /api/admin/agreements creates agreement', async ({ request }) => {
    // ...stores agreementId
  });

  test('PUT /api/admin/agreements/:id bumps version', async ({ request }) => {
    test.skip(!agreementId, 'Skipping: requires agreement from previous test');
    // ...
  });
});
```

Tests run serially (1 worker) so describe-scoped state is safe.

### Graceful Skip Pattern

```typescript
test('some authenticated action', async ({ request }) => {
  test.skip(!setupToken, 'Skipping: DB was pre-existing; run against a fresh DB');
  // ...
});
```

---

## What the Tests Cover

| Section | Tests | Notes |
|---|---|---|
| API Health | 1 | `GET /status` |
| Public Pages | 3 | Homepage, booking page, demo report |
| Login Page | 4 | HTML render, validation, success, cookie |
| Dashboard Auth Guard | 2 | `/dashboard` and `/agent-dashboard` redirect to `/login` |
| Bot Protection | 2 | Turnstile script present; dev-tenant bypass |
| Public Booking API | 4 | Inspectors list, availability slots, book success, book validation |
| Protected API Enforcement | 7 | 401 for unauthenticated calls across core routes |
| Agreement & Signing | 2 | Demo agreement fetch and e-signature |
| Checkout & Stripe | 4 | Mock URL, webhook auth, HMAC rejection, payment-success |
| Join Page | 1 | HTML render |
| Setup Wizard | 4 | GET render, field validation, subdomain format, 409 re-run |
| Field-Level Merge | 3 | PATCH merges; last-write-wins; third PATCH overwrites |
| Availability CRUD | 10 | Auth + PUT schedule + POST/GET/DELETE overrides + edge cases |
| Template CRUD | 9 | Auth + create/update/delete + version bump + 409 in-use guard |
| Invite & Join Flow | 6 | Invite â†?join â†?login; duplicate token rejection |
| Password Change | 7 | Auth + wrong password + too short + success + old/new login |
| Password Reset | 5 | No enumeration, missing fields, invalid token, short password, known email |
| Inspection CRUD | 7 | Create, list, get with template, form HTML, complete, status reflects |
| DELETE Inspection | 3 | Auth + remove + 404 after deletion |
| Admin Export | 1 | Full tenant data returned |
| Team Members | 2 | Auth + list members + invites |
| Agreement CRUD | 7 | Auth + create/list/update/delete + version bump + 404 lifecycle |
| Agent Referral | 5 | `referredByAgentId` stored, my-reports, leaderboard, public book, page |
| Agent CRM | 3 | Auth + my-reports (agent-scoped) + leaderboard (admin-scoped) |
| Google Calendar | 3 | Auth enforcement on connect/disconnect/sync |
| Admin M2M (silo/connect) | 6 | Auth + field validation for both endpoints |
| Tenant Tier/Status M2M | 6 | Auth + validation + tier update + GET bypass in past_due |
| AI Comment Assist | 2 | Auth + 500/200 without/with Gemini key |

---

## Writing New Tests

### Authenticated endpoint (uses setupToken from beforeAll):

```typescript
test('GET /api/inspections returns list', async ({ request }) => {
  test.skip(!setupToken, 'Skipping: requires fresh DB');
  const res = await request.get(`${BASE}/api/inspections`, {
    headers: { Authorization: `Bearer ${setupToken}` },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body.inspections)).toBe(true);
});
```

### Public endpoint:

```typescript
test('booking page renders', async ({ page }) => {
  await page.goto(`${BASE}/book`);
  await expect(page.locator('body')).not.toBeEmpty();
});
```

### M2M endpoint (uses shared secret, not user JWT):

```typescript
test('POST /api/admin/silo stores silo mapping', async ({ request }) => {
  const res = await request.post(`${BASE}/api/admin/silo`, {
    data: { tenantId: 'some-tenant', siloDbId: 'some-db' },
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer fallback_secret_for_local_dev',
    },
  });
  expect(res.status()).toBe(200);
});
```

---

## Type Checking & Linting

Run before committing:

```bash
npm run type-check   # tsc --noEmit
npm run lint         # ESLint
```

ESLint is configured to warn (not error) on `no-explicit-any` and `no-unused-vars`. `console.warn/error/info` are allowed; `console.log` produces a warning.

---

## Local Dev vs. Test Environment

The project distinguishes between your active development environment and the automated test runtime to prevent port conflicts:

| Environment | Port | Database | Purpose |
|---|---|---|---|
| **Development** (`npm run dev`) | `8788` | `openinspection-db` (local) | Manual testing and UI development. |
| **E2E Tests** (`npm run test:e2e`) | `8789` | `openinspection-db` (local) | Automated Playwright tests. |

The `test:e2e` command automatically starts its own instance of Wrangler on port **8789**. This allows you to keep your dev server running on 8788 while tests run in isolation.

The `tenantId` fallback in local dev is `'dev'` â€?the subdomain router skips the DB lookup when the subdomain matches `'dev'` or is absent. Demo data is served automatically by public endpoints in this mode.

> **Note on public booking + agent referral:** `POST /api/public/book` uses the subdomain string `'dev'` as `tenantId` in local dev (no DB tenant lookup). This differs from the JWT-scoped UUID used by authenticated endpoints. Agent referral end-to-end tests use `POST /api/inspections` (authenticated) to ensure both sides share the same `tenantId`.

### Environment variables for local dev

Copy the example file and fill in your values:

```bash
cp .dev.vars.example .dev.vars
```

| Variable | Local dev value |
|---|---|
| `JWT_SECRET` | `fallback_secret_for_local_dev` |
| `RESEND_API_KEY` | Leave blank â€?emails skipped if absent |
| `SENDER_EMAIL` | Any placeholder string |
| `GEMINI_API_KEY` | Your real key, or leave blank to skip AI |
| `STRIPE_SECRET_KEY` | Leave blank â€?mock checkout used if absent |
| `TURNSTILE_SECRET_KEY` | **Required.** Use Cloudflare always-pass test secret: `1x0000000000000000000000000000000AA`. If absent, `POST /api/book` returns 500. |

---

## Integration Tests (Sandbox Credentials)

`npm run test:integration` runs `tests/core.integration.spec.ts` against the real Stripe, Gemini, and Google Calendar APIs using sandbox/test credentials. Each test calls `test.skip()` automatically when its required credential is absent â€?so `npm run test:e2e` and CI are never affected.

### What's covered

| Test | Credential required |
|---|---|
| Stripe checkout returns `checkout.stripe.com` URL | `STRIPE_SECRET_KEY` |
| Stripe webhook `payment_intent.succeeded` marks inspection paid | `STRIPE_WEBHOOK_SECRET` |
| Gemini `comment-assist` returns professional rewrite | `GEMINI_API_KEY` |
| Gemini `auto-summary` returns defect summary | `GEMINI_API_KEY` |
| Google Calendar `connect` redirects to `accounts.google.com` | `GOOGLE_CLIENT_ID` |
| Google Calendar `sync` creates availability overrides | `INTEGRATION_GOOGLE_REFRESH_TOKEN` + `GOOGLE_CLIENT_ID/SECRET` |

### Step 1 â€?Stripe

1. Sign up at [dashboard.stripe.com](https://dashboard.stripe.com) and enable **Test mode**
2. **Developers â†?API keys** â†?copy `sk_test_...` â†?set as `STRIPE_SECRET_KEY`
3. Install the [Stripe CLI](https://stripe.com/docs/stripe-cli), then run in a dedicated terminal:
   ```bash
   stripe login
   stripe listen --forward-to localhost:8788/api/inspections/webhook/stripe
   # Prints: Your webhook signing secret is whsec_...
   ```
4. Copy `whsec_...` â†?set as `STRIPE_WEBHOOK_SECRET`
5. Keep the CLI running while running `npm run test:integration`

### Step 2 â€?Gemini AI

1. Go to [aistudio.google.com](https://aistudio.google.com) â†?**Get API key** â†?Create API key
2. Copy the key â†?set as `GEMINI_API_KEY`

Free tier is sufficient for testing.

### Step 3 â€?Google Calendar OAuth

**Client credentials:**

1. Go to [console.cloud.google.com](https://console.cloud.google.com) â†?create or select a project
2. **APIs & Services â†?Library** â†?enable **Google Calendar API**
3. **APIs & Services â†?Credentials â†?+ Create Credentials â†?OAuth 2.0 Client ID**
   - Application type: **Web application**
   - Authorized redirect URI: `http://localhost:8788/api/calendar/callback`
4. Copy Client ID â†?`GOOGLE_CLIENT_ID`, Client Secret â†?`GOOGLE_CLIENT_SECRET`

**Refresh token** (one-time manual step):

```bash
# 1. Start the dev server (setup wizard must be complete)
npm run dev

# 2. Log in at http://localhost:8788/login in your browser

# 3. Visit the OAuth connect URL (browser must have the inspector_token cookie)
#    http://localhost:8788/api/calendar/connect
#    â†?Google consent â†?redirects back to /dashboard?calendar=connected

# 4. Extract the stored refresh token
npx wrangler d1 execute openinspection-db --local \
  --command "SELECT google_refresh_token FROM users LIMIT 1"
```

Copy the value â†?set as `INTEGRATION_GOOGLE_REFRESH_TOKEN`

### Step 4 â€?Add to `.dev.vars`

```
JWT_SECRET=fallback_secret_for_local_dev
GEMINI_API_KEY=AIza...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
GOOGLE_CLIENT_ID=....apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
APP_BASE_URL=http://localhost:8788
INTEGRATION_GOOGLE_REFRESH_TOKEN=1//0g...
```

### Step 5 â€?Run

Two terminals required:

```bash
# Terminal 1 â€?dev server
npm run dev

# Terminal 2 â€?Stripe CLI (required for webhook test)
stripe listen --forward-to localhost:8788/api/inspections/webhook/stripe

# Terminal 3 â€?run integration tests
npm run test:integration
```

Tests that lack credentials are reported as **skipped**, not failed.
