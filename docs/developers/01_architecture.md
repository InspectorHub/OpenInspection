# Architecture

OpenInspection is a home inspection app deployed as a single Cloudflare Worker (the cloudflare/react-router-hono-fullstack-template shape): a Hono entry that mounts the full API in-process and delegates page routes to React Router v7 SSR. This doc covers the high-level architecture for self-hosters, contributors, and reviewers.

> Self-hosted instances run **standalone** (single-tenant) — the default in `wrangler.jsonc`. The engine is tenant-aware under the hood (every table carries `tenant_id`), but you don't manage tenants or subdomains; one fixed tenant holds all your data.

## Stack at a glance

| Layer | Tech |
|---|---|
| Edge runtime | Cloudflare Workers (Free tier sufficient for solo inspectors) |
| API routing | [Hono](https://hono.dev) + Zod OpenAPI (typed JSON API) |
| Frontend | [React Router v7](https://reactrouter.com) + React 18 + Vite |
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

OpenInspection runs as ONE Cloudflare Worker. `workers/app.ts` is a Hono app that is the worker entry: it mounts the full API (`server/`) for API-owned paths and delegates everything else (page routes) to the React Router v7 SSR handler.

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

- **`workers/app.ts`** — a Hono app is the worker entry. It routes API-owned paths (`/api/*`, `/status`, `/m2m/*`, `/photos/*`, `/.well-known/*`, `/doc`, `/sso`, `/sign/*`, ICS/observe feeds) to the API app and sends everything else to the React Router v7 SSR handler. It injects an in-process `API_WORKER` self-binding so React Router loaders/actions call the API app DIRECTLY (no network hop, no second worker, no Service Binding between workers).
- **`server/`** — Hono + Drizzle + D1. Handles all business logic, authentication, and data access. Exposes a typed JSON API.
- **`app/`** — React Router v7 + React 18 + Tailwind v4. Server-side renders the React UI on the edge.
- **Shared UI** (`packages/shared-ui/`) — Design System 0523 token-based React components (Button, Pill, Card, etc.).
- **API Types** (`packages/api-types/`) — Re-exports the Hono app type so the web layer's `hono/client` gets full end-to-end type safety.

The web layer uses a **Token Relay BFF** pattern: the React Router v7 server holds the JWT cookie and forwards it to the in-process API on every request, so the browser never sees the token directly.

### Why React Router v7

- **SPA navigation**: page transitions without full reload — inspectors switch between editor/dashboard/templates frequently
- **React 18**: future React Native app can reuse hooks and state logic (useInspection, useFindings, useSync)
- **SSR on Workers**: full server rendering at the edge, same latency as static HTML
- **hono/client**: Hono exports `AppType`, React Router v7 uses `hono/client` for compile-time type-safe API calls — zero handwritten API client
- **CF Free Tier safe**: React Router v7 SSR adds ~1-3ms CPU per request, well within 10ms limit

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
├── app/                           # Web (React Router v7 + React 18 + Tailwind v4)
│   ├── root.tsx                   # React Router v7 root layout
│   ├── routes.ts                  # Route configuration
│   ├── entry.server.tsx           # React Router v7 CF Workers entry
│   ├── routes/                    # Route files (loader + action + component)
│   ├── components/                # React components
│   ├── hooks/                     # React hooks
│   ├── lib/                       # API client (hono/client over the in-process binding), session, helpers
│   └── styles/tailwind.css        # Design System 0523 token layer
├── migrations/                    # D1 SQL migrations (drizzle-kit schema-first: 0000_baseline.sql + forward)
├── tests/                         # API unit + integration + E2E tests
├── tests/web/                     # Web E2E + unit tests
├── packages/
│   ├── shared-ui/src/             # shared React components
│   └── api-types/                 # CoreApiType for hono/client
├── scripts/                       # Setup, seed, backup, deploy helpers
└── wrangler.jsonc                 # Single-worker config + bindings (committed, placeholder IDs; real IDs in gitignored wrangler.local.jsonc / wrangler.saas.jsonc)
```

## Request flow

### Page (React Router v7) flow

```
Browser request
   ↓
Cloudflare edge → single Worker (workers/app.ts) → Hono routes non-API paths to RR SSR
   ↓
React Router v7 server (SSR):
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

> A SaaS overlay (`server/portal/`, active only when `APP_MODE=saas`) integrates the engine with the InspectorHub control plane. It is out of scope for self-hosting — standalone builds execute none of it. See the super-project `docs/saas-ops/`.

## Authentication

- Login → server signs JWT (ES256 with `kid` header, includes `iat` claim) → sets `__Host-inspector_token` HttpOnly cookie
- Each request: middleware verifies JWT signature + checks `iat >= KV[pwchanged:userId]`
- Password change: writes `pwchanged:userId = now()` to KV → invalidates all prior tokens server-side
- Browser JS never sees the token (HttpOnly enforced); same-origin `fetch()` sends the cookie automatically.
- The web layer uses Token Relay BFF: the React Router v7 server reads the cookie and forwards it to the in-process API on every request.

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

### Verification flow

- **Public verifier** (`/v/:verificationToken`): SSR page resolves the token to an envelope, runs a server-side audit-chain integrity check and Ed25519 signature check, and displays the result with download links. QR code on signed.pdf and certificate.pdf points here.
- **Offline self-verify** (`/verify`): accepts an `evidence.zip` upload and re-runs SHA-256 chain re-derivation + Ed25519 signature verification entirely in the browser via Web Crypto API — no server involvement, court-friendly independence from the operator.

### Optional features

- **D1 — Inspector pre-sign**: inspector can sign the agreement before sending to the client via `POST /api/admin/agreement-requests/:id/inspector-sign`. The render handler conditionally adds an inspector signature block when present.
- **D2 — Auto-sign on publish**: per-inspection `auto_sign_on_publish` flag (plus a tenant-level default). When an inspector has a saved `users.default_signature_base64` and the flag is set, `InspectionService.publishInspection` auto-injects the inspector's signature into `inspection_results.data` at publish time. The report viewer and print output render the signature block automatically.

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

- **React Router v7 SSR**: Routes in `app/routes/` use `loader()` for data fetching and `action()` for mutations. Full server-side rendering on Cloudflare Workers.
- **React components**: 59 components in `app/components/`, organized by domain (inspection, template, booking, etc.).
- **Hooks**: 9 custom hooks handle complex state — `useInspection` (866 LOC), `useFindings`, `useKeyboard` (shortcuts), `useCannedComments`, `useOfflineQueue`, `usePresence` (WebSocket), `useTheme`, `useUnsavedChanges`, `useSessionContext`.
- **Design tokens**: Tailwind v4 with Design System 0523 tokens in `app/styles/tailwind.css`.
- **Shared UI**: `packages/shared-ui/` provides 12 design-system components (Button, Pill, Card, etc.) consumed by the frontend.
- **Dark mode**: `data-color-scheme` attribute on `<html>`, managed by `useTheme` hook (auto/light/dark).

### Future app path

1. **PWA** (current) — installable, offline-capable via Service Worker
2. **Capacitor** (short-term) — native shell for camera, push notifications, App Store
3. **React Native** (long-term) — reuse React hooks/state logic, rewrite UI components

## Storage

- **D1**: structured data (tenants, users, inspections, templates, comments, agreements, audit logs, ...)
- **R2**: blobs. Bucket bindings: `PHOTOS` (field photos, logos) and `REPORTS` (pre-rendered report + e-sign PDFs). Accessed via signed URL or a Worker pass-through endpoint.
- **KV**: short-lived signed tokens (agent share, password reset, magic link), tenant config cache, rate-limit counters.

## Background work

- **Sign-completion workflow** (`server/workflows/`): renders the signed PDF + Certificate of Completion, assembles the evidence pack, and emails the client — see [E-signature](#e-signature-spec-5h). Cloudflare Workflow guarantees retries and persistence across Worker restarts.
- **Cron triggers**: notification reminder sweeps (hourly), report-ready automations.

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

React Router v7 SSR adds ~1-3ms CPU per request. The combined Worker bundle stays well within limits. Browser Run (server-side PDF) is on the Free tier (10 min/day); requires `compatibility_date >= "2026-03-24"` and the `browser` binding in `wrangler.jsonc`.
