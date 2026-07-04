# Testing — apps/openinspection

The single Worker serves both the typed JSON API and the React Router v7 UI, so
tests cover both surfaces. There are four suites, each pinned to a **location**:
a spec's directory alone decides which config runs it. This document is the
canonical reference for the three things you need to get right: **where a spec
lives**, **how to write it**, and **how the run is initialized**.

The layout is enforced — `npm run lint:tests` (`scripts/check-test-layout.mjs`)
fails the build on a misplaced spec, and it runs in `npm run lint` + pre-commit.

---

## 1. Directory classification (`directory = suite`)

| Location | Suite | Command | Config | Runtime |
|---|---|---|---|---|
| `app/**/*.test.{ts,tsx}` (co-located) | web unit | `test:web` | `vitest.config.ts` | happy-dom |
| `tests/unit/<domain>/**/*.spec.ts` | api/service unit | `test:unit` | `vitest.api.config.ts` | node (+ better-sqlite3) |
| `tests/workers/**/*.spec.ts` | worker-runtime | `test:workers` | `vitest.workers.config.ts` | real `workerd` |
| `tests/e2e/*.spec.ts` | end-to-end | `test:e2e` | `playwright.config.ts` (seeds real D1) | built worker + browser |
| `tests/**/*.spec-d.ts` | type-level | `test:types` | `vitest.typecheck.config.ts` | tsc typecheck |

### Choosing a home for a new spec

1. **Frontend component / loader / hook test?** → **co-locate** it beside the
   thing it tests as `Foo.test.tsx` (or `__tests__/Foo.test.tsx`) under `app/`.
   Never put a web test in `tests/`. The retired `tests/web/` tree does not come
   back.
2. **Server-side, no browser.** Does it depend on real Cloudflare runtime
   semantics — Queue delivery, Durable Objects, `workerd`-only APIs?
   - **Yes** → `tests/workers/` (real `workerd` via
     `@cloudflare/vitest-pool-workers`; miniflare bindings are declared inline in
     the config, no wrangler file needed).
   - **No** → `tests/unit/<domain>/` (node env, stubs + `better-sqlite3`).
3. **Full-stack / browser / anything that hits a running worker** →
   `tests/e2e/`. One flat directory; `globalSetup` seeds real D1 so every E2E
   exercises the actual database.

### The rules the gate enforces

- **No flat specs.** `tests/*.spec.ts`, `tests/web/*.spec.ts`, and
  `tests/unit/*.spec.ts` are rejected — a unit spec must live in a **domain
  directory** named after the `server/api/` module or service family it
  exercises (`tests/unit/auth/`, `tests/unit/inspections/`, …).
- **These directories must not exist:** `tests/web/unit`, `tests/web/e2e`,
  `tests/integration`. Frontend co-locates under `app/`; E2E is the single
  `tests/e2e/`.
- **`tests/workers/` stays flat** until a family reaches ~5 specs, then gets a
  domain dir (`tests/workers/mcp/` is the precedent).
- **`tests/e2e/` stays flat:** one spec file = one Playwright project, and every
  project's `testMatch` string literal must resolve to a real file in
  `tests/e2e/` (the gate checks this too).
- **Name specs after behavior, not sprints** (`estimate-range.spec.ts`, not
  `sprint2-s4.spec.ts`). Legacy sprint-named specs are grandfathered.

### Where shared infrastructure lives (NOT spec files)

```
tests/
  global-setup.ts        # E2E: wipe + migrate local D1 (Playwright globalSetup)
  seed-fixtures.ts       # E2E: optional multi-user seed (SEED_E2E=1)
  setup-web.ts           # web-unit hermeticity guard (setupFiles for vitest.config.ts)
  helpers/               # cross-suite helpers (e.g. dev-vars.ts)
  fixtures/              # payloads grouped by event family, versioned filenames
  unit/
    setup-client.ts      # setupFiles for vitest.api.config.ts
    db.ts, mocks.ts      # shared unit infra (better-sqlite3 harness, stubs)
    stubs/, helpers/
    <domain>/*.spec.ts   # ← the only place unit specs go
  workers/*.spec.ts
  e2e/
    *.spec.ts
    helpers/             # e2e-only helpers (csrf.ts, …)
```

---

## 2. Writing tests

### Web unit (`app/**/*.test.tsx`)

- Runs in **happy-dom**, hermetic — **no live worker**. The `tests/setup-web.ts`
  guard **fails any test that makes a real `fetch`**. A loader/action test must
  stub the network: `vi.stubGlobal('fetch', …)` (a stub replaces
  `globalThis.fetch`, so the guard is bypassed for hermetic tests). This exists
  because `getApiUrl()` falls back to `localhost:8788` and the BFF's
  graceful-degradation `catch` would otherwise swallow a real ECONNREFUSED and
  let the test pass while only ever exercising the error path.

### API / service unit (`tests/unit/<domain>/*.spec.ts`)

- Node env, `better-sqlite3` in-memory DB — no worker, no network. Use the shared
  `tests/unit/db.ts` harness and `tests/unit/mocks.ts` stubs.
- A file that needs a DOM opts in per-file with `// @vitest-environment happy-dom`
  (vitest v4 replacement for `environmentMatchGlobs`).
- Prefer asserting **service-layer** behavior directly over reconstructing HTTP.

### Worker-runtime (`tests/workers/*.spec.ts`)

- Runs in real `workerd` via `@cloudflare/vitest-pool-workers`. Reserve this for
  behavior that only reproduces on the real runtime: Queue publish/consume,
  sweeper republish, DLQ writeback, Durable Objects. Bindings are declared inline
  in `vitest.workers.config.ts`.
- When a workers spec hand-maintains DDL (e.g. a `tenant_configs` table), assert
  it against the Drizzle schema instead of trusting a "keep in sync" comment —
  `tests/unit/inline-ddl-schema-sync.spec.ts` is the pattern.

### E2E (`tests/e2e/*.spec.ts`)

- **One spec = one Playwright project.** Register the project in
  `playwright.config.ts` with a `testMatch` pointing at the file. `workers: 1` —
  every project shares ONE `wrangler dev` worker and ONE mutable D1, so specs
  must not assume isolation.
- **Ordering & dependencies.** The `api` project runs **first**: it asserts
  `POST /api/auth/setup` returns a fresh 200 and creates the shared admin
  (`admin@autotest.com` / `Password123!`). Any project that logs in as that admin
  must declare `dependencies: ['api']` so it is runnable in isolation (otherwise
  login 401s — no workspace).
- **Auth is cookie-based.** Page loaders authenticate via the
  `__Host-inspector_token` HttpOnly cookie, not a Bearer header. RBAC is enforced
  on the API, not by page-level role redirects.
- **Serial-block masking.** A `test.describe.serial` block skips the rest of the
  block on the first failure — a later failure can hide behind an earlier one. When
  greening the suite, re-run the **full** suite on a **fresh build** (see below),
  not just the spec you touched.
- **Known-unwritable surfaces.** Some paths can't be driven end-to-end locally
  (e.g. Download-PDF needs a Browser Rendering binding that crashes the isolate
  when absent). Verify the reachable leg (the public-report render path) and keep
  the rest unit-covered; leave a comment saying why.
- **Skips must be honest.** A fully-skipped spec needs a `TODO(...)` naming its
  blocker. Do **not** silently `test.skip(!seededId)` on a seed that always
  400s — that reads as green while testing nothing (`report-gate.spec.ts` is a
  `describe.skip` with a TODO for exactly this reason).

### Type-level (`tests/**/*.spec-d.ts`)

- `expectTypeOf` / `assertType` checks. Collected only by `test:types`; the
  runtime configs ignore `.spec-d.ts`.

---

## 3. Initialization

### `.dev.vars` — `scripts/gen-e2e-dev-vars.mjs`

`wrangler dev` reads secrets from `.dev.vars`, and the specs read `SETUP_CODE`
from it via `tests/helpers/dev-vars.ts`. A fresh checkout has none, so the worker
boots without JWT keys and `/api/auth/setup` fails. The script provisions a
throwaway file and is **idempotent — it never overwrites an existing
`.dev.vars`** (your real local one is respected). Every value is freshly
generated; nothing is hard-coded:

| Key | Value | Why |
|---|---|---|
| `SETUP_CODE` | `000000` | The specs post a fixed `verificationCode: '000000'`; a **documented test fixture**, not a secret. |
| `DISABLE_RATE_LIMIT` | `1` | The suite drives many logins from ONE IP; the limiter is 10/60s per IP and would flakily 429. Honored only by `checkRateLimit` when set; **defaults to enforced**, so no real deploy is affected. |
| `JWT_SECRET` | random 32 bytes | KDF input. |
| `JWT_PRIVATE_KEY_V1` / `JWT_PUBLIC_KEY_V1` | fresh ES256 (P-256) keypair | Single-line PEM (the keyring strips whitespace; `.dev.vars` is parsed line-by-line). |

### `globalSetup` — `tests/global-setup.ts` (E2E only)

Runs once before the Playwright suite. It:

1. `npm run db:migrate` (idempotent) so the schema is current.
2. Enumerates **every** table from `sqlite_master` and wipes them in one batch
   under `PRAGMA defer_foreign_keys = ON` (never a hand-maintained table list —
   that can't stay complete as the schema grows). `d1_migrations` and `_cf_*`
   bookkeeping are preserved so migrations stay applied.
3. Clears all local KV keys (setup codes, `pwchanged:*`, cached tenants).
4. If `SEED_E2E=1`, runs `seedFixtures()` (`tests/seed-fixtures.ts`) — a
   multi-user/multi-tenant seed the subsystem-C/D/E specs need. **Off by
   default** so the self-seeding `api`/`browser` specs still see a clean
   workspace.

It resolves the **same** wrangler config the `webServer` builds against
(`WRANGLER_CONFIG` > `wrangler.local.jsonc` > `wrangler.jsonc`) and targets the
`DB` **binding** (not a database name) via `-c` — an earlier bug executed against
a name absent from the config, so every DELETE errored silently and the DB was
never cleared.

### The E2E worker — `playwright.config.ts`

- `webServer`: `npm run build && wrangler dev -c build/server/wrangler.json
  --port 8789`, `reuseExistingServer: true`.
- **Stale-build trap:** because `reuseExistingServer` is true, a local run serves
  whatever `build/` already exists. To replicate CI's fresh run, clear state
  first:
  ```bash
  rm -rf build .wrangler/state && npm run test:e2e
  ```
- `retries: CI ? 2 : 0` — a backstop for transient WebSocket/Durable-Object blips
  in the collab specs. Locally 0, for fast honest feedback.

### CI (`.github/workflows/ci.yml`)

Two parallel jobs:

- **`verify`** — `npm ci` → `gen-version` → `type-check` → `lint` (eslint +
  `lint:ds` + `lint:erasure` + `lint:migrefs` + `lint:tests`) → `db:check` →
  `test:unit` → `test:workers` → `test:web` → `build` → bundle-size.
- **`e2e`** — `npm ci` → `gen-version` → `node scripts/gen-e2e-dev-vars.mjs` →
  `playwright install chromium` → `npm run test:e2e`. Playwright's `webServer`
  builds + boots the worker; `globalSetup` seeds D1.

CodeQL runs separately (`codeql.yml`).

---

## 4. Gotchas & anti-patterns (hard-won)

**Fake-green tests are the suite's worst failure mode.** A test that never
asserts, swallows the path it claims to cover, or skips itself silently reports
green while testing nothing. Three shapes to reject in review:

- **Silent conditional skip.** `test.skip(!seededId, …)` on a seed that always
  400s → every case skips forever, invisibly. If a precondition genuinely can't
  be met, that's a `TODO(...)`-annotated `describe.skip`, not a runtime skip that
  masquerades as a pass (this is why `report-gate.spec.ts` is a `describe.skip`).
- **Swallowed error path.** A web-unit test whose real `fetch` ECONNREFUSEs and
  is caught by the BFF's graceful-degradation `catch` passes while only ever
  exercising the error branch. The `tests/setup-web.ts` guard fails these — do
  not stub around it just to make it pass.
- **No-assert body.** A test that runs code but asserts nothing (or asserts a
  tautology). Every test must assert an observable outcome.

**Assert against the REAL contract, not a remembered one.** Specs rot when the
API moves under them and the symptom is a silent 400/404, not a red assertion:

- E-05 patched a nonexistent `PATCH /:id/results`; the real write path is
  `POST /:id/results/batch`. When a **seed step** returns 400/404, verify the
  route still exists before trusting the green further down — a dead route turns
  the whole spec into a no-op.
- Public-report status codes are contract and they differ: an **unpublished**
  inspection → **404** `Report not found`; a **published-then-unpublished** one →
  **403** `NOT_PUBLISHED`. Assert the exact code your setup produces; use a
  tolerant matcher only when both are legitimately reachable.

**Flake-retry discipline — retries hide real bugs if applied bluntly.**

- Retry **only** transient socket errors (`ECONNRESET`, `ECONNREFUSED`,
  `socket hang up`, `EPIPE`). A `401`, `429`, or assertion failure MUST throw
  immediately — retrying it converts a real regression into a slow flake. The
  collab login helper does exactly this (4 attempts, connection-error-only,
  backoff).
- The collab root cause was a **stale keep-alive socket** left after the
  WebSocket/Durable-Object-heavy editing spec; the next login reused the dead
  socket and ECONNRESET once. `retries: CI ? 2 : 0` is the backstop, not the fix.
- One shared runner IP trips the login limiter (10/60s) as a `429` — that is what
  `DISABLE_RATE_LIMIT` exists for, not something to paper over with retries.

**Publish crashes the isolate without a Browser Rendering binding.**
`POST /:id/publish` enqueues a PDF via `env.BROWSER.quickAction`; with no
`BROWSER` binding the worker dies with a 503 and
`The RPC receiver does not implement quickAction` / `worker restarted`. The
publish→PDF leg cannot be driven end-to-end locally — verify the public-report
render path instead and keep the Download-PDF FAB unit-covered.

---

## Quick reference

```bash
npm run test:web                       # web unit (happy-dom, hermetic)
npm run test:unit                      # api/service unit (node + better-sqlite3)
npm run test:workers                   # real workerd (queues, DOs)
npm run test:e2e                       # Playwright, seeds real D1
npm run test:types                     # type-level (*.spec-d.ts)
npm run lint:tests                     # layout gate

# fresh full E2E (what CI does):
rm -rf build .wrangler/state && npm run test:e2e

# single E2E project / grep:
npx playwright test --project=browser
npx playwright test --grep "estimate range"

# also seed the C/D/E multi-user fixtures:
SEED_E2E=1 npm run test:e2e
```

The cross-repo rationale for `directory = suite` (shared with the portal and CMS
repos) lives in the private superproject at
`docs/superpowers/plans/2026-07-03-tests-layout-convention.md`.
