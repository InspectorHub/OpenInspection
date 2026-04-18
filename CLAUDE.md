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
- JWT-based authentication system.
- Supports both Cookie (for dashboard) and Bearer Header (for API) token delivery.
- Standalone-first password hashing using SHA-256 (Web Crypto API).

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
| `TURNSTILE_SECRET_KEY` | **Yes** | Server-side Turnstile verification — `POST /api/book` enforces this. Use test secret `1x0000000000000000000000000000000AA` for local dev. |
| `APP_BASE_URL` | No | Public URL for OAuth and link generation |
| `RESEND_API_KEY`| No | Email delivery (via Resend.com) |
| `GEMINI_API_KEY`| No | AI-powered inspection assistance |

---

- **Framework**: [Hono](https://hono.dev/) with Zod OpenAPI.
- **ORM**: [Drizzle ORM](https://orm.drizzle.team/) with D1.
- **CSS**: [Tailwind CSS](https://tailwindcss.com/).
- **Testing**: Vitest for unit tests; Playwright for E2E.

## Multi-tenant Security Rules

- **Mandatory tenantId**: Every new database table MUST include `tenantId: text('tenant_id').notNull()` to ensure physical isolation.
- **Fail-Closed Access**: Use `this.sdb` (`ScopedDB`) for all database operations to automatically inject tenant filters.
- **Query Hardening**: If using raw `db`, you MUST explicitly append `eq(table.tenantId, tenantId)` to every `where` clause.
- **Schema Validation**: All input schemas (`CreateXSchema`) must ensure `tenantId` is handled via context, never accepted directly from end-user input.
