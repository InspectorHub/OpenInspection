# Testing — apps/openinspection

The single Worker serves both the typed JSON API and the React Router v8 UI, so
tests cover both surfaces. There are six suites — web unit, api/service unit,
worker-runtime, contract, end-to-end and type-level — each pinned to a
**location**: a spec's directory alone decides which config runs it. This document is the
canonical reference for the three things you need to get right: **where a spec
lives**, **how to write it**, and **how the run is initialized**.

The layout is enforced — `npm run lint:tests` (`scripts/check-test-layout.mjs`)
fails the build on a misplaced spec, and it runs in `npm run lint` (pre-push and
CI's `verify` job; it is not in the pre-commit rung).

Collection is enforced in **both** directions, by two gates rather than one:

- `npm run lint:tests` proves every literal `testMatch` in `playwright.config.ts`
  resolves to a file that exists — a project may not point at nothing.
- `npm run lint:e2e-coverage` (`scripts/check-e2e-spec-coverage.mjs`) proves the
  reverse: every spec in `tests/e2e/` is collected by some config. A spec nobody
  collects never runs, and a spec that never runs looks exactly like a spec that
  passes. It asks Playwright (`--list`) instead of re-reading `testMatch`, so it
  agrees with the runner by construction, and it discounts **sweep** configs —
  a config with no `projects` collects any file dropped into `testDir`, so it
  cannot testify that a particular spec was ever wired up. It prints the configs
  it consulted, both counts, and the name of every orphan, on every run.

---

## 1. Directory classification (`directory = suite`)

| Location | Suite | Command | Config | Runtime |
|---|---|---|---|---|
| `app/**/*.test.{ts,tsx}` (co-located) | web unit | `test:web` | `vitest.config.ts` | happy-dom (per-file docblock; node by default) |
| `tests/unit/<domain>/**/*.spec.ts` | api/service unit | `test:unit` | `vitest.api.config.ts` | node (+ better-sqlite3) |
| `tests/workers/**/*.spec.ts` | worker-runtime | `test:workers` | `vitest.workers.config.ts` | real `workerd` |
| `tests/contract/<party>/*.contract.spec.ts` | contract (offline) | `test:contract` | `vitest.contract.config.ts` | node, no network |
| `tests/contract/<party>/*.live.spec.ts` | contract (live) | `test:contract:live` | `vitest.contract.live.config.ts` | node + the real third-party API |
| `tests/e2e/*.spec.ts` | end-to-end | `test:e2e` · `test:e2e:seeded` | `playwright.config.ts` (seeds real D1) · `playwright.seeded.config.ts` | built worker + browser |
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
3. **Asserting on a THIRD PARTY's contract rather than our behaviour?** →
   `tests/contract/<party>/`. The distinguishing question is what a red run
   means: if the fix is usually "change our code to match theirs" rather than
   "fix our bug", it is a contract spec. See §2 for the two halves.
4. **Full-stack / browser / anything that hits a running worker** →
   `tests/e2e/`. One flat directory; `globalSetup` seeds real D1 so every E2E
   exercises the actual database.

More than one Playwright config reads that directory, and a spec belongs to
exactly one of them. `npm run lint:e2e-coverage` prints the full list on every
run — which config collects a spec, which one OWNS it, and which npm script (if
any) runs it — so read its output rather than a list copied into this page.

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
  ⚠️ **8788 here is not a typo for the dev port and must not be "corrected" to
  8787.** It is the constant compiled into `app/lib/api.server.ts`, which is a
  different thing from where `npm run dev` listens. That the two disagree is a
  real defect in that fallback rather than in this sentence — the number is
  recorded here so a reader can tell the two apart.

- **Three vitest projects.** `vitest.config.ts` splits the web specs by `tests/web-isolation.json`:
  `web-node-shared` and `web-dom-shared` run with `isolate: false` (the files one worker handles
  reuse its module graph, and in the dom project the same happy-dom window, which removes most of
  the import and environment cost) and `web-isolated` is the historical one-fresh-graph-per-file
  behaviour (node by default; a `@vitest-environment happy-dom` docblock still selects the DOM per
  file). A spec is shareable only if it has no module mock, registry reset, global stub or write,
  session storage, location or `document` structure write (fake timers and `localStorage` writes are
  the two exceptions below), hand-made React root or
  wall-clock bound, and reaches no module that keeps state (type-only imports are not followed).
  The manifest splits the shareable specs by the environment their docblock declares, and the
  gate fails when a spec sits in the wrong list. `npm run lint:web-isolation` fails when a listed
  spec breaks those rules; `npm run gen:web-isolation` regenerates the lists (a spec that passes
  the rules but fails or flakes when shared goes under `forcedIsolated` with a reason, and stays
  there). A new spec is isolated until the generator lists it, so nothing breaks by default.
- **Two hazards are accepted because the shared setup undoes them.** `tests/setup-web.ts` calls
  `vi.useRealTimers()` and `localStorage.clear()` in an `afterEach` for every project, so a shared
  spec may use fake timers (installed per test, not once in `beforeAll`) and write `localStorage`
  without leaving anything for the next file. `SETUP_RESETS` in `scripts/lib/web-isolation.mjs`
  names each exemption and `npm run lint:web-isolation` fails if the setup file stops making the
  call. `sessionStorage`, `indexedDB`, spies on browser objects and timers installed in
  `beforeAll` are still rejected. A spy on an object the spec builds itself (a fake data source)
  still needs `vi.restoreAllMocks()` in an `afterEach` for the rule to pass.
- **The generated message catalogues are loaded by Node, not transformed per file.**
  `vitest.config.ts` lists `app/paraglide/` and `packages/field-ui/src/i18n/generated/` under
  `test.server.deps.external` (inherited by all three projects). Those two were about half of all
  import self-time; a full `npm run test:web` went from 405 s to 348 s with this alone. The paraglide
  runtime is still a single instance, so `setLocale` in a spec works, and `vi.mock('~/paraglide/messages')`
  still intercepts (repair-builder-action-tag-seam relies on it).
- **The worker-thread pool was measured and not adopted.** `pool: 'threads'` for `web-isolated`
  gave 345 s against 348 s, and a worker thread cannot move the ICU zone with `process.env.TZ`
  (useSchedulingTimeZone, PaymentsModal do). Do not retry it without a gate that keeps such specs on forks.
- **`FieldEditor.capabilities.test.tsx` mounts once per (tree, inspection, omitted capability),**
  not once per entry. Every entry that shares a mount is asserted in turn against it, closing any
  menu or sheet the previous entry opened, and the soft expectation message still names the tree,
  the entry and the omitted capability. The 533 matrix triples are unchanged; the file went from
  96 s to 48 s. A new entry needs no change beyond its row in `ENTRIES`; if it leaves state the
  next entry would trip over, close it in `dismissOverlays`.
- **Module state that is allowed is listed by name, with one reason each**
  (`WEB_BENIGN_MODULE_STATE` in `scripts/lib/web-isolation.mjs`): the overlay layer stack, the
  toast listener list, a counter of mounted navs. Each is state that is only touched inside
  effects and is back to empty once the component unmounts, or a memo whose value does not depend
  on the test. Do not add a module to the list without reading it and writing why.
- **The shared dom project cleans up and checks.** `tests/setup-web-shared.ts` runs
  testing-library's `cleanup()` after every test (its own automatic cleanup is registered by an
  import that happens once per worker when the registry is shared, so only the first file of a
  worker would get it) and then fails the test if `<body>` still has children, an overlay layer is
  still registered, the scroll lock is still on `<body>`, or `data-mobile-nav` is still on
  `<html>`. A leaked mount therefore fails in the spec that leaked it, not in its neighbour.
- **CI re-runs the two shared web projects shuffled** (`npm run test:web:shared-shuffled`, same
  `--shard=N/4` flag, applied to the shared projects alone, so a file can sit on a different shard
  number than in the main run). The seed is printed at the START of the run. To replay a failure:
  `npx vitest run --config vitest.config.ts --project web-node-shared --project web-dom-shared --sequence.shuffle --sequence.seed=<seed> --maxWorkers=1`
  (plus the same `--shard=N/4`). Use one worker: with `isolate: false` which files share a worker
  depends on scheduling, so only a single worker reproduces the order. Shuffle also reorders the
  tests inside a file; run that file alone with the same seed to tell an order-dependent test from a
  leak between files.

### API / service unit (`tests/unit/<domain>/*.spec.ts`)

- Node env, `better-sqlite3` in-memory DB — no worker, no network. Use the shared
  `tests/unit/db.ts` harness and `tests/unit/mocks.ts` stubs.
- A file that needs a DOM opts in per-file with `// @vitest-environment happy-dom`
  (vitest v4 replacement for `environmentMatchGlobs`).
- Prefer asserting **service-layer** behavior directly over reconstructing HTTP.
- `createTestDb()` returns a database that already carries the full migrated schema
  (it opens a serialized image built once per process), so the `await setupSchema(sqlite)`
  that follows it is a no-op. `setupSchema` still replays the migration files for a handle
  you created yourself with `new Database(':memory:')`.
- **Two vitest projects.** `vitest.api.config.ts` splits the specs by `tests/unit/isolation.json`:
  `api-shared` runs with `isolate: false` (files handled by one worker reuse its module
  graph, which removes most of the import cost) and `api-isolated` is the historical
  one-fresh-graph-per-file behaviour. A spec is shareable only if it has no module mock,
  registry reset, global or env write, fake timers or `@vitest-environment` docblock and
  reaches no module that keeps state. `npm run lint:unit-isolation` fails when a listed
  spec breaks those rules; `npm run gen:unit-isolation` regenerates the list (a spec that
  passes the rules but fails or flakes when shared goes under `forcedIsolated` with a
  reason, and stays there). A new spec is isolated until the generator lists it, so
  nothing breaks by default.
  A module that keeps state is handled in one of three ways, all in `scripts/lib/unit-isolation.mjs`:
  `BENIGN_MODULE_STATE` (a memo or registry no spec can observe, each with a written reason),
  `RESET_BY_SHARED_SETUP` (real state with an exported reset that `tests/unit/setup-shared.ts` calls after
  every file of `api-shared`: the Google service-account token cache, the last-active debounce, the CSP
  report sampling window), or `KNOWN_MUTABLE_MODULES` (state the patterns cannot see; keeps every spec that
  reaches it isolated). `lint:unit-isolation` fails when the setup file stops calling a reset it is promised.
  A test helper that trips a text rule without being a hazard is listed under `VETTED_HELPERS` with its
  reason (the tenant-email harness's fetch double, which its `close()` undoes). The setup file also unstubs
  globals and restores spies after each file as a net under a spec that forgot to (a spec that calls
  `createHarness(` must call `.close(`, which the gate checks). The helper exemption covers `fetch` only;
  stubbing any other global in it fails the gate. A new module-level cache that a spec can observe needs one of those
  three entries, not a bigger manifest. The exempt files are skipped by the module-state rules as a whole, so
  `EXEMPT_STATE_PINS` records how many top-level state statements each has: a new cache in one fails
  `lint:unit-isolation` until someone reads it and updates the number. A spec that imports the worker entry
  (`workers/app`) or installs a fake API app loader is never shared. Both isolation gates also print, without
  failing, any spec the rules accept but the manifest does not list, so a manifest that fell behind is visible.
- **The generated message catalogue is loaded by Node, not transformed per file.** `vitest.api.config.ts`
  lists `app/paraglide/` and `packages/field-ui/src/i18n/generated/` under `test.server.deps.external`
  (next to `scripts/*.mjs`), because `server/lib/i18n/messages.ts` pulls ~3.7 MB of generated source into
  most of the graph. Measured on the full unit suite: 421 s to 336 s. No unit spec mocks either path; a
  `vi.mock` of one would be the thing to re-check before adding it.
- **Do not mock `drizzle-orm/d1` to inject the test database.** A module mock keeps the spec in
  `api-isolated`. Give the code under test a real binding instead: `tests/unit/helpers/d1-binding.ts`
  has `d1For(db)` (a `D1Database` over the database `createTestDb()` returned), `lazyD1()` (a binding
  you create before the database exists and point with `use(db)` in `beforeEach`; `useBinding` takes a
  wrapper you built, for example one that counts statements or fails one) and `toD1Binding(sqlite)`.
  Production code then builds its own drizzle D1 handle from it, so a spec exercises the same driver
  path as the Worker (including `batch()` and the way drizzle wraps a driver error in `.cause`).
  Assert on database state or on the statements that reached the binding, not on a mock's call shape.
- **CI re-runs the shared project shuffled** (`npm run test:unit:shared-shuffled`, same
  `--shard=N/4` flag, applied to the shared project alone, so a file can sit on a different shard
  number than in the main run). The seed is printed at the START of the run. To replay a failure:
  `npx vitest run --config vitest.api.config.ts --project api-shared --sequence.shuffle --sequence.seed=<seed> --maxWorkers=1`
  (plus the same `--shard=N/4`). Use one worker: with `isolate: false` which files share a
  worker depends on scheduling, so only a single worker reproduces the order. Shuffle also
  reorders the tests inside a file, so a failure there may be an order-dependent test within
  one file rather than a leak between files; run that file alone with the same seed to tell.

### Every route is OpenAPI or a named exception

`tests/unit/platform/native-routes-are-exceptions.spec.ts` reads the runtime route table of the
real application (`app.routes`, including routes registered through helper functions), subtracts every
method and path in the generated OpenAPI document, and requires the remainder to equal
`NATIVE_ROUTE_EXCEPTIONS` in `tests/unit/platform/native-route-exceptions.ts` exactly. Paths are compared in
the OpenAPI spelling (`{id}`); middleware and `app.all` dispatch lines are not routes and are skipped.

- **A new plain route fails the spec, by name.** Describe it with `createRoute` (preferred), or add an entry
  with a category from the closed list and a one-line reason (at most 120 characters) saying why it cannot or
  should not be an OpenAPI operation.
- **A stale entry fails too**: the route was removed, or is now in the document. Delete the entry.
- **`MAX_ENTRIES` is a ratchet.** It equals the current count and may only go down.
- **It prints both numbers on every run** (`native routes found`, `exceptions listed`) with a per-category
  breakdown, and fails when the route table is empty.
- **Out of scope:** routes served outside the Hono application (the OAuth provider wrapper paths, Durable Object
  internal paths, React Router resource routes under `app/`).

### Worker-runtime (`tests/workers/*.spec.ts`)

- Runs in real `workerd` via `@cloudflare/vitest-pool-workers`. Reserve this for
  behavior that only reproduces on the real runtime: Queue publish/consume,
  sweeper republish, DLQ writeback, Durable Objects. Bindings are declared inline
  in `vitest.workers.config.ts`.
- When a workers spec hand-maintains DDL (e.g. a `tenant_configs` table), assert
  it against the Drizzle schema instead of trusting a "keep in sync" comment —
  `tests/unit/platform/inline-ddl-schema-sync.spec.ts` is the pattern.

### Contract (`tests/contract/<party>/`)

A contract spec asks a different question from every other suite. A unit spec
asks *does this code do what we intended*; a contract spec asks *is what we
intended what the other side accepts*. When one goes red the fix is usually to
change our code, not the assertion.

The suite exists because of a measured failure. Six paths in the QuickBooks
integration had **never once worked in production** while the unit suite stayed
green, and all six share one cause: the tests supplied the upstream's answers.
A fabricated fault carried a code QuickBooks never returns; fixtures inserted
rows with a field production never sets; no fixture ever described a voided
invoice. A test that invents the response it asserts on can only prove the code
agrees with itself.

**Two halves, split by whether they need credentials.**

`*.contract.spec.ts` — **offline, runs in CI for everyone.** It checks our
outbound payloads against the third party's own published description of its
API. For QuickBooks that is four XSDs Intuit ships in its SDK repositories,
vendored under `tests/contract/qbo/vendor/` with their provenance and hashes in
`SOURCES.md`. It reads them as text rather than validating XML, because the REST
API is JSON and the mapping is name-for-name — and because, as
`intuit-schema.contract.spec.ts` pins, the schema requires **neither** of the
two fields whose absence broke every invoice push. Those rules live in the
type's prose, so the specs quote the prose verbatim; a refresh that rewords it
turns them red, which is the point.

`*.live.spec.ts` — **needs a connected sandbox, never runs in CI.** For the
things the offline half cannot reach in principle: fault CODES (`6240`, the
duplicate-name fault our ladder read as `6140` for its whole life, appears in no
schema), unsupported verbs, and character rules. It borrows the local
`qbo_connections` row and decrypts it exactly as the worker does — it mints
nothing and writes nothing back, and it will NOT refresh an expired token,
because a test that silently rotates your credentials is doing something a test
has no business doing.

`.githooks/pre-push` runs it when a push touches `server/services/qbo/`. Without
a sandbox it fails, names what is missing, and prints the opt-out:

```bash
SKIP_QBO_CONTRACT=1 git push   # announced in the output, never silent
```

That is deliberate. A silent skip is indistinguishable from a pass, and a gate
nobody can satisfy gets bypassed wholesale instead of argued with. Individual
specs skip (they do not pass) when there is no connection, so a run reports
`1 failed | 4 skipped` rather than four green ticks over nothing.

**Writing one.**

- Every fabricated upstream response is a bug waiting. Prefer a captured one,
  and say in a comment when and how it was captured.
- Assert on Intuit's words, not a paraphrase. `expect(doc).toContain('An
  invoice must have at least one line …')` fails usefully when the source
  changes; `expect(rules.invoiceNeedsLine).toBe(true)` cannot.
- Pair every negative claim with a positive control. "We send nothing
  undeclared" passes vacuously against a parser returning an empty set, so
  `intuit-schema.contract.spec.ts` checks the parser's own counts first.

**Refreshing a vendored schema** is a deliberate act, not a chore: follow
`tests/contract/qbo/vendor/SOURCES.md`, then read what went red.

### Native response conformance (`tests/unit/native/response-conformance.spec.ts`)

Requests each covered native operation through the real application and walks the JSON body against the response schema in
`contracts/native-contract.openapi.json`: a missing required key, a wrong type or a string outside an `enum` fails; an undeclared key
must be listed in `tests/unit/helpers/undeclared-response-keys.allowlist.json` (shrink-only; CI compares its key count with the base
branch). The helpers are `tests/unit/helpers/response-shape.ts` (the walker), `response-conformance.ts` (operations, seed, checker) and
`response-conformance-skips.ts` (`NOT_COVERED`, `EMPTY_OK`). To shrink an entry, document the field in the schema, run
`npm run native:contract`, and delete the key from the allow-list; see `docs/develop/native-clients.md`, section 12.

### E2E (`tests/e2e/*.spec.ts`)

- **One spec = one Playwright project.** Register the project in
  `playwright.config.ts` with a `testMatch` pointing at the file. Projects run a
  few at a time (`workers: 3`) but still share ONE `wrangler dev` worker and ONE
  mutable D1, so a spec must never assume isolation it has not arranged.
- **Own the rows you write.** The `editor-seed` setup project mints one
  inspection **per editing project** (`EXCLUSIVE_SEED_PROJECTS` in
  `tests/e2e/helpers/editor-seed.ts`); `readEditorSeed()` resolves the caller's
  own from the running project name. Add your project to that list if it changes
  the inspection — the test is "does it write?", not "does it read the id?",
  because a reader sharing rows with a writer is equally broken and merely fails
  later. Projects that need only a login share one entry and have nothing to
  corrupt. Before this, ten projects shared one inspection and it worked only
  because nothing ran at the same time: SpeedMode's overlay opens while unrated
  items remain, and a concurrent spec rating those items left it with none.
- **Gate on hydration, not on markup.** The app is server-rendered, so `<main>`
  and a full item list are on screen before React attaches any handler — waiting
  for them proves the SSR shell arrived and nothing more. Use
  `awaitEditorInteractive` (or `awaitEditorShortcutsReady`, which also blurs, as
  `useKeyboard` ignores shortcuts while focus is in a field) from
  `tests/e2e/helpers/editor-ready.ts`. It retries an **idempotent** selection
  until the editor pane opens, so it ends as soon as the handler exists and
  cannot mask a real break — a broken editor never opens the pane at all.
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

**`verify` does no work of its own.** It is an aggregate job that waits on every
other job, so branch protection has one stable name to require. Its `if:
always()` plus an explicit result test is load-bearing: under the default
`success()` behaviour a SKIPPED or cancelled dependency would let it pass.

The jobs it waits on run in parallel:

| Job | Runs |
|---|---|
| `typecheck-app` | `type-check:app` → `type-check:tests` → `test:types` |
| `lint-eslint` | `lint:eslint` (the type-aware pass) |
| `lint-gates` | `lint:gates-full` (every conformance gate) → `db:check` |
| `test-unit` | `test:unit`, sharded 4 ways |
| `test-contract` | `test:contract` (offline half only — the live half never runs in CI) |
| `test-workers` | `test:workers` |
| `test-web` | `test:web`, sharded 4 ways |
| `build` | `build` → `check:bundle` |
| `e2e` | a 2-way matrix: `test:e2e` (seeded D1) and `test:e2e:seeded` (multi-user seed) |

`e2e` was once absent from `verify`'s `needs`, which left a red E2E run reading
green on the job branch protection keys off — the whole suite was advisory
without anyone deciding it should be. It costs `verify` the wait for the longest
job, which is the price of the name meaning what it says.

Every job that touches generated types runs `gen-version`, `i18n:compile:cached`
and `react-router typegen` first. `npm ci`'s `prepare` step now runs the cached
compile itself, and CI restores the generated i18n output through the
`.github/actions/i18n-cache` action, so the explicit `i18n:compile:cached` step
usually skips. CodeQL runs separately (`codeql.yml`).

### Native type-check (optional)

`npm run type-check:native` runs the same four programs as `npm run type-check`
(api, app, tests, e2e, in that order) through `tsgo`, the native TypeScript
compiler from `@typescript/native-preview`. It is a convenience for local work.
CI and the pre-commit hook still use the real `tsc`, which stays the authority.

**When to use it.** A new worktree with no `.types/`, a cold or invalidated
`tsc` cache, or a machine with little free memory. Measured on one Windows
machine with about 16 GB of RAM, on the server program, cold: `tsgo --checkers 1` took 63-70 s and peaked at about 7.2-7.6 GB;
`tsc -b` took about 175 s and peaked at about 9.65 GB. A full cold
`type-check:native` (all four steps) took about 84 s, with the api step about
66 s. A second run with nothing changed is a stat pass of under a second.

**Limits.**

- It is a preview. The version is pinned exactly in `package.json`; bump it on
  purpose and re-run it on a known-good tree.
- It is not faster everywhere. After server declarations change, its incremental
  rebuild takes about 61-69 s, against about 11-21 s for a warm `tsc -b`. It
  removes the cold-start cliff; it does not replace a warm `tsc` loop.
- It is not the authority. In one injected-error test on this repository (39
  kinds of type error), `tsc` reported all of them and `tsgo` missed none. That
  is one sample, not a guarantee, and a green native run is still not a
  substitute for the CI result.
- It builds in project-reference mode (`tsc -b` style), whereas
  `type-check:tests` runs `tsc -p tsconfig.tests.json --noEmit`. The first writes
  build-info and declarations and skips up-to-date projects; the second writes
  nothing. Do not compare timings across the two modes.
- Keep it serial, and do not run it beside another type-check, eslint or a build.
  `--checkers 1` is fixed in the script on purpose: the default of four checkers
  copies the type cache into each one, roughly multiplying memory, and has
  driven a 16 GB machine to a few MB of free memory.
- It writes to its own directory, `.types-tsgo/` (gitignored), through the
  `tsconfig.native-*.json` files, which only redirect output and `references`.
  It never touches `.types/` or the `.tsbuildinfo.*` files: two compilers
  sharing one build-info file overwrite each other and make both start cold.
  Deleting `.types-tsgo/` is always safe.

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

### A suite that only builds one deployment shape

**Twenty-two QuickBooks specs, and not one of them had ever run in standalone
mode.** Every spec built a valid env; only one valid env had ever been written
down. `qbo-oauth-callback.spec.ts` hardcoded `QBO_CLIENT_ID` /
`QBO_CLIENT_SECRET` / `QBO_ENV` — the platform-supplied shape — and every other
env in the domain descended from it. So the tenant-credential fallback in
`qbo-oauth.ts` had a false guard on every run and was dead code inside a green
suite. A real defect lived in that gap for the life of the feature: the CDC cron
read credentials straight off the Worker env, could never see a self-hosted
operator's, and logged `QBO not configured` at a deployment where they had
configured it.

Nothing was skipped and nothing failed. **The suite was complete for one of the
two products this repo ships.**

The rule, so a future author can apply it without knowing that story:

> **If any `if` in the code under test has one branch per deployment, the spec
> must construct two envs.** One env can only ever exercise one branch, and a
> branch never taken cannot fail.

If two envs are awkward to build, the seam is in the wrong place rather than the
test being too much trouble — `getDeploymentProfile` takes `ProfileEnv` rather
than `AppEnv` precisely so any caller holding an env can answer the question.
`tests/unit/helpers/qbo-deployment-envs.ts` is the worked example: `saasQboEnv`
and `standaloneQboEnv`, named after the deployment so a spec asks for "the
self-hosted case" instead of assembling one and hoping it resembles one.

**Never hand-build credential fixtures.** Not hand-written ciphertext, not
hand-filled env values standing in for stored secrets. Seal them with the
product's own writer (`sealSecrets`) and let the code under test open them the
way production does. A fixture that writes what it then reads proves the reader
agrees with the writer and nothing else — and fixtures supplying fields
production never supplies is the single shared cause behind the QuickBooks
defects that shipped without ever working. That includes MODE fixtures, not just
response fixtures: an env is a fixture too.

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
npm run test:e2e:seeded                # the multi-user-seed projects (playwright.seeded.config.ts)
npm run test:types                     # type-level (*.spec-d.ts)
npm run lint:tests                     # layout gate (projects must resolve to files)
npm run lint:e2e-coverage              # coverage gate (files must be collected by a config)

# fresh full E2E (what CI does):
rm -rf build .wrangler/state && npm run test:e2e

# single E2E project / grep:
npx playwright test --project=browser
npx playwright test --grep "estimate range"

# also seed the C/D/E multi-user fixtures:
SEED_E2E=1 npm run test:e2e
```

**Why `directory = suite` at all.** A spec's home decides which config collects
it, so classification is a filesystem fact rather than a convention somebody has
to remember — and `npm run lint:tests` can then check it. The alternative,
tagging each spec with the suite it belongs to, puts the answer inside the file
that a misfiled spec is already wrong about, and no gate can see the
disagreement. Every config's `include` glob is the whole rule; read them
together with the table above and the layout is complete.
