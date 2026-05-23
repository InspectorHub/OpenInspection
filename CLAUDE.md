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
- JWT-based authentication (ES256 / ECDSA P-256, HttpOnly cookie `__Host-inspector_token`). Multi-version keyring with `kid` header support for safe rotation — see `src/lib/jwt-keyring.ts`.
- Supports both Cookie (for dashboard) and Bearer Header (for API) token delivery.
- PBKDF2-SHA256 password hashing (100k iterations, 16-byte salt). Legacy SHA-256 hashes auto-rehashed on login.
- **Shared-SaaS login is portal-only.** When `APP_MODE=saas` + `SAAS_TOPOLOGY=shared`, `GET /login` and `GET /forgot-password` 302 to `${PORTAL_API_URL}/login` (resp. `/forgot-password`), and `POST /api/auth/login` returns HTTP 410 `LOGIN_MOVED_TO_PORTAL`. Reason: a single core D1 holds users for many tenants and `users.email` is now unique per-`(tenant_id, email)` (migration 0072), so a local form cannot disambiguate which tenant the user means. Entry into core in this mode is exclusively via portal's `POST /api/account/handoff` → `GET /sso?code=` flow. Standalone and silo deploys are unchanged — the local form still works because their email-to-tenant mapping is unambiguous.
- **Switch workspace UI.** `MainLayout` renders a "Switch workspace" entry in the sidebar (desktop bottom section + mobile drawer) whenever `branding.isSharedSaas` is true and `PORTAL_API_URL` is set. The link points at `${PORTAL_API_URL}/workspace/switch`. Because the JWT carries a single `custom:tenantId`, this portal bounce is the only correct way to swap tenants without losing the session — portal will SSO us back here with the new tenant's cookie (which overwrites the old one).

### Standalone Engine (Single-Tenant)
- Optimized for single-tenant deployments (Private Instances).
- Resolves configuration via a fixed `SINGLE_TENANT_ID`.
- Stable API surface designed to be extended by SaaS overlay branches (e.g., `saas` branch).

### Inspection Engine
- JSON-schema based inspection templates (`src/types/template-schema.ts`, single canonical v2 — see `src/lib/validations/template.schema.ts`).
- 9 item types: `rich` (rating + 3 canned-comment tabs) plus `boolean / text / textarea / number / select / multi_select / date / photo_only` for non-rated data points. Inspection side stores rating on `result.rating` and non-rich values on `result.value`.
- Spectora import path: `POST /api/inspections/templates/import-spectora` accepts a raw Spectora export + a name, runs `lib/spectora-import.ts` (4-bucket → 3-tab mapping, identifier preservation via `source`), creates a template in one shot. UI entry point: "Import Spectora" button on `/templates`.
- Support for field results, e-signatures, and report generation.
- Integrated public booking system with Turnstile bot protection.

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `JWT_CURRENT_KID` | Yes | Active JWT keypair version (e.g. `v1`). Names which `JWT_PRIVATE_KEY_V<N>`/`JWT_PUBLIC_KEY_V<N>` pair signs new tokens. |
| `JWT_PRIVATE_KEY_V<N>` | Yes | PKCS8 PEM-encoded ES256 private key for version `vN`. At least V1 must be provisioned. |
| `JWT_PUBLIC_KEY_V<N>` | Yes | SPKI PEM-encoded ES256 public key for version `vN`. Pairs with private key. Keep older versions in env during rotation so existing tokens stay valid. |
| `JWT_SECRET` | Yes | KDF input for `config-crypto`, `qbo-crypto`, audit signing-key encryption, and M2M Bearer auth. **Not** used for JWT signing anymore — that moved to the ES256 keyring above. |
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
| `GOOGLE_PLACES_API_KEY` | No | Google Places API key powering address autocomplete on the dashboard new-inspection wizard and the public `/book` page (proxied via `/api/places/*` and `/api/public/geocode`). When unset, both endpoints return `{ data: [], reason: 'NO_API_KEY' }` and the address inputs degrade gracefully to plain text — the customer can still type a free-form address and submit. |
| `ESTATED_API_KEY` | No | Sprint 3 S3-1 — Estated.io public-records key for the `POST /api/inspections/:id/property-facts/autofill` endpoint. Resolves year built / sqft / foundation / lot size / bedrooms / bathrooms by address. When unset, the endpoint returns `{ data: null, reason: 'NO_API_KEY' }` and the Property Facts card displays a polite "auto-fill not configured" hint while still accepting manual entry. Same graceful-degrade pattern as `GOOGLE_PLACES_API_KEY`. |

---

- **Framework**: [Hono](https://hono.dev/) with Zod OpenAPI.
- **ORM**: [Drizzle ORM](https://orm.drizzle.team/) with D1.
- **CSS**: [Tailwind CSS](https://tailwindcss.com/).
- **Testing**: Vitest for unit tests; Playwright for E2E.

## JWT & Auth Security Rules

These rules are **mandatory** for any code that touches authentication. Violations reintroduce critical vulnerabilities.

- **ES256 keyring**: All JWT signing and verification MUST go through `src/lib/jwt-keyring.ts`. Direct `sign()` / `verify()` calls from `hono/jwt` are FORBIDDEN — the keyring pins the algorithm to ES256 (ECDSA P-256 SHA-256), stamps the `kid` header, and enforces multi-version verification. Per-request keyrings are pre-built in `diMiddleware` and exposed as `await c.var.keyringPromise`.
- **kid required**: Every JWT MUST carry a `kid` header. `signJwt()` sets it from `JWT_CURRENT_KID`; `verifyJwt()` rejects tokens with no kid, or with a kid that is not in the keyring.
- **iat claim**: `signJwt()` auto-injects `iat: Math.floor(Date.now() / 1000)` when the caller omits it. Without `iat`, KV session invalidation (`pwchanged:{userId}`) cannot work.
- **No HS256 fallback**: There is NO legacy HS256 path. Pre-launch architectural choice — see rotation scripts and docs. The remaining `JWT_SECRET` env binding is now used only as KDF input for `config-crypto`, `qbo-crypto`, audit signing-key encryption, and M2M Bearer auth — never for JWT signing.
- **Key rotation flow**: To rotate, provision `JWT_PRIVATE_KEY_V<N+1>` + `JWT_PUBLIC_KEY_V<N+1>` first (verify-only window), then flip `JWT_CURRENT_KID` to the new version. Old tokens remain verifiable until V<N> is retired.
- **Token NOT in response body**: Login, setup, and join endpoints MUST NOT return the JWT in the JSON response. Tokens are delivered exclusively via `Set-Cookie` (HttpOnly).
- **Cookie name**: Always use `__Host-inspector_token` (enforces `Secure`, `Path=/`, no `Domain`).
- **setCookie attributes**: Every `setCookie()` MUST include `httpOnly: true, secure: true, sameSite: 'Strict', path: '/'`.
- **deleteCookie secure**: Every `deleteCookie()` MUST include `{ path: '/', secure: true }`. Omitting `secure` on `__Host-` cookies throws a runtime exception.
- **No localStorage tokens**: Frontend JS MUST NOT store tokens in `localStorage` or `document.cookie`. Same-origin `fetch()` sends the HttpOnly cookie automatically.
- **KV invalidation**: On password change/reset/delete, write `pwchanged:{userId}` to KV. Auth middleware rejects tokens with `iat < changedAt`.
- **D1 date safety**: Always use `safeISODate()` / `safeTimestamp()` from `src/lib/date.ts` when serializing DB date values. D1 returns mixed formats (Date, int, string).

## Input Validation Rules

- **Zod required**: Every API endpoint that accepts user input (body, query, params) MUST validate using a Zod schema. No manual `if (!field)` or TypeScript generics-only validation.
- **OpenAPIHono routes**: Use `createRoute()` with `request.body/query/params` schemas and access validated data via `c.req.valid('json')`, `c.req.valid('query')`, `c.req.valid('param')`.
- **Non-OpenAPIHono routes**: Use `schema.safeParse(await c.req.json())` and return 400 on failure. This applies to workaround routes that cannot use `createRoute()`.
- **Schema location**: All Zod schemas live in `src/lib/validations/*.schema.ts`. Do not define schemas inline in route handlers.
- **No raw c.req.json()**: Never use `c.req.json<T>()` with only TypeScript generics — generics provide zero runtime protection.

## Language Rules

- **English only**: All source code, comments, documentation, commit messages, and user-facing strings in this project MUST be written in English. No Chinese or other non-English text is permitted.

## Structured Logging Rules

- **No raw console**: Server-side code MUST use `import { logger } from '../lib/logger'` instead of `console.log/error/warn/info`. The `Logger` class outputs structured JSON for log aggregators.
- **Exception**: Client-side JS inside `<script>` tags or inline template scripts (runs in browser) MAY use `console.*`.
- **Exception**: `src/lib/logger.ts` itself uses `console.info` internally — that is correct and must not be changed.
- **Error signature**: `logger.error(message, data?, error?)` — second arg is `Record<string, unknown>`, third is optional `Error`. Do NOT pass raw Error as second arg.
- **No sensitive data in logs**: Never log JWT tokens, passwords, API keys, or full request bodies. Log only error messages, status codes, and non-sensitive identifiers.

## Multi-tenant Security Rules

- **Mandatory tenantId**: Every new database table MUST include `tenantId: text('tenant_id').notNull()` to ensure physical isolation.
- **Fail-Closed Access**: Use `this.sdb` (`ScopedDB`) for all database operations to automatically inject tenant filters.
- **Query Hardening**: If using raw `db`, you MUST explicitly append `eq(table.tenantId, tenantId)` to every `where` clause.
- **Schema Validation**: All input schemas (`CreateXSchema`) must ensure `tenantId` is handled via context, never accepted directly from end-user input.

## Tenant Isolation Rules

- **JWT tenant scoping**: Every authenticated API handler MUST read `tenantId` from JWT claims (`c.get('tenantId')`), never from user input.
- **DB queries**: All database queries MUST filter by `tenantId`. Use service-layer methods that enforce this automatically.
- **Cross-tenant prevention**: Never trust client-supplied `tenantId`. The middleware sets it from the verified JWT — use that value exclusively.
- **Data responses**: API responses MUST NOT leak data from other tenants. Verify tenant ownership before returning any entity.
