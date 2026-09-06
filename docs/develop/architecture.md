# Architecture

OpenInspection is a home inspection app deployed as a single Cloudflare Worker (the cloudflare/react-router-hono-fullstack-template shape): a Hono entry that mounts the full API in-process and delegates page routes to React Router v8 SSR. This doc covers the high-level architecture for self-hosters, contributors, and reviewers.

> Self-hosted instances run **standalone** (single-tenant) — the default in `wrangler.jsonc`. The engine is tenant-aware under the hood (every table carries `tenant_id`), but you don't manage tenants or subdomains; one fixed tenant holds all your data.

## Stack at a glance

| Layer | Tech |
|---|---|
| Edge runtime | Cloudflare Workers (Free tier sufficient for solo inspectors) |
| API routing | [Hono](https://hono.dev) + Zod OpenAPI (typed JSON API) |
| Frontend | [React Router v8](https://reactrouter.com) + React 19 + Vite |
| ORM + DB | [Drizzle](https://orm.drizzle.team) + Cloudflare D1 (SQLite) |
| Object storage | Cloudflare R2 (photos, future PDFs) |
| KV cache | Cloudflare Workers KV (tenant config, signed tokens, rate-limit counters) |
| Background jobs | Cloudflare Workflow (onboarding, sign-completion) + Cron Triggers (automation sweeps) |
| PDF rendering | Cloudflare Browser Run — `env.BROWSER.quickAction("pdf", { url })` (free tier, 10 min/day) |
| E-signatures | Ed25519 per-tenant keypair + SHA-256 hash-chained audit log (ESIGN Act + UETA) |
| Styling | Tailwind CSS v4 + Design System 0523 tokens |
| Shared components | `packages/shared-ui/` — 12 token-based React components |
| AI | Google Gemini API (optional) |
| Email | Resend |
| Payments | Stripe Connect (optional) |
| Auth | ES256 JWT in HttpOnly cookie + PBKDF2-SHA256 password hashing |

## Single-Worker Architecture

OpenInspection runs as ONE Cloudflare Worker. `workers/app.ts` is a Hono app that is the worker entry: it mounts the full API (`server/`) for API-owned paths and delegates everything else (page routes) to the React Router v8 SSR handler.

```
                    ┌──────────────────────────────────────────┐
  Browser ────────► │  Single Worker (workers/app.ts)           │
                    │  Hono entry                                │
                    │                                            │
                    │  ┌──────────────────┐  ┌────────────────┐ │
                    │  │ /api/*, /status, │  │ everything else│ │
                    │  │ /sign/*, … →     │  │ → React Router │ │
                    │  │ API app (server/)│  │ v7 SSR (app/)  │ │
                    │  │ in-process       │◄─┤ in-process     │ │
                    │  │ Hono+Drizzle+D1  │  │ API_WORKER     │ │
                    │  └──────────────────┘  └────────────────┘ │
                    │                                            │
                    │  D1 · R2 · KV · Workflow · Durable Objects │
                    └──────────────────────────────────────────┘
```

- **`workers/app.ts`** — a Hono app is the worker entry. It routes API-owned paths (`/api/*`, `/status`, `/m2m/*`, `/photos/*`, `/.well-known/*`, `/doc`, `/sso`, `/sign/*`, `/webhooks/*`, the ICS feed) to the API app and sends everything else to the React Router v8 SSR handler. It injects an in-process `API_WORKER` self-binding so React Router loaders/actions call the API app DIRECTLY (no network hop, no second worker, no Service Binding between workers).
- **`server/`** — Hono + Drizzle + D1. Handles all business logic, authentication, and data access. Exposes a typed JSON API.
- **`app/`** — React Router v8 + React 19 + Tailwind v4. Server-side renders the React UI on the edge.
- **Shared UI** (`packages/shared-ui/`) — Design System 0523 token-based React components (Button, Pill, Card, etc.).
- **API Types** (`packages/api-types/`) — Re-exports the Hono app type so the web layer's `hono/client` gets full end-to-end type safety.

The web layer uses a **Token Relay BFF** pattern: the React Router v8 server holds the JWT cookie and forwards it to the in-process API on every request, so the browser never sees the token directly.

### Why React Router v8

- **SPA navigation**: page transitions without full reload — inspectors switch between editor/dashboard/templates frequently
- **React 19**: future React Native app can reuse hooks and state logic (useInspection, useFindings, useSync)
- **SSR on Workers**: full server rendering at the edge, same latency as static HTML
- **hono/client**: Hono exports `AppType`, React Router v8 uses `hono/client` for compile-time type-safe API calls — zero handwritten API client
- ⚠️ **CPU per request is NOT ~1-3ms.** This line used to read "CF Free Tier
  safe: React Router v8 SSR adds ~1-3ms CPU per request, well within 10ms
  limit". Measured against a live deployment on 2026-09-05, over seven days of
  real traffic: **p50 8ms, p95 49ms, p99 106ms, max 494ms**. A statutory-form
  render is ~470ms in workerd on its own. The old figure was an SSR microcost
  quoted as if it were the request, and it was never re-measured.
  A plan capping CPU in the low milliseconds will kill ordinary page loads —
  observed, as HTTP 1102, on a plain settings page.

> **The same arithmetic has to be done for the scheduled path, and for a long time it was not.**
> The Workers Free CPU ceiling is 10 ms **per invocation**, and it applies to a cron
> invocation exactly as it applies to a request. The line above was written about `fetch`
> and nothing ever wrote the equivalent for `scheduled`, which ran thirteen background jobs
> serially in one invocation — measured at 138 ms, 13.8x the ceiling, with ticks being
> killed outright. See [Background work](#background-work) for the shape that replaced it.

## Module map

```
apps/openinspection/
├── workers/
│   └── app.ts                     # Single-worker entry: Hono mounts API in-process + delegates pages to RR SSR
├── server/                        # API (Hono + Drizzle + D1)
│   ├── index.ts                   # Hono app entry, middleware order, route registration
│   ├── api/                       # Route handlers (one file per resource)
│   │   ├── auth.ts                # /api/auth/{login,register,reset-password,...}
│   │   ├── inspections.ts         # /api/inspections/* + share/print
│   │   ├── ai.ts                  # /api/ai/{suggest-comment,comment/edit}
│   │   ├── booking.ts             # /public/* (no auth) + /api/book
│   │   └── ...
│   ├── services/                  # Business logic, DB queries (Drizzle)
│   ├── features/                  # Feature-scoped modules
│   │   └── tenant-routing/        # Tenant resolution (standalone pins one fixed tenant)
│   ├── lib/
│   │   ├── middleware/            # Hono middleware (auth, RBAC, branding, DI)
│   │   ├── db/                    # Drizzle schema + utils
│   │   ├── validations/           # Zod schemas per module
│   │   ├── errors.ts              # AppError + ErrorCode + Errors factory
│   │   ├── logger.ts              # Structured JSON logger (use this, not console)
│   │   └── ics.ts                 # iCalendar string builder
│   ├── workflows/                 # Cloudflare Workflow durable steps (e-sign completion)
│   └── portal/                    # SaaS-only portal integration (unused in standalone)
├── app/                           # Web (React Router v8 + React 19 + Tailwind v4)
│   ├── root.tsx                   # React Router v8 root layout
│   ├── routes.ts                  # Route configuration
│   ├── entry.server.tsx           # React Router v8 CF Workers entry
│   ├── routes/                    # Route files (loader + action + component)
│   ├── components/                # React components
│   ├── hooks/                     # React hooks
│   ├── lib/                       # API client (hono/client over the in-process binding), session, helpers
│   └── styles/tailwind.css        # Design System 0523 token layer
├── migrations/                    # D1 SQL migrations (drizzle-kit schema-first: one regenerated 0000_baseline.sql, forward files on top)
├── tests/                         # API unit + integration + E2E tests
├── tests/web/                     # Web E2E + unit tests
├── packages/
│   ├── shared-ui/src/             # shared React components
│   └── api-types/                 # CoreApiType for hono/client
├── scripts/                       # Setup, seed, backup, deploy helpers
└── wrangler.jsonc                 # Single-worker config + bindings (committed, placeholder IDs; real IDs in gitignored wrangler.local.jsonc / wrangler.saas.jsonc)
```

## Request flow

### Page (React Router v8) flow

```
Browser request
   ↓
Cloudflare edge → single Worker (workers/app.ts) → Hono routes non-API paths to RR SSR
   ↓
React Router v8 server (SSR):
   1. Route matched → loader() or action() executes
   2. Reads session cookie (Token Relay BFF)
   3. Calls the in-process API via the injected API_WORKER binding (hono/client) — no network hop
   4. Renders React component tree to HTML
   ↓
HTML + hydration bundle sent to browser
   ↓
Client-side: React hydrates, subsequent navigations use client-side routing
```

### API flow

```
API request (from an RR loader/action via the in-process API_WORKER binding, or direct over HTTP)
   ↓
Cloudflare edge → single Worker (workers/app.ts) → Hono routes API-owned paths to the API app
   ↓
Hono middleware stack (in order):
   1. CSP / security headers
   2. Branding resolver (KV → D1 fallback)
   3. Tenant router (standalone: pins the one fixed tenant)
   4. JWT auth (skip on /api/auth, /api/public, /api/setup)
   5. Bot protection (Turnstile + threat score)
   6. Tier guard (subscription check, no-op in standalone)
   7. DI proxy (lazy-instantiates services)
   ↓
Route handler reads validated input via c.req.valid('json')
   ↓
Handler calls c.var.services.xxx (auto-tenant-scoped)
   ↓
Service queries D1 (Drizzle) / R2 / KV / external API
   ↓
Response via sendSuccess() / sendError() (canonical envelope)
```

## Tenancy model

Every D1 table includes `tenant_id` (NOT NULL) so the data model is tenant-aware, but a
self-hosted instance runs **standalone**: `SINGLE_TENANT_ID` pins all data to one fixed
tenant. You never manage tenants or subdomains. Tenant resolution lives in
`server/features/tenant-routing/`; in standalone the `tenantRouter` middleware simply pins
the request to `profile.fixedTenantId` (`resolve-by-fixed-tenant.ts`).

> A SaaS overlay (`server/portal/`, active only when `APP_MODE=saas`) lets a multi-tenant deployment hand tenant records, seats and credentials to an external control plane over the machine-to-machine seam described in [`reference/api.md`](../reference/api.md). Standalone builds execute none of it: `hasPortalIntegrationApi` is false, so `/api/platform/*` is not mounted at all. The code is here and readable; what runs on the other end of that seam is not part of this repository.

### Reading a deployment capability

Mode-dependent behaviour comes from `server/lib/deployment-profile.ts` — the one
place that reads `env.APP_MODE`. Read a capability; never branch on the mode
yourself. Three sanctioned readers, by what you are holding:

| You hold | You read |
|---|---|
| a Hono handler / middleware | `c.var.profile.<capability>` |
| only an env (RR loader or action, cron, Workflow, queue consumer) | `getDeploymentProfile(env).<capability>` |
| a client component | `isSaas` / `deployment.mode` from the session context |

`getDeploymentProfile` takes `ProfileEnv` (the three fields it reads), not
`AppEnv`, so every env shape in the worker satisfies it with no cast.
`tests/unit/sync/portal-isolation.spec.ts` enforces the rule.

## Authentication

- Login → server signs JWT (ES256 with `kid` header, includes `iat` claim) → sets `__Host-inspector_token` HttpOnly cookie
- Each request: middleware verifies JWT signature + checks `iat >= KV[pwchanged:userId]`
- Password change: writes `pwchanged:userId = now()` to KV → invalidates all prior tokens server-side
- Browser JS never sees the token (HttpOnly enforced); same-origin `fetch()` sends the cookie automatically.
- The web layer uses Token Relay BFF: the React Router v8 server reads the cookie and forwards it to the in-process API on every request.

## E-signature (Spec 5H)

### Trust model

Per-tenant Ed25519 keypair generated on first use (`SigningKeyService.ensureKeypair`). The private key is AES-GCM encrypted with `KEY_ENCRYPTION_SECRET` and stored in D1; the public key is exposed unauthenticated at `/.well-known/openinspection/tenant-keys/:slug` (1-hour cache) so any third party can verify signatures independently.

### Audit chain

Each signature event appends a row to `esign_audit_logs` whose `prev_hash` = SHA-256 of the canonical JSON of the previous row. Editing any row invalidates the chain from that point onward — detectable by re-deriving hashes. The chain is signed with the tenant's Ed25519 private key at every append, not just at sign time.

### Sign flow

Customer signs at `/agreements/sign/:tenant/:token` → API writes an `agreement.signed` audit row, generates a `verificationToken`, and fires `SignCompletionWorkflow` asynchronously. The synchronous response to the customer is immediate; PDF generation happens in the background.

### Workflow steps (`SignCompletionWorkflow`)

1. Render `signed.pdf` via `env.BROWSER.quickAction("pdf", { url })` (Browser Run) → store in R2.
2. Render `certificate.pdf` the same way → store in R2.
3. Assemble `evidence.zip` (signed.pdf + certificate.pdf + audit-log JSON).
4. Append `workflow.complete` audit row recording the SHA-256 hashes of all three artifacts.
5. Email the client via Resend with `signed.pdf` and `evidence.zip` as attachments.

Browser Run requires `compatibility_date >= "2026-03-24"` in `wrangler.jsonc` and uses the free tier (10 browser-minutes/day — sufficient for typical inspection volume). Admin download endpoints for signed.pdf, certificate.pdf, and evidence.zip are Worker-proxied from R2.

**Correction, and what the three downloads say about themselves.** A published report is corrected by AMENDMENT, never in place: `correctReport` (`server/services/report-correction.service.ts`) applies the change to the record and publishes version N+1 through the same snapshot path, so the delivered version stays byte-identical and its hash chain goes on verifying. The three downloads above are part of the same graph rather than a separate one — they are files the product actively serves, not an archive or a backup, so each 200 carries `x-artifact-status: current | superseded`, resolved from the amendment ledger by `server/lib/artifact-status.ts`. A superseded artefact is still retrievable as historical evidence; what changes is that it no longer claims to be the current answer.

The cache directives are part of that claim rather than a separate concern. A status header describes right now, so `current` responses are sent `private, no-cache, must-revalidate` and `superseded` ones `private, no-store`. The `private, max-age=300` these endpoints used to send let a copy fetched shortly before a correction go on claiming `current` for five minutes afterwards inside the client's own cache.

### Verification flow

- **Public verifier** (`/v/:verificationToken`): SSR page resolves the token to an envelope, runs a server-side audit-chain integrity check and Ed25519 signature check, and displays the result with download links. QR code on signed.pdf and certificate.pdf points here.
- **Offline self-verify** (`/verify`): accepts an `evidence.zip` upload and re-runs SHA-256 chain re-derivation + Ed25519 signature verification entirely in the browser via Web Crypto API — no server involvement, court-friendly independence from the operator.

### Optional features

- **D1 — Inspector pre-sign**: inspector can sign the agreement before sending to the client via `POST /api/admin/agreement-requests/:id/inspector-sign`. The render handler conditionally adds an inspector signature block when present.
- **D2 — Auto-sign on publish**: per-inspection `auto_sign_on_publish` flag (plus a tenant-level default). When an inspector has a saved `users.default_signature_base64` and the flag is set, `InspectionService.publishInspection` auto-injects the inspector's signature into `inspection_results.data` at publish time. The report viewer and print output render the signature block automatically.

### Invariant: a signature is a picture, never a biometric template

A rendered signature **image** may be persisted for execution and evidence
purposes. A reusable biometric or behavioural signature template may not be
persisted or derived — not stroke geometry, not pen pressure, not timing.

This is not a hypothetical boundary. The pad already samples pointer pressure
and coalesced events into `StrokePoint { x, y, p }` while you draw. Its handle
exposes only `toDataURL`, `isEmpty` and `clear`, so **today the invariant holds
because one accessor does not exist** — which is one refactor from being untrue.

Two properties make it enforceable rather than aspirational:

- The exemption is a **directory**, `app/components/media-studio/`. That is
  where the data is legitimately handled and where it stops. An allowlist of
  file names would grow one entry at a time until it described nothing.
- The gate scans for the stroke **symbols and field shapes**, not for column
  definitions. The inspector signature is written into `inspection_results.data`
  as `_inspector_signature`, which is a JSON blob — a stroke payload could ride
  there with no schema change at all, and a column grep would never see it.

Enforced by `npm run lint:signature-dynamics`
(`scripts/check-signature-dynamics.mjs`), in the `lint` chain and
`lint:gates-full`. Not to be confused with `lint:sigcompare`, which enforces the
opposite duty on cryptographic verification: that it goes through
`crypto.subtle.verify` or a constant-time compare.

### The second half: a signature is never an authenticator

The rule above is about the **input** — how the mark was made. The second half is
about the **use**: a signature image is never used or stored for biometric
**authentication**. A pad that captures nothing but a picture still crosses the
line the moment that picture is matched against a stored one to decide who
somebody is.

It lives in the **same gate** rather than beside it. The statutory test turns on
the words "used to authenticate", so the two halves are one boundary seen from
two angles, and two separate gates could each pass while it broke between them.

Three shapes are banned, and they are the three stages of every biometric
pipeline:

| stage | banned shape | example |
|---|---|---|
| feature extraction | turning the image into a key | `extractSignatureImageFeatures` |
| enrolment | storing a template of the image | `signatureImageTemplate` |
| comparison | matching two images to decide identity | `compareSignatureImages` |

**Hashing the image is the approved alternative and is deliberately untouched.**
`signatureImageHash` — a SHA-256 fingerprint recorded at signing — proves the
stored record is unaltered and identifies nobody. Every pattern requires either
the word `Image` or an unambiguous biometric noun, so a hash never reaches them,
and neither do the cryptographic `verify*Signature` functions that
`lint:sigcompare` requires.

Two design notes that were bought with a mutation proof rather than reasoning:

- The patterns carry **no leading word boundary**. A planted
  `loadSignatureImageTemplate(...)` passed silently the first time, because a
  word boundary cannot match between `load` and `Signature`; any verb prefix
  walked straight through. The end of the identifier is what carries the
  meaning, so only the trailing boundary is kept.
- **No prefix is exempted**, `email` included. An email-signature template that
  happened to hold an image would trip this and should be renamed, or argued
  about in the open. That is a far cheaper failure than a biometric template
  hidden behind a prefix somebody once added to an exemption list.

### Related: the claims the product may not make about any of this

`npm run lint:verification-copy` (`scripts/check-verification-copy.mjs`) is the
copy-side companion, and it is a **Global Core control —
Verification Claim Integrity**, not a regional overlay: it is load-bearing under
FTC Act §5, state UDAP statutes, contract expectation and evidentiary integrity
at once. It scans every message catalogue, in every locale, for copy that
converts an integrity result into a conclusion about human authorship, identity,
intent, consent or legal validity — "Signature Verified", "Valid Signature",
"Signer Verified", "Signed by [person]" and the rest. A **disclaimer does not
rescue an over-broad claim; narrow the claim.** What is permitted is the claim
narrowed to the check that ran: *"The stored signature image matches the
signature image fingerprint recorded at signing."*

## Service layer

Each domain has a service class with:

- Constructor receiving `db` (or `ScopedDB`) + `tenantId`
- Methods that filter by `tenant_id` automatically (via `ScopedDB` wrapper)
- No direct DB calls in route handlers — always via service

Example:

```typescript
// In a route handler:
const inspections = await c.var.services.inspection.list({ status: 'in_progress' });
// c.var.services.inspection is auto-instantiated with c.get('tenantId')
```

The DI proxy in `server/lib/middleware/di.ts` lazy-instantiates each service on first access per request.

## Frontend layer

- **React Router v8 SSR**: Routes in `app/routes/` use `loader()` for data fetching and `action()` for mutations. Full server-side rendering on Cloudflare Workers.
- **React components**: 59 components in `app/components/`, organized by domain (inspection, template, booking, etc.).
- **Hooks**: 9 custom hooks handle complex state — `useInspection` (866 LOC), `useFindings`, `useKeyboard` (shortcuts), `useCannedComments`, `useOfflineQueue`, `usePresence` (WebSocket), `useTheme`, `useUnsavedChanges`, `useSessionContext`.
- **Design tokens**: Tailwind v4 with Design System 0523 tokens in `app/styles/tailwind.css`.
- **Shared UI**: `packages/shared-ui/` provides 12 design-system components (Button, Pill, Card, etc.) consumed by the frontend.
- **Dark mode**: `data-color-scheme` attribute on `<html>`, managed by `useTheme` hook (auto/light/dark).

### Future app path

1. **PWA** (current) — installable, offline-capable via Service Worker plus the
   `useOfflineQueue` hook, which carries the photo-upload queue and field sync.
2. **A native client** (direction, unspecified) — designed for the field rather
   than inherited from the browser: capture, local storage, sync and conflict
   resolution are the requirement, not follow-ups to a shell.

**Capacitor was on this list and is not any more** (2026-08-18). It was a
WebView wrapper with native camera and offline capture deferred to later work,
and those deferred items are the actual requirement — an inspector works
basements and crawlspaces with no usable connection. That is a judgement about
what this product needs, not about the tool. Until a native client exists,
responsive web is the field surface.

## Storage

- **D1**: structured data (tenants, users, inspections, templates, comments, agreements, audit logs, ...)
- **R2**: blobs. Bucket bindings: `PHOTOS` (field photos, logos) and `REPORTS` (pre-rendered report + e-sign PDFs). Accessed via signed URL or a Worker pass-through endpoint.
- **KV**: short-lived signed tokens (agent share, password reset, magic link), tenant config cache, rate-limit counters.

## Background work

- **Sign-completion workflow** (`server/workflows/`): renders the signed PDF + Certificate of Completion, assembles the evidence pack, and emails the client — see [E-signature](#e-signature-spec-5h). Cloudflare Workflow guarantees retries and persistence across Worker restarts.
- **Cron triggers**: three expressions, declared identically in `wrangler.jsonc` (standalone)
  and `wrangler.saas.jsonc`.

  | Expression | Carries |
  |---|---|
  | `*/5 * * * *` | The main tick. It **probes and enqueues only** — see below. |
  | `0 3 * * *` | Daily R2 usage measurement (`r2-usage`). |
  | `0 4 * * *` | Daily log-table retention sweep and intake expiry reminders (`retention-logs`). |

  Cron Triggers are limited to **5 per account** on the Free plan, which is the budget these
  three are spent from.

### The scheduled path and the 10 ms ceiling

The Workers Free CPU ceiling is **10 ms per invocation**, for cron invocations as much as for
requests. Thirteen background jobs therefore cannot share one `scheduled()` call however fast
each of them is — the only fix is more invocations, not faster jobs.

So the tick does not run jobs. `server/cron/registry.ts` declares each job with a cheap
`probe()` (is there work? — at most a `LIMIT 1` on the job's own due-predicate) and a bounded
`run(cursor)`. `server/cron/dispatch.ts` probes the jobs belonging to the expression that
fired and enqueues one message per job that has work; `server/cron/consumer.ts` runs exactly
one job per queue message, so **each job gets its own invocation with its own budget**. A job
with more work than one batch re-enqueues itself with a cursor rather than looping, because a
loop would put the whole sweep back inside a single invocation and undo the split.

Three properties are load-bearing, and each is held by something executable rather than by
this paragraph:

- **No job body may run on the cron invocation.** `tests/unit/tooling/cron-dispatch.spec.ts`
  asserts it; `npm run lint:cron-budget` gates it.
- **Every job carries a `maxBatch`, and no cron path holds an unbounded table read.** Gated by
  the same script, which prints what it checked next to what it found on every run and treats
  "checked nothing" as a failure.
- **Probe-then-enqueue, not enqueue-always.** The other Free ceiling is Queues at 10,000
  operations/day, shared with the Word-export queue; enqueueing thirteen jobs unconditionally
  would spend 7,488 of them a day on jobs with nothing to do. A single-inspector deployment's
  ticks are almost all empty, so probing first sends almost nothing.

Cursors live in Workers KV (`cron:cursor:<job>`), not in a column — they are bookkeeping, every
paged job is idempotent, and a column would mean a migration in both deployment modes.

⚠️ **The post-refactor CPU numbers have not been measured.** The 138 ms figure above is a real
production reading; the batch sizes in the registry are reasoned starting points, not tuned
ones. Measure a real deployment and tune `maxBatch` down until every invocation sits at or
under **5 ms** — half the ceiling, so growth does not immediately re-break it — before treating
the free-tier claim as re-established.

## Cost model (Cloudflare Free tier)

| Resource | Free limit | Typical inspector usage |
|---|---|---|
| Worker requests | 100k/day | < 1k/day for solo inspector |
| D1 reads | 5M/day | < 100/inspection |
| D1 writes | 100k/day | < 50/inspection |
| R2 storage | 10 GB | ~ 50 MB/inspection |
| R2 Class A ops | 1M/mo | photo writes — < 100/inspection |
| KV reads | 100k/day | < 10/request avg |
| Workflows | 100k/day | one per booking |

A solo inspector doing 50 inspections/month uses approximately 1-2% of Free tier limits. Browser Run (server-side PDF generation) is included on the Free tier with 10 browser-minutes/day — sufficient for typical inspection volume. Wrangler `compatibility_date >= "2026-03-24"` is required to enable the `.quickAction()` API.

## CF Workers constraints

| Resource | Free limit | Worker bundle max |
|---|---|---|
| CPU time | 10ms/request | — |
| Worker bundle | — | 3 MB gzip |
| D1 reads | 5M/day | — |
| R2 storage | 10 GB | — |

React Router v8 SSR adds ~1-3ms CPU per request. The combined Worker bundle stays well within limits. Browser Run (server-side PDF) is on the Free tier (10 min/day); requires `compatibility_date >= "2026-03-24"` and the `browser` binding in `wrangler.jsonc`.
