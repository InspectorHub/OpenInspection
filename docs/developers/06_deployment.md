---
domain: "Standalone Deployment & Open Source"
related_code_paths: ["apps/core/", "apps/core/wrangler.toml", "apps/core/.dev.vars.example"]
---

# 04. Standalone Deployment Architecture

`apps/core` (published as **OpenInspection**) is a fully self-contained Cloudflare Worker. It has no dependency on `apps/portal` at runtime — the only shared value is `JWT_SECRET`, which standalone users set themselves to sign their own tokens.

## Decoupling: Core from SaaS

- Core never calls portal APIs
- Core has its own Stripe integration for pay-to-unlock reports; when a tenant has a `stripeConnectAccountId` the checkout routes through their Connect Express account with a 10% platform fee
- Core has no tenant registration logic (handled by portal or the first-run setup wizard)
- Subdomain routing in `src/lib/middleware/tenant-router.ts` defaults to `'dev'` in local development.
- **Apex Mode**: Setting `SINGLE_TENANT_ID` enables single-tenant self-hosting on a primary domain, bypassing subdomain routing entirely.

## Implemented: Deployment Steps

```bash
# 1. Clone the repo (or apps/core standalone)
git clone <repo> && cd apps/core

# 2. Install dependencies
npm install

# 3. Log in to Cloudflare
npx wrangler login

# 4. Create the D1 database — copy printed database_id into wrangler.toml
npx wrangler d1 create openinspection-db

# 5. Create the R2 bucket for photos
npx wrangler r2 bucket create openinspection-photos

# 6. Apply schema migrations
npm run db:migrate

# 7. Configure secrets
cp .dev.vars.example .dev.vars
# Edit .dev.vars: JWT_SECRET, RESEND_API_KEY, SENDER_EMAIL, GEMINI_API_KEY

# 8. Deploy
npm run deploy
```

## Required Secrets

| Secret | Required | Purpose |
|---|---|---|
| `JWT_SECRET` | Yes | Signs and verifies JWTs. Use any long random string. |
| `RESEND_API_KEY` | No | Sends report delivery + booking confirmation emails. Skipped if absent. |
| `SENDER_EMAIL` | No | From address, e.g. `Reports <reports@yourdomain.com>` |
| `GEMINI_API_KEY` | No | AI comment assist — disabled if omitted |
| `STRIPE_SECRET_KEY` | No | Real Stripe checkout on reports. Falls back to mock if absent. |
| `STRIPE_WEBHOOK_SECRET` | No | Verifies Stripe webhook HMAC signature. |
| `TURNSTILE_SECRET_KEY` | **Yes** | Server-side Cloudflare Turnstile verification on `POST /api/book`. Booking requests are rejected with 403 if this secret is absent or the token is invalid. Use Cloudflare's test secret (`1x0000000000000000000000000000000AA`) for local dev. |
| `GOOGLE_CLIENT_ID` | No | Google Calendar OAuth — allows inspectors to sync availability from Google Calendar. |
| `GOOGLE_CLIENT_SECRET` | No | Google Calendar OAuth client secret. |
| `CF_ACCOUNT_ID` | No | Cloudflare account ID — required for silo mode (per-tenant isolated D1). |
| `CF_API_TOKEN` | No | Cloudflare API token with D1:Edit permission — required for silo mode. |
| `SINGLE_TENANT_ID` | No | Enables **Apex Mode**. Bypass subdomain routing for single-tenant installs. |
| `APP_NAME` | No | Global site name default. |
| `GA_MEASUREMENT_ID` | No | Google Analytics 4 Measurement ID. |

`TURNSTILE_SITE_KEY` is a non-secret var — set it in `wrangler.toml` under `[vars]`.

> **Turnstile is required in production.** When `TURNSTILE_SECRET_KEY` is set, `POST /api/book` enforces the token — requests without a valid token are rejected. For local dev, use Cloudflare's always-pass test keys: site key `1x00000000000000000000AA`, secret key `1x0000000000000000000000000000000AA`.

Set for production:
```bash
npx wrangler secret put JWT_SECRET
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put SENDER_EMAIL
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put TURNSTILE_SECRET_KEY
# Optional — Google Calendar integration
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
# Optional — silo mode (per-tenant isolated D1)
npx wrangler secret put CF_ACCOUNT_ID
npx wrangler secret put CF_API_TOKEN
```

## Single-Inspector vs Multi-Inspector

Standalone deployments support multiple inspectors via the same `users` table. The admin creates team members via the dashboard. The `requireRole()` RBAC middleware enforces who can create/modify inspections.

## Implemented

| Feature | Status |
|---|---|
| "Deploy to Cloudflare Workers" one-click button | Implemented — badge in `apps/core/README.md` |
| First-run setup wizard (`GET/POST /setup`) | Implemented — auto-redirects on empty DB; SHA-256 password hashing via Web Crypto |
| Data export (`GET /api/admin/export`) | Implemented — exports inspections, results, templates, agreements as JSON |

## Screenshots

### First-Run Setup Wizard

![Setup Wizard](screenshots/core-setup.png)

### Login Page

![Login](screenshots/core-login.png)

See [`docs/screenshots.md`](../screenshots.md) for the full UI screenshot index.
