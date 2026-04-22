# CLAUDE.md — OpenInspection (Open Source Edition)

The open-source inspection engine. A standalone Cloudflare Worker designed for simplicity and extensibility.

**Docs**: `docs/architecture.md` · `docs/developers/` · `docs/inspectors/` · `docs/testing.md`

## Commands

```bash
npm install
npm run dev          # Start local development server (port 8788)
npm run css:watch    # Watch and compile Tailwind CSS
npm run db:migrate   # Apply D1 migrations locally
npm run type-check   # Run TypeScript type checks
npm run lint         # Lint the codebase
npm run test:unit    # Run unit tests via Vitest
npm run deploy       # Deploy to Cloudflare Workers
```

## Key Files & Directories

| File/Dir | Purpose |
|---|---|
| `src/index.ts` | Hono app entry point and route configuration |
| `src/api/` | API route handlers (Auth, Inspections, Bookings, etc.) |
| `src/lib/db/` | Drizzle ORM schema and database utilities |
| `src/lib/middleware/` | Hono middleware (Authentification, RBAC, etc.) |
| `public/` | Static assets and compiled CSS |
| `migrations/` | D1 database migration SQL files |

## Core Architecture

### Authentication
- JWT-based authentication system (HS256, HttpOnly cookie `__Host-inspector_token`).
- Supports both Cookie (for dashboard) and Bearer Header (for API) token delivery.
- PBKDF2-SHA256 password hashing (100k iterations, 16-byte salt). Legacy SHA-256 hashes auto-rehashed on login.

### Standalone Engine (Single-Tenant)
- Optimized for single-tenant deployments (Private Instances).
- Resolves configuration via a fixed `SINGLE_TENANT_ID`.
- Stable API surface designed to be extended by SaaS overlay branches (e.g., `saas` branch).

### Inspection Engine
- JSON-schema based inspection templates.
- Support for field results, e-signatures, and report generation.
- Integrated public booking system with Turnstile bot protection.

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `JWT_SECRET` | Yes | Token signing key |
| `DB` | Yes | Cloudflare D1 Database binding |
| `PHOTOS` | Yes | Cloudflare R2 Bucket for image storage |
| `TENANT_CACHE`| Yes | Cloudflare KV for configuration caching |
| `TURNSTILE_SECRET_KEY` | No | Server-side Turnstile verification — `POST /api/book` enforces this when set. Use test secret `1x0000000000000000000000000000000AA` for local dev. |
| `APP_BASE_URL` | No | Public URL for OAuth and link generation |
| `RESEND_API_KEY`| No | Email delivery (via Resend.com) |
| `GEMINI_API_KEY`| No | AI-powered inspection assistance |
| `APP_MODE` | No | `standalone` (default) or `saas` — controls tenant resolution |
| `APP_NAME` | No | Custom branding name |
| `PRIMARY_COLOR` | No | Custom branding color |
| `SINGLE_TENANT_ID` | No | Fixed tenant ID for standalone mode |
| `SETUP_CODE` | No | Verification code for first-time setup |
| `PORTAL_API_URL` | No | Portal URL for M2M sync callbacks |
| `PORTAL_M2M_SECRET`| No | Shared secret for M2M auth (`Authorization: Bearer {secret}`) |
| `STRIPE_SECRET_KEY` | No | Stripe API key (for Connect payments) |
| `STRIPE_WEBHOOK_SECRET` | No | Stripe webhook HMAC verification |
| `GA_MEASUREMENT_ID` | No | Google Analytics tracking ID |

---

- **Framework**: [Hono](https://hono.dev/) with Zod OpenAPI.
- **ORM**: [Drizzle ORM](https://orm.drizzle.team/) with D1.
- **CSS**: [Tailwind CSS](https://tailwindcss.com/).
- **Testing**: Vitest for unit tests; Playwright for E2E.

## JWT & Auth Security Rules

These rules are **mandatory** for any code that touches authentication. Violations reintroduce critical vulnerabilities.

- **HS256 pinning**: Every `sign()` call MUST pass `'HS256'` as the 3rd argument. Every `verify()` call MUST pass `'HS256'`.
- **iat claim**: Every `sign()` call MUST include `iat: Math.floor(Date.now() / 1000)`. Without `iat`, KV session invalidation cannot work.
- **No fallback secret**: NEVER use `JWT_SECRET || 'fallback'` or any hardcoded default. Throw if `JWT_SECRET` is missing or `< 32 chars`.
- **Token NOT in response body**: Login, setup, and join endpoints MUST NOT return the JWT in the JSON response. Tokens are delivered exclusively via `Set-Cookie` (HttpOnly).
- **Cookie name**: Always use `__Host-inspector_token` (enforces `Secure`, `Path=/`, no `Domain`).
- **setCookie attributes**: Every `setCookie()` MUST include `httpOnly: true, secure: true, sameSite: 'Strict', path: '/'`.
- **deleteCookie secure**: Every `deleteCookie()` MUST include `{ path: '/', secure: true }`. Omitting `secure` on `__Host-` cookies throws a runtime exception.
- **No localStorage tokens**: Frontend JS MUST NOT store tokens in `localStorage` or `document.cookie`. Same-origin `fetch()` sends the HttpOnly cookie automatically.
- **KV invalidation**: On password change/reset/delete, write `pwchanged:{userId}` to KV. Auth middleware rejects tokens with `iat < changedAt`.
- **D1 date safety**: Always use `safeISODate()` / `safeTimestamp()` from `src/lib/date.ts` when serializing DB date values. D1 returns mixed formats (Date, int, string).

## Multi-tenant Security Rules

- **Mandatory tenantId**: Every new database table MUST include `tenantId: text('tenant_id').notNull()` to ensure physical isolation.
- **Fail-Closed Access**: Use `this.sdb` (`ScopedDB`) for all database operations to automatically inject tenant filters.
- **Query Hardening**: If using raw `db`, you MUST explicitly append `eq(table.tenantId, tenantId)` to every `where` clause.
- **Schema Validation**: All input schemas (`CreateXSchema`) must ensure `tenantId` is handled via context, never accepted directly from end-user input.
