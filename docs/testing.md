# Testing — apps/core

End-to-end tests use [Playwright](https://playwright.dev/). Tests run against a live local dev server — no mocking, no test database. Hits real Worker endpoints backed by Wrangler's local D1 and R2 emulation.

## Quick Start

```bash
# Terminal 1
npm run dev          # http://localhost:8788

# Terminal 2
npm run test:e2e
```

## Test Results

| Tests | Pass | Skip | Fail |
|---|---|---|---|
| 128 | 128 | 0 | 0 |

All 128 tests pass on a **fresh database**. Tests that require known credentials skip gracefully when run against a pre-existing database.

## Fresh DB vs Pre-existing DB

`beforeAll` runs `POST /setup` to initialise the workspace:

- **200 (first run)** — `setupToken` is stored and shared across all authenticated blocks. All 128 tests execute.
- **409 (already seeded)** — `setupToken` stays empty. Tests that depend on known credentials or a specific DB state skip gracefully with a clear message.

**To run the full suite against a fresh database:**

```bash
rm -rf .wrangler/state/v3/d1
npm run db:migrate
npm run dev

# In another terminal:
npx playwright test
```

## Test Structure

| Section | What it covers |
|---|---|
| API Health | `GET /status` |
| Public Pages | Homepage, booking page, demo report |
| Login Page | HTML render, field validation, credential check, cookie set |
| Dashboard Auth Guard | Unauthenticated access redirects to `/login` |
| Bot Protection | Turnstile script present; dev-tenant bypass documented |
| Public Booking API | `GET /inspectors`, `GET /availability/:id`, `POST /book` |
| Protected API Enforcement | All protected routes return 401 without a token |
| Agreement & Signing | Demo agreement fetch and e-signature POST |
| Checkout & Stripe | Mock checkout URL, webhook signature validation, payment-success redirect |
| Join Page | HTML render |
| Setup Wizard | Field validation, subdomain format, 409 on re-run |
| Field-Level Merge | PATCH results merges fields; last-write-wins per item key |
| Availability CRUD | Auth enforcement + full CRUD (PUT schedule, POST/GET/DELETE overrides) |
| Template CRUD | Auth enforcement + create/update/version-bump/delete + 409 when in use |
| Invite & Join Flow | `POST /api/admin/invite` → token → `POST /api/auth/join` → login |
| Password Change | Auth enforcement, wrong-password rejection, success, old/new login checks |
| Password Reset | `POST /forgot-password` (no-enumeration, 200 for unknown email) + `POST /reset-password` (invalid token, short password) |
| Inspection CRUD | Create, list, get with template, complete, status reflects update |
| DELETE Inspection | Auth enforcement, removal, 404 after deletion |
| Admin Export | Full tenant data export for admin/owner |
| Team Members | `GET /api/admin/members` returns members + pending invites |
| Agreement CRUD | Auth enforcement + create/list/update (version bump)/delete + 404 lifecycle |
| Agent Referral Booking | Create inspection with `referredByAgentId`, verify in `my-reports` and leaderboard |
| Agent CRM | `GET /api/agent/my-reports` (agent-scoped), `GET /api/agent/leaderboard` (admin-scoped) |
| Google Calendar | Auth enforcement on connect/disconnect/sync |
| Admin M2M Endpoints | `POST /api/admin/silo`, `POST /api/admin/connect` auth + field validation |
| Tenant Tier/Status (M2M) | `POST /api/admin/tenant-status` auth + validation + tier/status update lifecycle |
| AI Comment Assist | Auth enforcement; 500 without `GEMINI_API_KEY` |

## Key Flows

### Invite & Join Flow

1. Admin calls `POST /api/admin/invite` → `inviteLink` returned with `token` query param
2. New user POSTs `{ token, password }` to `POST /api/auth/join`
3. httpOnly `inspector_token` cookie is set; user can log in immediately
4. Re-using the same token returns **400** `already been used`

### Password Reset Flow

1. `POST /api/auth/forgot-password` — always returns **200** (no email enumeration)
2. KV-backed one-time token stored with 1-hour TTL
3. `POST /api/auth/reset-password` — validates token, updates password hash, deletes token
4. Invalid/expired token returns **400**; password under 8 chars returns **400**

### Agent Referral Flow

1. Admin creates inspection with `referredByAgentId` via `POST /api/inspections`
2. Agent calls `GET /api/agent/my-reports` — sees inspections where `referredByAgentId` matches their JWT `sub`
3. Admin calls `GET /api/agent/leaderboard` — referral counts grouped by agent
4. Public booking via `POST /api/public/book` with `agentId` body field also stores the referral
   (Note: dev-mode tenantId is the subdomain string `'dev'`, not the UUID — verified separately via authenticated endpoint)

### Tenant Tier/Status Sync

1. Portal sends `POST /api/admin/tenant-status` with `Authorization: Bearer {JWT_SECRET}`
2. Core updates D1 and deletes the `tenant:{subdomain}` KV cache entry
3. Next request reads fresh tenant record from D1 (no stale cache)
4. The `dev` subdomain always bypasses tier enforcement — GET requests remain accessible regardless of status

### Password Change Flow

1. Wrong `currentPassword` → **401**
2. `newPassword` shorter than 8 chars → **400**
3. Correct `currentPassword` + valid `newPassword` → **200**
4. Old password rejected by `POST /api/auth/login` → **401**
5. New password accepted → **200**

## Graceful Skip Pattern

Tests that need a real tenantId use `setupToken` from `beforeAll`:

```typescript
test('protected action', async ({ request }) => {
  test.skip(!setupToken, 'Skipping: requires fresh DB');
  // ...
});
```

Tests with inter-test state dependencies (create → update → delete) use a shared variable in a `test.describe` block:

```typescript
test.describe('agreement CRUD (authenticated)', () => {
  let agreementId = '';

  test('POST creates agreement', async ({ request }) => {
    // ...stores agreementId
  });

  test('DELETE removes agreement', async ({ request }) => {
    test.skip(!agreementId, 'Skipping: requires agreement from previous test');
    // ...
  });
});
```

## Playwright Config

```typescript
export default defineConfig({
  testDir: './tests',
  timeout: 15000,
  use: { headless: true },
});
```

Tests run serially (1 worker) — some describe blocks have stateful dependencies (create → update → delete).

## Useful Commands

```bash
npx playwright test --grep "availability"          # run one section
npx playwright test --grep "agent referral"
npx playwright test --grep "agreement CRUD"
npx playwright test --reporter=list                # verbose output
npx playwright test --reporter=html && open playwright-report/index.html
```

## CI Notes

- Dev server must be running before tests.
- `npm run db:migrate` must run at least once before `npm run dev`.
- Local D1 state: `.wrangler/state/v3/d1/` — delete to reset.
- Real API keys (Resend, Stripe, Gemini) are not required. Calls are skipped or use mock fallbacks when keys are absent.
- **Turnstile is required** — `TURNSTILE_SECRET_KEY` must be set even for local dev and CI. Use Cloudflare's always-pass test secret (`1x0000000000000000000000000000000AA`). If absent, `POST /api/book` throws a 500 error.
- The Cloudflare Turnstile test keys in `.dev.vars.example` always pass validation — safe for CI.
