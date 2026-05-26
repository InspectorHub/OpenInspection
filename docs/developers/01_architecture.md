# Architecture

OpenInspection is a multi-tenant home inspection app deployed as two independent Cloudflare Workers (API + Frontend). This doc covers the high-level architecture for self-hosters, contributors, and reviewers.

## Stack at a glance

| Layer | Tech |
|---|---|
| Edge runtime | Cloudflare Workers (Free tier sufficient for solo inspectors) |
| API routing | [Hono](https://hono.dev) + Zod OpenAPI (typed JSON API) |
| Frontend | [Remix](https://remix.run) (React Router v7) + React 18 + Vite |
| ORM + DB | [Drizzle](https://orm.drizzle.team) + Cloudflare D1 (SQLite) |
| Object storage | Cloudflare R2 (photos, future PDFs) |
| KV cache | Cloudflare Workers KV (tenant config, signed tokens, rate-limit counters) |
| Background jobs | Cloudflare Workflow (onboarding) + Cron Triggers (automation sweeps) |
| Styling | Tailwind CSS v4 + Design System 0523 tokens |
| Shared components | `packages/shared-ui/` — 12 token-based React components |
| AI | Google Gemini API (optional) |
| Email | Resend |
| Payments | Stripe Connect (optional) |
| Auth | ES256 JWT in HttpOnly cookie + PBKDF2-SHA256 password hashing |

## Dual-Deploy Architecture

OpenInspection runs as two independent Cloudflare Workers:

```
                    ┌─────────────────────────┐
  Browser ────────► │  Frontend Worker         │
                    │  Remix + React 18        │
                    │  SSR on CF Workers       │
                    │                          │
                    │  Token Relay BFF:        │
                    │  holds JWT cookie,       │
                    │  forwards to API         │
                    └─────────┬───────────────┘
                              │ Service Binding
                              │ (zero-latency)
                    ┌─────────▼───────────────┐
                    │  API Worker              │
                    │  Hono + Drizzle + D1     │
                    │  All business logic      │
                    │                          │
                    │  D1 · R2 · KV · Workflow │
                    └─────────────────────────┘
```

- **API Worker** (`api/`) — Hono + Drizzle + D1. Handles all business logic, authentication, and data access. Exposes a typed JSON API.
- **Frontend Worker** (`frontend/`) — Remix + React 18 + Tailwind v4. Server-side renders the React UI. Calls API Worker via Service Binding (no network hop in production) or HTTP proxy (in local dev).
- **Shared UI** (`packages/shared-ui/`) — Design System 0523 token-based React components (Button, Pill, Card, etc.).
- **API Types** (`packages/api-types/`) — Re-exports the Hono app type so the frontend's `hono/client` gets full end-to-end type safety.

The frontend uses a **Token Relay BFF** pattern: the Remix server holds the JWT cookie and forwards it to the API Worker on every request, so the browser never sees the token directly.

### Why Remix (React Router v7)

- **SPA navigation**: page transitions without full reload — inspectors switch between editor/dashboard/templates frequently
- **React 18**: future React Native app can reuse hooks and state logic (useInspection, useFindings, useSync)
- **SSR on Workers**: full server rendering at the edge, same latency as static HTML
- **hono/client**: Hono exports `AppType`, Remix uses `hono/client` for compile-time type-safe API calls — zero handwritten API client
- **CF Free Tier safe**: Remix SSR adds ~1-3ms CPU per request, well within 10ms limit

## Module map

```
apps/core/
├── api/
│   ├── src/
│   │   ├── index.ts               # Hono app entry, middleware order, route registration
│   │   ├── api/                   # Route handlers (one file per resource)
│   │   │   ├── auth.ts            # /api/auth/{login,register,reset-password,...}
│   │   │   ├── inspections.ts     # /api/inspections/* + share/print
│   │   │   ├── ai.ts              # /api/ai/{suggest-comment,comment/edit}
│   │   │   ├── booking.ts         # /api/public/* (no auth) + /api/book
│   │   │   └── ...
│   │   ├── services/              # Business logic, DB queries (Drizzle)
│   │   ├── features/              # Feature-scoped modules (per-strategy splits)
│   │   │   └── tenant-routing/    # Tenant resolution: path-param → subdomain → fixed
│   │   ├── lib/
│   │   │   ├── middleware/        # Hono middleware (auth, RBAC, branding, DI)
│   │   │   ├── db/                # Drizzle schema + utils
│   │   │   ├── validations/       # Zod schemas per module
│   │   │   ├── errors.ts          # AppError + ErrorCode + Errors factory
│   │   │   ├── logger.ts          # Structured JSON logger (use this, not console)
│   │   │   └── ics.ts             # iCalendar string builder
│   │   └── workflows/             # Cloudflare Workflow durable steps
│   ├── migrations/                # D1 SQL migrations (00xx_<name>.sql)
│   └── tests/                     # API unit + integration + E2E tests
├── frontend/
│   ├── app/
│   │   ├── root.tsx               # Remix root layout
│   │   ├── routes.ts              # Route configuration
│   │   ├── entry.server.tsx       # Remix CF Workers entry
│   │   ├── routes/                # 75 route files (loader + action + component)
│   │   ├── components/            # 61 React components
│   │   ├── hooks/                 # 9 React hooks
│   │   ├── lib/                   # API client (hono/client), session, helpers
│   │   └── styles/tailwind.css    # Design System 0523 token layer
│   └── tests/                     # Frontend E2E + unit tests
├── packages/
│   ├── shared-ui/src/             # 11 shared React components
│   └── api-types/                 # CoreApiType for hono/client
├── scripts/                       # Setup, seed, backup, deploy helpers
└── wrangler.toml                  # API Worker config + bindings (local dev)
```

## Request flow

### Frontend (Remix) flow

```
Browser request
   ↓
Cloudflare edge → Frontend Worker fetch handler
   ↓
Remix server (SSR):
   1. Route matched → loader() or action() executes
   2. Reads session cookie (Token Relay BFF)
   3. Calls API Worker via Service Binding (hono/client)
   4. Renders React component tree to HTML
   ↓
HTML + hydration bundle sent to browser
   ↓
Client-side: React hydrates, subsequent navigations use client-side routing
```

### API Worker flow

```
API request (from Frontend Worker or direct)
   ↓
Cloudflare edge → API Worker fetch handler
   ↓
Hono middleware stack (in order):
   1. CSP / security headers
   2. Branding resolver (KV → D1 fallback)
   3. Tenant router (subdomain → tenant ID)
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

## Multi-tenancy model

Every D1 table includes `tenant_id` (NOT NULL). Three deployment modes:

- **Standalone** (default for self-hosters): single tenant. `SINGLE_TENANT_ID` env var pins all data to one tenant. The tenant subdomain is irrelevant.
- **Shared SaaS**: one Worker, many tenants, each on a subdomain (`acme.app.com`, `xyz.app.com`).
- **Silo SaaS**: per-tenant dedicated D1 (provisioned via Cloudflare API).

Tenant resolution lives in `api/src/features/tenant-routing/` (entry point `index.ts`, with per-strategy resolvers in sibling files). The `tenantRouter` middleware tries three strategies in order:

1. **Path-param resolution** (`resolve-by-path-param.ts`) — matches URL patterns like `/book/:tenant/:slug` first so public routes work uniformly across all deploy modes
2. **Subdomain resolution** (`resolve-by-subdomain.ts`) — silo / shared SaaS: extracts the subdomain from the `Host` header, looks up the tenant via KV (5-minute TTL) with D1 fallback, then writes the result back to KV
3. **Fixed-tenant fallback** (`resolve-by-fixed-tenant.ts`) — standalone: pins the request to `profile.fixedTenantId`

## Authentication

- Login → server signs JWT (ES256 with `kid` header, includes `iat` claim) → sets `__Host-inspector_token` HttpOnly cookie
- Each request: middleware verifies JWT signature + checks `iat >= KV[pwchanged:userId]`
- Password change: writes `pwchanged:userId = now()` to KV → invalidates all prior tokens server-side
- Browser JS never sees the token (HttpOnly enforced); same-origin `fetch()` sends the cookie automatically.
- Frontend Worker uses Token Relay BFF: Remix server reads the cookie and forwards it via Service Binding to the API Worker.

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

The DI proxy in `api/src/lib/middleware/di.ts` lazy-instantiates each service on first access per request.

## Frontend layer

- **Remix SSR**: Routes in `frontend/app/routes/` use `loader()` for data fetching and `action()` for mutations. Full server-side rendering on Cloudflare Workers.
- **React components**: 59 components in `frontend/app/components/`, organized by domain (inspection, template, booking, etc.).
- **Hooks**: 9 custom hooks handle complex state — `useInspection` (866 LOC), `useFindings`, `useKeyboard` (shortcuts), `useCannedComments`, `useOfflineQueue`, `usePresence` (WebSocket), `useTheme`, `useUnsavedChanges`, `useSessionContext`.
- **Design tokens**: Tailwind v4 with Design System 0523 tokens in `frontend/app/styles/tailwind.css`.
- **Shared UI**: `packages/shared-ui/` provides 12 design-system components (Button, Pill, Card, etc.) consumed by the frontend.
- **Dark mode**: `data-color-scheme` attribute on `<html>`, managed by `useTheme` hook (auto/light/dark).

### Future app path

1. **PWA** (current) — installable, offline-capable via Service Worker
2. **Capacitor** (short-term) — native shell for camera, push notifications, App Store
3. **React Native** (long-term) — reuse React hooks/state logic, rewrite UI components

## Storage

- **D1**: structured data (tenants, users, inspections, templates, comments, agreements, audit logs, ...)
- **R2**: blobs (photos, logos, future PDFs). Bucket bindings: `PHOTOS`. Photos accessed via signed URL or pass-through endpoint.
- **KV**: short-lived signed tokens (agent share, password reset, magic link), tenant config cache, rate-limit counters.

## Background work

- **Onboarding workflow** (`api/src/workflows/onboarding-workflow.ts`): provision DNS → activate tenant → sync to core → send welcome email. Cloudflare Workflow guarantees retries and persistence across Worker restarts.
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

A solo inspector doing 50 inspections/month uses approximately 1-2% of Free tier limits. Browser Rendering (server-side PDF generation) requires Workers Paid ($5/mo); the default report PDF uses browser `window.print()` which is free and produces near-identical output via the `@media print` stylesheet.

## CF Workers constraints

| Resource | Free limit | Worker bundle max |
|---|---|---|
| CPU time | 10ms/request | — |
| Worker bundle | — | 3 MB gzip |
| D1 reads | 5M/day | — |
| R2 storage | 10 GB | — |

Remix SSR adds ~1-3ms CPU per request. The API Worker bundle is ~250KB gzip, well within limits. Browser Rendering (server-side PDF) requires Workers Paid ($5/mo); the default uses `window.print()` which is free.
