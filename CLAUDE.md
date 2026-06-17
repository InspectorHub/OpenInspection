# CLAUDE.md — OpenInspection (Open Source Edition)

The open-source inspection engine. A single Cloudflare Worker (the
cloudflare/react-router-hono-fullstack-template shape): a Hono entry that mounts the full
API in-process and delegates page routes to React Router v7 SSR.

**Docs**: `docs/developers/` (architecture, deploy, testing, API ref) · `docs/getting-started.md` (user guide)

## Commands

```bash
# Single package.json at the root.
npm install
npm run dev          # Build + run the worker locally (react-router build + wrangler dev).
                     # Production-shape (real workerd, no HMR) — use to verify built behavior.
npm run dev:hmr      # Vite dev server with HMR (react-router dev). The fast iteration loop.
                     # Works since the lazy-API entry refactor (workers/app.ts) — the entry
                     # must keep its top-level import graph tiny; see the comment there.
npm run build        # react-router build — bundles server/ (API) + app/ (RR SSR) into one worker
npm run deploy       # standalone: build + wrangler deploy (real ids via wrangler.local.jsonc)
npm run deploy:saas  # saas: build + wrangler deploy with wrangler.saas.jsonc
npm run type-check   # react-router typegen, then the app + api tsc passes run CONCURRENTLY
npm run type-check:app   # tsc app side only (tsconfig.json)
npm run type-check:api   # tsc api side only (tsconfig.api.json) — fastest loop for server/ work
npm run type-check:fast  # tsgo (@typescript/native-preview) both passes; tsc stays the CI gate
npm run lint
npm run test:unit    # API unit tests (vitest --config vitest.api.config.ts)
npm run test:web     # Web unit tests (vitest --config vitest.config.ts)
npm run test:workers # Real-runtime (workerd) queue-path tests (vitest.workers.config.ts)
npm run test:e2e     # Playwright E2E

# Database — drizzle-kit schema-first (server/lib/db/schema is the source of truth)
npm run db:migrate          # apply migrations to local D1
npm run db:migrate:remote   # apply migrations to remote D1
npm run db:generate         # generate a forward migration from schema changes
npm run db:check            # drift gate: schema vs migrations/ must match
```

## Wrangler config & deploy

One file per deploy target; the build bakes whichever config wins (vite `configPath`:
`WRANGLER_CONFIG` env > `wrangler.local.jsonc` > `wrangler.jsonc`).

| File | Tracked? | Purpose |
|---|---|---|
| `wrangler.jsonc` | committed (PLACEHOLDER ids) | standalone + the **Deploy to Cloudflare** one-click default — CF auto-provisions D1/KV/R2 and injects real ids (no real ids in the repo). |
| `wrangler.local.jsonc` | gitignored | your real standalone ids (written by `scripts/setup-cloudflare.js`). |
| `wrangler.saas.jsonc` | gitignored | SaaS-mode deployment config (`APP_MODE=saas`, `SYNC_QUEUE` producer + sync-DLQ consumer, crons, `*-saas` resources). Used for multi-tenant deployments; absent in standalone. |

`wrangler deploy` runs against the built `build/server/wrangler.json`. `scripts/wrangler.mjs`
applies the same config resolution to direct wrangler commands (db:migrate).

## Key Files & Directories

| File/Dir | Purpose |
|---|---|
| `workers/app.ts` | Single-worker entry — Hono mounts the full API in-process + delegates page routes to React Router SSR |
| `server/index.ts` | Hono API entry point and route configuration |
| `server/api/` | API route handlers (Auth, Inspections, Bookings, etc.) |
| `server/lib/db/` | Drizzle ORM schema (`server/lib/db/schema`) and database utilities |
| `server/lib/middleware/` | Hono middleware (Authentication, RBAC, etc.) |
| `server/lib/validations/` | Zod schemas per module |
| `server/services/` | Business logic, DB queries (Drizzle) |
| `migrations/` | D1 migration SQL (drizzle-kit schema-first: `0000_baseline.sql` + forward) |
| `tests/` | API unit + integration + E2E tests |
| `app/routes/` | React Router v7 route files |
| `app/components/` | React components |
| `app/hooks/` | React hooks (useInspection, useFindings, useKeyboard, etc.) |
| `app/lib/` | API client (hono/client over the in-process binding), session management, helpers |
| `app/styles/tailwind.css` | Design System 0523 token layer (Tailwind v4) |
| `public/` | Static assets (fonts, logo, service worker, widget) |
| `tests/web/` | Web E2E + unit tests |
| `packages/shared-ui/src/` | shared React components (Button, Pill, Card, etc.) |
| `packages/api-types/` | CoreApiType re-export for hono/client |

## Core Architecture

### Single-Worker Architecture
OpenInspection runs as ONE Cloudflare Worker (cloudflare/react-router-hono-fullstack-template shape):

- **`workers/app.ts`** — a Hono app is the worker entry. It mounts the full API (`server/`) for API-owned paths and delegates everything else to the React Router v7 SSR handler. It injects an **in-process `API_WORKER` self-binding** so React Router loaders/actions call the API app DIRECTLY (no network hop, no second worker, no Service Binding).
- **`server/`** — Hono + Drizzle + D1. All business logic, authentication, and data access. Typed JSON API.
- **`app/`** — React Router v7 + React 18 + Tailwind v4. Server-side renders the React UI on the edge.
- **`packages/shared-ui/`** — Design System 0523 token-based React components.
- **`packages/api-types/`** — Re-exports the Hono app type so `hono/client` gets full end-to-end type safety.

**Token Relay BFF** pattern: the React Router v7 server holds the JWT cookie and forwards it to the in-process API on every request, so the browser never sees the token.

### Authentication
- JWT-based authentication (ES256 / ECDSA P-256, HttpOnly cookie `__Host-inspector_token`). Multi-version keyring with `kid` header support for safe rotation — see `server/lib/jwt-keyring.ts`.
- Supports both Cookie (for dashboard) and Bearer Header (for API) token delivery.
- PBKDF2-SHA256 password hashing (100k iterations, 16-byte salt). Legacy SHA-256 hashes auto-rehashed on login.
- **SaaS login is portal-only.** When `APP_MODE=saas` (regardless of topology, after silo-deconvergence 2026-05-29), `GET /login` and `GET /forgot-password` 302 to `${PORTAL_API_URL}/login` (resp. `/forgot-password`), and `POST /api/auth/login` returns HTTP 410 `LOGIN_MOVED_TO_PORTAL`. Reason: SaaS deploys have a single core D1 holding users for many tenants and `users.email` is unique per-`(tenant_id, email)` (composite unique index in `schema/tenant.ts`), so a local form cannot disambiguate which tenant the user means. Entry into core in saas mode is exclusively via portal's `POST /api/account/handoff` → `GET /sso?code=` flow. Standalone deploys are unchanged — the local form still works because the single-tenant mapping is unambiguous.
- **Switch workspace UI.** `MainLayout` renders a "Switch workspace" entry in the sidebar (desktop bottom section + mobile drawer) whenever `branding.isSaas` is true and `PORTAL_API_URL` is set. The link points at `${PORTAL_API_URL}/workspace/switch`. Because the JWT carries a single `custom:tenantId`, this portal bounce is the only correct way to swap tenants without losing the session — portal will SSO us back here with the new tenant's cookie (which overwrites the old one).

### Standalone Engine (Single-Tenant)
- Optimized for single-tenant deployments (Private Instances).
- Resolves configuration via a fixed `SINGLE_TENANT_ID`.
- Stable API surface designed to be extended by SaaS overlay branches (e.g., `saas` branch).

### Inspection Engine
- JSON-schema based inspection templates (`server/types/template-schema.ts`, single canonical v2 — see `server/lib/validations/template.schema.ts`).
- 9 item types: `rich` (rating + 3 canned-comment tabs) plus `boolean / text / textarea / number / select / multi_select / date / photo_only` for non-rated data points. Inspection side stores rating on `result.rating` and non-rich values on `result.value`.
- Spectora import path: `POST /api/inspections/templates/import-spectora` accepts a raw Spectora export + a name, runs `lib/spectora-import.ts` (4-bucket → 3-tab mapping, identifier preservation via `source`), creates a template in one shot. UI entry point: "Import Spectora" button on `/templates`.
- Support for field results, e-signatures, and report generation.
- Integrated public booking system with Turnstile bot protection. Entry point is company-level (`/book/:tenant`); bookings auto-assign the first available qualified inspector. Admins can optionally enable an inspector-choice dropdown (Settings → Online Booking → Booking policies). Legacy per-inspector deep links (`/book/:tenant/:slug`) redirect 302 to the company page with that inspector pre-selected.

## Frontend Architecture

- **Framework**: React Router v7 on Cloudflare Workers with Vite.
- **Rendering**: Full SSR — React Router v7 server renders on the edge, hydrates on the client.
- **Styling**: Tailwind CSS v4 with Design System 0523 tokens (`app/styles/tailwind.css`). Tailwind is v4-only (via `@tailwindcss/vite`); there is no separate server-side CSS build.
- **API calls**: `hono/client` with end-to-end type safety via `packages/api-types/`. The React Router v7 loader/action functions call the in-process API through the injected `API_WORKER` binding (`createApi(context)` in `app/lib/api-client.server.ts`) — no network hop.
- **State management**: React hooks — `useInspection` (~900 LOC), `useFindings`, `useKeyboard`, `useCannedComments`, `useOfflineQueue`, `usePresence`, `useTheme`, `useUnsavedChanges`.
- **Component library**: `packages/shared-ui/` provides 13 design-system components (Button, Pill, Card, Input, Modal, Icon, EmptyState, Eyebrow, FileDropzone, PageHeader, Pagination, Skeleton, TabStrip) consumed by the frontend.
- **Dark mode**: `data-color-scheme` attribute on `<html>`, managed by `useTheme` hook (auto/light/dark).
- **Offline**: Service Worker + `useOfflineQueue` hook for photo upload queue and field sync.

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
| `TERMS_URL` | No | Optional URL of the operator's Terms of Service. When set (with or without `PRIVACY_URL`), account-creating public forms require an acceptance checkbox and stamp an acceptance record on the user row. |
| `PRIVACY_URL` | No | Optional URL of the operator's Privacy Policy. When set, public pages render a privacy-notice footer link. |
| `RESEND_API_KEY`| No | Platform-default email delivery (Resend). Tenants may switch to their OWN Resend key + verified sender via Settings → Communication (per-tenant override; the email pipeline resolves own-vs-platform explicitly). |
| `GEMINI_API_KEY`| No | DEPRECATED as a platform key — AI assistance is strictly bring-your-own-key: `AIService` reads the tenant's own stored key (Settings → Advanced) and ignores this env. AI features stay off until a tenant configures a key. |
| `APP_MODE` | No | `standalone` (default) or `saas` — controls tenant resolution |
| `APP_NAME` | No | Custom branding name |
| `PRIMARY_COLOR` | No | Custom branding color |
| `SINGLE_TENANT_ID` | No | Fixed tenant ID for standalone mode |
| `SETUP_CODE` | No | Verification code for first-time setup |
| `PORTAL_API_URL` | No | Portal URL for browser redirects (login bounce, billing, workspace switch) |
| `SYNC_QUEUE` | No | Cloudflare Queue producer binding for the SaaS user-sync seam (SaaS only; absent in standalone). The outbox publishes CloudEvents envelopes here; a cron sweeper republishes stragglers; this worker also consumes the matching DLQ to mark failed rows. The same queue carries command REPLIES (`reply.tenant.updated`) emitted by the cmd consumer. (The former `PORTAL_SERVICE` Service Binding was RETIRED 2026-06-04 — core holds no binding to portal; inbound M2M is guarded by the `x-portal-m2m` HMAC.) Inbound portal→core commands arrive on a separate queue this worker consumes (`server/portal/cmd-consumer.ts`): dedup (`processed_cmd_events`) → per-tenant stale guard (`tenants.applied_cmd_seq`) + credential-stream guard (`tenants.applied_cred_seq`) → apply → optional reply; unknown types park (`parked_cmd_events`). |
| `STRIPE_SECRET_KEY` | No | Stripe Connect (each tenant's OWN account; the platform never collects payments). Resolution is tenant-DB-preferred: a tenant's stored key always beats this env, so a platform-level binding can never hijack tenant payments. |
| `STRIPE_WEBHOOK_SECRET` | No | Stripe webhook HMAC verification |
| `GOOGLE_PLACES_API_KEY` | No | Google Places API key powering address autocomplete on the dashboard new-inspection wizard and the public `/book` page (proxied via `/api/places/*` and `/public/geocode`). When unset, both endpoints return `{ data: [], reason: 'NO_API_KEY' }` and the address inputs degrade gracefully to plain text — the customer can still type a free-form address and submit. |
| `ESTATED_API_KEY` | No | Estated.io public-records key for the `POST /api/inspections/:id/property-facts/autofill` endpoint. Resolves year built / sqft / foundation / lot size / bedrooms / bathrooms by address. When unset, the endpoint returns `{ data: null, reason: 'NO_API_KEY' }` and the Property Facts card displays a polite "auto-fill not configured" hint while still accepting manual entry. Same graceful-degrade pattern as `GOOGLE_PLACES_API_KEY`. |

---

- **API Framework**: [Hono](https://hono.dev/) with Zod OpenAPI.
- **Frontend Framework**: [React Router v7](https://reactrouter.com/) + React 18.
- **ORM**: [Drizzle ORM](https://orm.drizzle.team/) with D1.
- **CSS**: [Tailwind CSS v4](https://tailwindcss.com/) with Design System 0523 tokens.
- **Testing**: Vitest for unit tests; Playwright for E2E.

## JWT & Auth Security Rules

These rules are **mandatory** for any code that touches authentication. Violations reintroduce critical vulnerabilities.

- **ES256 keyring**: All JWT signing and verification MUST go through `server/lib/jwt-keyring.ts`. Direct `sign()` / `verify()` calls from `hono/jwt` are FORBIDDEN — the keyring pins the algorithm to ES256 (ECDSA P-256 SHA-256), stamps the `kid` header, and enforces multi-version verification. Per-request keyrings are pre-built in `diMiddleware` and exposed as `await c.var.keyringPromise`.
- **kid required**: Every JWT MUST carry a `kid` header. `signJwt()` sets it from `JWT_CURRENT_KID`; `verifyJwt()` rejects tokens with no kid, or with a kid that is not in the keyring.
- **iat claim**: `signJwt()` auto-injects `iat: Math.floor(Date.now() / 1000)` when the caller omits it. Without `iat`, KV session invalidation (`pwchanged:{userId}`) cannot work.
- **No HS256 fallback**: There is NO legacy HS256 path. Pre-launch architectural choice — see rotation scripts and docs. The remaining `JWT_SECRET` env binding is now used only as KDF input for `config-crypto`, `qbo-crypto`, and audit signing-key encryption — never for JWT signing.
- **Key rotation flow**: To rotate, provision `JWT_PRIVATE_KEY_V<N+1>` + `JWT_PUBLIC_KEY_V<N+1>` first (verify-only window), then flip `JWT_CURRENT_KID` to the new version. Old tokens remain verifiable until V<N> is retired.
- **Token NOT in response body**: Login, setup, and join endpoints MUST NOT return the JWT in the JSON response. Tokens are delivered exclusively via `Set-Cookie` (HttpOnly).
- **Cookie name**: Always use `__Host-inspector_token` (enforces `Secure`, `Path=/`, no `Domain`).
- **setCookie attributes**: Every `setCookie()` MUST include `httpOnly: true, secure: true, sameSite: 'Strict', path: '/'`.
- **deleteCookie secure**: Every `deleteCookie()` MUST include `{ path: '/', secure: true }`. Omitting `secure` on `__Host-` cookies throws a runtime exception.
- **No localStorage tokens**: Frontend JS MUST NOT store tokens in `localStorage` or `document.cookie`. Same-origin `fetch()` sends the HttpOnly cookie automatically.
- **KV invalidation**: On password change/reset/delete, write `pwchanged:{userId}` to KV. Auth middleware rejects tokens with `iat < changedAt`.
- **D1 date safety**: Always use `safeISODate()` / `safeTimestamp()` from `server/lib/date.ts` when serializing DB date values. D1 returns mixed formats (Date, int, string).

## Input Validation Rules

- **Zod required**: Every API endpoint that accepts user input (body, query, params) MUST validate using a Zod schema. No manual `if (!field)` or TypeScript generics-only validation.
- **OpenAPIHono routes**: Use `createRoute()` with `request.body/query/params` schemas and access validated data via `c.req.valid('json')`, `c.req.valid('query')`, `c.req.valid('param')`.
- **Non-OpenAPIHono routes**: Use `schema.safeParse(await c.req.json())` and return 400 on failure. This applies to workaround routes that cannot use `createRoute()`.
- **Schema location**: All Zod schemas live in `server/lib/validations/*.schema.ts`. Do not define schemas inline in route handlers.
- **No raw c.req.json()**: Never use `c.req.json<T>()` with only TypeScript generics — generics provide zero runtime protection.

## Language Rules

- **English only**: All source code, comments, documentation, commit messages, and user-facing strings in this project MUST be written in English. No Chinese or other non-English text is permitted.

## Structured Logging Rules

- **No raw console**: Server-side code MUST use `import { logger } from '../lib/logger'` instead of `console.log/error/warn/info`. The `Logger` class outputs structured JSON for log aggregators.
- **Exception**: Client-side JS inside `<script>` tags or inline template scripts (runs in browser) MAY use `console.*`.
- **Exception**: `server/lib/logger.ts` itself uses `console.info` internally — that is correct and must not be changed.
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

## Schema Rules

DB design policies (2026-06-04 DBA review). These apply to ALL new tables/columns; legacy columns converge opportunistically when a table is already being touched — no big-bang migrations.

- **Timestamps**: new columns MUST be `integer(..., { mode: 'timestamp_ms' })` (epoch milliseconds). Calendar-semantic fields with no time component (e.g. `due_date`) MAY be `YYYY-MM-DD` TEXT but must say so in a comment. Never introduce new raw `integer` or text-datetime timestamp columns.
- **Foreign keys**: referential integrity is enforced at the APPLICATION layer (ScopedDB + tenant filters), not the database. New tables MUST NOT declare `.references()` — D1 cannot rebuild a table that is referenced by an FK (no `PRAGMA foreign_keys=OFF` outside a transaction), so every FK is a permanent migration liability. Existing FKs are frozen as legacy; do not extend them. Delete-ordering in purge/cascade paths is the service layer's responsibility.
- **Naming**: money columns end in `_cents` (integer cents, never floats); encrypted-at-rest columns end in `_enc`; booleans always use `integer(..., { mode: 'boolean' })` (never raw 0/1); index names are prefixed `idx_`.
- **Money authority chain**: when an invoice exists it is authoritative; otherwise the sum of `inspection_services` price snapshots; `inspections.price` is a denormalized cache only — never reconcile the other way.
- **Status fields**: any column that models a state machine MUST declare a drizzle `{ enum: [...] }` (type-layer only, no DDL cost).
- **Column retirement**: D1 cannot drop columns on FK-referenced tables. Retired columns are FROZEN: stop all reads/writes, add a `-- DEAD (date, reason)` schema comment, never reuse the name.

## Product Terminology (canonical)

User-facing copy and NEW code identifiers use these terms. (Existing surfaces are renamed in a dedicated terminology pass — don't mix renames into feature work.)

| Use | Not |
|---|---|
| **Inspection** | Order, Job |
| **Company** (name/branding settings) | Workspace (user-facing) |
| **Repair Items** | Recommendations (user-facing) |
| **Canned Comment** (library entry) | "Comment" unqualified — distinguish from per-inspection **Notes** (inspector free text) |
| **Client** / **Agent** (contact types) | Customer |
