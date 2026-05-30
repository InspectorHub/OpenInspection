# Deploying OpenInspection

This guide covers self-hosted production deploys — what every adopter does to run the engine for their own inspection business.

---

## Architecture overview

OpenInspection deploys as two independent Cloudflare Workers:

- **API Worker** (`api/`) — Hono + Drizzle + D1. All business logic, auth, and data.
- **Frontend Worker** (`frontend/`) — React Router v7 + React 18 + Tailwind v4. SSR on Workers. Calls the API Worker via Service Binding (zero-latency, no network hop).

Both must be deployed for a complete installation.

---

## Self-hosted production deploy

The recommended path is the one-click button in the README:

```
[Deploy to Cloudflare] → fork → run `npm run setup:cloudflare`
```

For the manual flow, see [`docs/developers/06_deployment.md`](./developers/06_deployment.md).

### Required Cloudflare resources

| Resource         | Binding         | Purpose                                                    |
|------------------|-----------------|------------------------------------------------------------|
| Workers          | (two workers)   | API Worker + Frontend Worker.                              |
| D1 database      | `DB`            | All structured data (inspections, users, comments, ...).   |
| R2 bucket        | `PHOTOS`        | Field-form photo uploads.                                  |
| R2 bucket        | `REPORTS`       | Pre-rendered Summary + Full Report PDFs (Spec 5A).         |
| KV namespace     | `TENANT_CACHE`  | Branding + tenant-config 1-hour cache.                     |
| Browser binding  | `BROWSER`       | PDF rendering for reports + e-sign certificates.           |
| Workflow         | `SIGN_COMPLETION_WORKFLOW` | Async e-sign pipeline (Spec 5H).                           |
| Service Binding  | `API_WORKER`    | Frontend Worker → API Worker (zero-latency RPC).           |

`npm run setup:cloudflare` provisions every binding listed above and writes their IDs back into your local `wrangler.toml`. Re-run with `--refresh-setup-code` to mint a new first-run setup code if you misplace yours.

### Minimum secrets

| Secret            | When required                                       |
|-------------------|-----------------------------------------------------|
| `JWT_SECRET`      | Always — must be >= 32 random characters.            |
| `RESEND_API_KEY`  | Optional, only if you want outbound email.          |
| `SENDER_EMAIL`    | Required when `RESEND_API_KEY` is set.              |
| `GEMINI_API_KEY`  | Optional — enables AI comment-assist.               |
| `TURNSTILE_SECRET_KEY` | Optional but recommended for the public booking page. |

Set them via `wrangler secret put SECRET_NAME` or through the Cloudflare dashboard.

### Deploy API Worker

```bash
npm run deploy:api
# Applies remote D1 migrations, rebuilds Tailwind CSS, and ships the API
# Worker via the standalone wrangler config (the default env). For SaaS:
# npm run deploy:api:saas
```

After the API Worker boots, visit `https://<your-worker>.workers.dev/setup` and enter the 6-digit setup code. **The code itself is not printed in logs** — recover it with one of:

- **Recommended**: set `SETUP_CODE=<any 6-digit value>` as a Worker secret before deploying (`wrangler secret put SETUP_CODE`) and use that value at `/setup`.
- Or read the auto-generated code from KV: `wrangler kv key get setup_verification_code --binding TENANT_CACHE` (1-hour TTL). Re-run `npm run setup:cloudflare -- --refresh-setup-code` to mint a fresh one if it expires.

That bootstraps your first admin account.

### Deploy Frontend Worker

```bash
cp frontend/wrangler.toml.example frontend/wrangler.toml   # edit API_URL + SESSION_SECRET
npm install
npm run deploy:web                                          # web only
# or `npm run deploy` to deploy api + web together
```

The Worker entry at `frontend/workers/app.ts` calls `createRequestHandler` with `import("virtual:react-router/server-build")` and passes `{ cloudflare: { env, ctx } }` as the React Router `AppLoadContext`. `@cloudflare/vite-plugin` integrates the React Router SSR build with wrangler, so the standard `wrangler deploy` pipeline works without a custom script.

The Service Binding to the API Worker (`API_WORKER`, see table above) is declared in `frontend/wrangler.toml`. Ensure the API Worker is deployed first so the binding resolves at deploy time.

### Deploy order

1. Deploy the **API Worker** first (`npm run deploy:api` from root)
2. Deploy the **Frontend Worker** second (`npm run deploy:web` from root)
3. Point your domain's DNS to the Frontend Worker (it is the public-facing entry point)

Or run `npm run deploy` to do both in order in a single command.

### Local development

For local dev, both workers run independently:

```bash
# Terminal 1: API Worker (port 8788)
npm run dev

# Terminal 2: Frontend Worker (port 5173, proxies API calls to 8788)
cd frontend
npm run dev
```

The frontend dev server automatically proxies API requests to the API Worker running on port 8788.
