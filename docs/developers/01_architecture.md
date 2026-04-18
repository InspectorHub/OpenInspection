# Architecture Overview

OpenInspection is a single Cloudflare Worker that serves as both a web server and API. There is no build step and no separate frontend server — HTML is rendered on the edge from TypeScript template functions.

## Runtime Model

| Concern | Technology |
|---|---|
| Runtime | Cloudflare Workers (WinterCG-compatible) |
| Framework | Hono v4 |
| Database | Cloudflare D1 (SQLite) via Drizzle ORM |
| Storage | Cloudflare R2 (inspection photos) |
| Cache | Cloudflare KV (tenant record cache, 5-min TTL) |
| Email | Resend API |
| AI | Google Gemini 1.5 Flash |
| Styling | Tailwind CSS v3 (CLI build → `public/styles.css`) |

## Request Lifecycle

Every request passes through the following middleware chain in `src/index.ts`:

```
Request
  │
  ├─ GET /status          → health check (bypass all middleware)
  │
  ├─ diMiddleware         → injects service registry into context
  │
  ├─ subdomainRouter      → **Dual Mode Routing**:
  │                         1. Apex Mode: If SINGLE_TENANT_ID is set, bypass subdomain logic.
  │                         2. SaaS Mode: Extract subdomain from Host header,
  │                            look up tenant in KV → D1 fallback.
  │                         Sets: c.get('tenantId'), c.get('requestedSubdomain')
  │
  ├─ Silo middleware       → reads TENANT_CACHE KV for key silo:{tenantId};
  │                         if found, replaces c.env.DB with D1HttpDatabase
  │                         (per-tenant isolated database, transparent to handlers)
  │
  ├─ brandingMiddleware    → loads site branding configuration
  │
  ├─ JWT middleware        → applied to /api/* except:
  │   (custom)              - /api/auth/*
  │                          - /api/public/*
  │                          - /api/admin/(connect|silo|tenant-status)   ← uses Bearer JWT_SECRET (m2m)
  │                          - /api/inspections/:id/(report|sign|checkout|payment-success*)
  │                          - /api/calendar/callback      ← public OAuth redirect from Google
  │   Sets: c.get('tenantId'), c.get('userRole')
  │
  ├─ requireActiveSubscription  → blocks non-GET mutations when tenantStatus is past_due or pending (HTTP 402)
  │                               dev subdomain and free+active tenants always bypass
  │
  └─ Route handler        → returns HTML or JSON response
```

## Multi-Tenancy & Deployment Modes

The application supports two primary routing strategies within a single codebase:

### 1. SaaS Mode (Subdomain-Based)
In SaaS deployments, each inspection company gets a subdomain (e.g., `smith.yourdomain.com`). The `subdomainRouter` middleware in `src/lib/middleware/tenant-router.ts` extracts the subdomain from the `Host` header, resolves the matching tenant from D1, and caches the result in KV for 5 minutes.

### 2. Apex Mode (Single-Tenant / Self-Hosted)
In standalone deployments, setting the `SINGLE_TENANT_ID` environment variable activates **Apex Mode**. The router bypasses subdomain extraction and directly loads the context for the specified tenant on the primary domain. This is the recommended mode for individual companies.

**Tenant isolation** is enforced at the query level: every authenticated database query filters by `tenantId` obtained from the JWT claim `custom:tenantId` or the mode-specific router context.

## RBAC

Roles are stored in the `users` table and carried in the JWT as both `role` and `custom:userRole` claims. The `requireRole()` middleware in `src/lib/middleware/rbac.ts` reads `c.get('userRole')` and returns 403 if the role is not in the allowed list.

| Role | Capabilities |
|---|---|
| `owner` | Full access to all operations, including billing and workspace deletion |
| `admin` | Full access to project operations, member management |
| `inspector` | Create inspections, submit field data, upload photos |
| `agent` | View referred inspection reports, export agent-specific data |

## Tenant Tier System

Tenant billing tier and subscription status are stored in the `tenants` table and loaded by `subdomainRouter` into the Hono context on every request.

### Tiers

| Tier | Deployment | Description |
|---|---|---|
| `free` | Standalone self-hosted | Set by setup wizard. All features enabled. No billing. |
| `pro` | SaaS pooled | Active paid subscription. All features except silo mode. |
| `enterprise` | SaaS pooled or silo | Highest tier. Silo mode eligible. |

### Statuses

| Status | Access | Description |
|---|---|---|
| `active` | Full | Subscription current or standalone self-hosted |
| `trialing` | Full | In a Stripe trial period |
| `pending` | Read-only | Registered but subscription not yet started |
| `past_due` | Read-only | Payment failed; grace period — mutations blocked |
| `suspended` | Blocked (403) | Cancelled or expired — all access blocked at router level |

### Middleware (`src/lib/middleware/tier-guard.ts`)

**`requireActiveSubscription`** — applied globally to `/api/*` routes (after JWT middleware). Blocks non-GET mutations when `tenantStatus` is `past_due` or `pending`, returning HTTP 402 with `{ "error": "Subscription required" }`. The dev subdomain and any tenant with `tier: 'free'` always bypass this check.

**`requireTierFeature(feature)`** — per-route guard for premium features:
- `'silo_mode'` — enterprise tier only
- `'stripe_connect'` — pro tier and above

### Context Variables Set by `subdomainRouter`

| Variable | Type | Source |
|---|---|---|
| `tenantId` | `string` | `tenants.id` |
| `tenantTier` | `'free' \| 'pro' \| 'enterprise'` | `tenants.tier` |
| `tenantStatus` | `'pending' \| 'trialing' \| 'active' \| 'past_due' \| 'suspended'` | `tenants.status` |

### Tier/Status Sync (M2M)

Portal pushes tier+status to core after every Stripe subscription event via `POST /api/admin/tenant-status` (Bearer JWT_SECRET). Core immediately deletes the KV cache entry for that tenant so the next request fetches the updated record from D1.

## Template Rendering

All HTML is server-rendered from TypeScript template functions. There is no React, Vue, or other frontend framework. Pages are plain HTML strings with Tailwind CSS classes. JavaScript in templates is used only for:

- Dashboard: JWT token management in `localStorage`, API calls to `/api/*`
- Field form: Offline sync via `IndexedDB`, photo upload via `FormData`
- Report viewer: Agreement signing canvas, Stripe checkout redirect
- Agent dashboard: API calls to `/api/agent/*`

## Directory Structure

```
src/
  index.ts                    — Hono app entry point, route mounting, middleware
  global.d.ts                 — Cloudflare Worker type extensions
  api/
    inspections.ts            — CRUD + report delivery + photo upload + Stripe checkout
    bookings.ts               — Public booking endpoints (no auth) + booking email
    ai.ts                     — Gemini AI comment assist
    admin.ts                  — Data export, team invite, M2M silo/connect sync
    agent.ts                  — Referral CRM endpoints
    availability.ts           — Inspector weekly schedule + date overrides
    calendar.ts               — Google Calendar OAuth + availability sync
    setup.ts                  — First-run wizard API
  lib/
    db/schema/
      tenant.ts               — tenants, users tables
      inspection.ts           — templates, inspections, results, agreements, availability
      index.ts                — re-exports all schema
    middleware/
      tenant-router.ts        — subdomain → tenantId resolution + KV cache
      rbac.ts                 — requireRole() middleware
      bot-protection.ts       — Turnstile verification + CF threat_score blocking
    db/
      schema/
        tenant.ts             — tenants, users, tenantInvites tables
        inspection.ts         — templates, inspections, results, agreements, availability
        index.ts              — re-exports all schema
      silo.ts                 — D1HttpDatabase: D1 over REST API for silo mode
  templates/
    layouts/
      main-layout.template.ts — Two layout shells:
                                  renderMainLayout()  — public pages (header, footer, Alpine, Turnstile)
                                  renderBareLayout()  — authenticated full-page views (no header/footer)
    pages/
      home.tsx        — Public company homepage          (uses renderMainLayout)
      booking.tsx     — Public booking form              (uses renderMainLayout)
      join.tsx        — Team invitation acceptance       (uses renderMainLayout)
      form-renderer.tsx — Mobile field collection UI    (uses renderMainLayout)
      dashboard.tsx   — Inspector job dashboard          (uses renderBareLayout)
      setup.tsx       — First-run setup wizard           (uses renderBareLayout)
      report.tsx      — Client report viewer             (uses renderBareLayout)
      agent-dashboard.tsx — Agent referral dashboard     (uses renderBareLayout)
    components/
      header.tsx      — Site header (stub — customize here)
      footer.tsx      — Site footer (stub — customize here)
      breadcrumbs.tsx — Breadcrumb nav component
      styles.tsx      — Returns <link> to /styles.css
      cookie-consent.tsx — Cookie consent banner
      google-analytics.tsx — GA4 snippet
  styles/
    input.css                 — Tailwind source: custom utilities, animations, print rules
    output.css                — (legacy, unused — superseded by public/styles.css)
public/
  styles.css                  — Compiled Tailwind output (gitignored, built by css:build)
```

## Environment Bindings

```toml
# wrangler.toml bindings
[assets]
directory = "./public"         # serves public/styles.css at /styles.css

[[d1_databases]]
binding = "DB"

[[r2_buckets]]
binding = "PHOTOS"

[[kv_namespaces]]
binding = "TENANT_CACHE"
```

Non-secret vars (set in `wrangler.toml [vars]`):

| Variable | Purpose |
|---|---|
| `TURNSTILE_SITE_KEY` | Renders Turnstile widget in booking form |
| `APP_BASE_URL` | Public Worker URL — used to build Google OAuth callback redirect URI |

Secrets (set via `wrangler secret put` for production, `.dev.vars` for local):

| Variable | Required | Purpose |
|---|---|---|
| `JWT_SECRET` | Yes | Signs and verifies HS256 JWTs |
| `RESEND_API_KEY` | No | Email delivery of reports + booking confirmations |
| `SENDER_EMAIL` | No | From address for outbound emails |
| `GEMINI_API_KEY` | No | AI comment and summary assist |
| `STRIPE_SECRET_KEY` | No | Real Stripe checkout; mock fallback if absent |
| `STRIPE_WEBHOOK_SECRET` | No | HMAC-SHA256 webhook verification |
| `TURNSTILE_SECRET_KEY` | **Yes** | Server-side Turnstile verification — `POST /api/book` rejects requests without a valid token when this secret is configured. Use Cloudflare test secret for local dev. |
| `GOOGLE_CLIENT_ID` | No | Google Calendar OAuth |
| `GOOGLE_CLIENT_SECRET` | No | Google Calendar OAuth |
| `CF_ACCOUNT_ID` | No | Cloudflare account ID — required for silo mode |
| `CF_API_TOKEN` | No | Cloudflare API token (D1:Edit) — required for silo mode |

## JWT Claims

Tokens are issued by the portal (or setup wizard for standalone deployments) and verified by the core Worker.

```json
{
  "sub": "user-id",
  "email": "user@example.com",
  "role": "inspector",
  "custom:tenantId": "tenant-id",
  "custom:userRole": "inspector",
  "iat": 1234567890,
  "exp": 1234654290
}
```

The token is accepted from:
1. `Authorization: Bearer <token>` header
2. `inspector_token` cookie (used by dashboard pages)

After JWT verification, `subdomainRouter` additionally populates `tenantTier` and `tenantStatus` in the Hono context from the tenant record. These are not JWT claims — they are loaded from D1 (via KV cache) on every request.
