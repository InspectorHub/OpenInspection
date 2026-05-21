# Architecture

OpenInspection is a multi-tenant home inspection app deployed as a Cloudflare Worker. This doc covers the high-level architecture for self-hosters, contributors, and reviewers.

## Stack at a glance

| Layer | Tech |
|---|---|
| Edge runtime | Cloudflare Workers (Free tier sufficient for solo inspectors) |
| Routing + JSX | [Hono](https://hono.dev) + hono/jsx (server-rendered HTML) |
| ORM + DB | [Drizzle](https://orm.drizzle.team) + Cloudflare D1 (SQLite) |
| Object storage | Cloudflare R2 (photos, future PDFs) |
| KV cache | Cloudflare Workers KV (tenant config, signed tokens, rate-limit counters) |
| Background jobs | Cloudflare Workflow (onboarding) + Cron Triggers (automation sweeps) |
| Frontend runtime | Alpine.js 3.x (no React/Vue runtime) + Tailwind CSS v3 |
| AI | Google Gemini API (optional) |
| Email | Resend |
| Payments | Stripe Connect (optional) |
| Auth | HS256 JWT in HttpOnly cookie + PBKDF2-SHA256 password hashing |

## Module map

```
apps/core/
├── src/
│   ├── index.ts               # Hono app entry, middleware order, route registration
│   ├── api/                   # Route handlers (one file per resource)
│   │   ├── auth.ts            # /api/auth/{login,register,reset-password,...}
│   │   ├── inspections.ts     # /api/inspections/* + share/print
│   │   ├── ai.ts              # /api/ai/{suggest-comment,comment/edit}
│   │   ├── booking.ts         # /api/public/* (no auth) + /api/book
│   │   ├── ...
│   ├── services/              # Business logic, DB queries (Drizzle)
│   │   ├── inspection.service.ts
│   │   ├── ai.service.ts
│   │   ├── email.service.ts
│   │   ├── ...
│   ├── features/              # Feature-scoped modules (per-strategy splits)
│   │   ├── tenant-routing/    # Tenant resolution: path-param → subdomain → fixed
│   ├── lib/
│   │   ├── middleware/        # Hono middleware (auth, RBAC, branding, DI)
│   │   ├── db/                # Drizzle schema + utils
│   │   ├── validations/       # Zod schemas per module
│   │   ├── errors.ts          # AppError + ErrorCode + Errors factory
│   │   ├── logger.ts          # Structured JSON logger (use this, not console)
│   │   ├── ics.ts             # iCalendar string builder
│   ├── templates/             # hono/jsx templates (server-rendered)
│   │   ├── layouts/           # MainLayout (auth) + BareLayout (public)
│   │   ├── components/        # Reusable UI: PageHeader, Modal, etc.
│   │   ├── pages/             # One file per page (dashboard.tsx, ...)
│   ├── workflows/             # Cloudflare Workflow durable steps
│   ├── styles/input.css       # Tailwind input + canonical v3 :root tokens
├── public/                    # Static assets (compiled CSS, fonts, JS)
│   ├── js/                    # Alpine handlers (one file per page typically)
│   ├── fonts/                 # Self-hosted fonts (Inter, JetBrains Mono)
├── migrations/                # D1 SQL migrations (00xx_<name>.sql)
├── scripts/                   # Setup, seed, codemod, deploy helpers
├── tests/
│   ├── unit/                  # Vitest
│   ├── e2e/                   # Playwright
└── wrangler.toml              # Worker config + bindings
```

## Request flow

```
Client request
   ↓
Cloudflare edge → Worker fetch handler
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
   ↓
JSX rendered via hono/jsx, returned as HTML
```

## Multi-tenancy model

Every D1 table includes `tenant_id` (NOT NULL). Three deployment modes:

- **Standalone** (default for self-hosters): single tenant. `SINGLE_TENANT_ID` env var pins all data to one tenant. The tenant subdomain is irrelevant.
- **Shared SaaS**: one Worker, many tenants, each on a subdomain (`acme.app.com`, `xyz.app.com`).
- **Silo SaaS**: per-tenant dedicated D1 (provisioned via Cloudflare API).

Tenant resolution lives in `features/tenant-routing/` (entry point `index.ts`, with per-strategy resolvers in sibling files). The `tenantRouter` middleware tries three strategies in order:

1. **Path-param resolution** (`resolve-by-path-param.ts`) — matches URL patterns like `/book/:tenant/:slug` first so public routes work uniformly across all deploy modes
2. **Subdomain resolution** (`resolve-by-subdomain.ts`) — silo / shared SaaS: extracts the subdomain from the `Host` header, looks up the tenant via KV (5-minute TTL) with D1 fallback, then writes the result back to KV
3. **Fixed-tenant fallback** (`resolve-by-fixed-tenant.ts`) — standalone: pins the request to `profile.fixedTenantId`

## Authentication

- Login → server signs JWT (HS256, includes `iat` claim) → sets `__Host-inspector_token` HttpOnly cookie
- Each request: middleware verifies JWT signature + checks `iat ≥ KV[pwchanged:userId]`
- Password change: writes `pwchanged:userId = now()` to KV → invalidates all prior tokens server-side
- Browser JS never sees the token (HttpOnly enforced); same-origin `fetch()` sends the cookie automatically.

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

The DI proxy in `lib/middleware/di.ts` lazy-instantiates each service on first access per request.

## Frontend layer

- **No build step for runtime JS**: Alpine.js loads from `/vendor/alpinejs.min.js` (self-hosted), page-specific handlers in `/js/<page>.js`, all globals.
- **Tailwind**: `src/styles/input.css` is the source; `npm run css:build` outputs `public/styles.css`. Watch via `npm run css:watch`.
- **JSX server-side only**: `hono/jsx` renders to HTML on the Worker — no React or Vue runtime, no SSR-then-hydrate. Alpine handles interactivity client-side.
- **Component primitives**: `src/templates/components/{page-header,modal,inline-text-popover,...}.tsx` are reusable JSX components.
- **Design tokens**: defined in `src/styles/input.css` `:root` block. The full design system reference (typography scale, color tokens, motion patterns, accessibility standards) is in `docs/superpowers/plans/2026-05-08-sprint1-design-system-reference.md`.

## Storage

- **D1**: structured data (tenants, users, inspections, templates, comments, agreements, audit logs, ...)
- **R2**: blobs (photos, logos, future PDFs). Bucket bindings: `PHOTOS`. Photos accessed via signed URL or pass-through endpoint.
- **KV**: short-lived signed tokens (agent share, password reset, magic link), tenant config cache, rate-limit counters.

## Background work

- **Onboarding workflow** (`workflows/onboarding-workflow.ts`): provision DNS → activate tenant → sync to core → send welcome email. Cloudflare Workflow guarantees retries and persistence across Worker restarts.
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

## Extending OpenInspection

See [`docs/extending.md`](extending.md) for cookbook recipes: new templates, payment providers, automation rules, comment libraries, SSO providers, languages, report themes, server-side PDFs, webhook receivers, and individual page overrides.
