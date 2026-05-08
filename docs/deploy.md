# Deploying OpenInspection

This guide covers two deployment shapes:

1. **Self-hosted production** — what every adopter does to run the engine for their own inspection business.
2. **Public sandbox demo** (`sandbox.inspectorhub.io`) — what the InspectorHub team runs to let prospects try the product without signing up.

If you only want to run OpenInspection for yourself, follow §1 and skip §2.

---

## 1. Self-hosted production deploy

The recommended path is the one-click button in the README:

```
[Deploy to Cloudflare] → fork → run `npm run setup:cloudflare`
```

For the manual flow, see [`docs/developers/06_deployment.md`](./developers/06_deployment.md).

### Required Cloudflare resources

| Resource         | Binding         | Purpose                                                    |
|------------------|-----------------|------------------------------------------------------------|
| Workers          | (the worker)    | The engine itself.                                         |
| D1 database      | `DB`            | All structured data (inspections, users, comments, …).     |
| R2 bucket        | `PHOTOS`        | Field-form photo uploads.                                  |
| R2 bucket        | `REPORTS`       | Pre-rendered Summary + Full Report PDFs (Spec 5A).         |
| KV namespace     | `TENANT_CACHE`  | Branding + tenant-config 1-hour cache.                     |
| Browser binding  | `BROWSER`       | PDF rendering for reports + e-sign certificates.           |
| Workflow         | `SIGN_COMPLETION_WORKFLOW` | Async e-sign pipeline (Spec 5H).                           |

`npm run setup:cloudflare` provisions every binding listed above and writes their IDs back into your local `wrangler.toml`. Re-run with `--refresh-setup-code` to mint a new first-run setup code if you misplace yours.

### Minimum secrets

| Secret            | When required                                       |
|-------------------|-----------------------------------------------------|
| `JWT_SECRET`      | Always — must be ≥ 32 random characters.            |
| `RESEND_API_KEY`  | Optional, only if you want outbound email.          |
| `SENDER_EMAIL`    | Required when `RESEND_API_KEY` is set.              |
| `GEMINI_API_KEY`  | Optional — enables AI comment-assist.               |
| `TURNSTILE_SECRET_KEY` | Optional but recommended for the public booking page. |

Set them via `wrangler secret put SECRET_NAME` or through the Cloudflare dashboard.

### Deploy + post-deploy

```bash
npm run deploy
# applies remote D1 migrations, rebuilds Tailwind, and ships the worker
```

After the worker boots, visit `https://<your-worker>.workers.dev/setup` and enter the 6-digit setup code printed in the deploy log. That bootstraps your first admin account.

---

## 2. Public sandbox demo (`sandbox.inspectorhub.io`)

The sandbox is a separate Cloudflare Worker bound to `sandbox.inspectorhub.io`. It runs the same code as production with two differences:

- The `SANDBOX_MODE` env var is `"true"`. Every authenticated page renders the indigo `SandboxBanner` warning visitors that data resets nightly.
- A nightly Cron Trigger (`0 3 * * *` UTC) wipes the demo tenant and reseeds it via `scripts/sandbox-seed.js`.

### Why a separate worker?

Keeping the sandbox isolated means we can:

- Wipe + reseed without touching production data.
- Pin demo URLs (`sandbox.inspectorhub.io/dashboard`) for marketing screenshots without worrying about live customers.
- Test new releases in a real browser before promoting them to production.

### One-time setup

```bash
# 1. Provision a separate D1 + R2 + KV under env=sandbox.
#    (The wrangler.toml [env.sandbox] block already declares the bindings.)
npx wrangler d1 create openinspection-sandbox-db
npx wrangler kv namespace create TENANT_CACHE_SANDBOX
npx wrangler r2 bucket create openinspection-sandbox-photos
npx wrangler r2 bucket create openinspection-sandbox-reports

# 2. Patch the IDs into wrangler.toml under [env.sandbox] (D1 database_id,
#    KV namespace id, R2 bucket names). Or run the setup script:
node scripts/setup-cloudflare.js --env=sandbox

# 3. Push the JWT_SECRET (separate from production!).
echo "<32+ random chars>" | npx wrangler secret put JWT_SECRET --env=sandbox

# 4. Deploy the sandbox worker for the first time.
npx wrangler deploy --env=sandbox

# 5. Bind the public hostname (one-time DNS step):
#    Cloudflare dashboard → Workers & Pages → openinspection-sandbox →
#    Settings → Triggers → Custom Domains → add sandbox.inspectorhub.io
```

### Seeding the demo data

Run once to populate fixtures, then again whenever you want to reset:

```bash
npm run seed:sandbox:remote
```

The script (`scripts/sandbox-seed.js`):

- Creates / refreshes the `Demo Inspections` tenant (`id: 5b0d0e5c-…`).
- Recreates the `demo@openinspection.dev` admin user with password `demo1234`.
- Loads 3 stub templates (Standard Residential, Pre-Listing, Sewer Scope).
- Loads 5 inspections covering the full lifecycle — published with rich data, in-progress, two upcoming, one needing attention.
- Imports the 248-comment canned library by parsing `seed-comments.js` (so it stays in lockstep with production).

The seed is idempotent: every entity uses `INSERT OR REPLACE`, so re-running on a half-modified database produces the documented state.

### Nightly reset (Cron Trigger)

The sandbox worker re-uses `wrangler.toml`'s top-level cron triggers. To run the seed nightly without manual intervention, schedule a small Cloudflare Worker cron handler that posts to a private maintenance route, or run `npm run seed:sandbox:remote` on a CI cron (GitHub Actions schedule, Cloudflare Cron with `wrangler trigger`, or any always-on box). The simplest reliable option:

```yaml
# .github/workflows/sandbox-reset.yml (CI cron — preferred)
name: Sandbox nightly reset
on:
  schedule:
    - cron: "0 3 * * *"   # 03:00 UTC, daily
  workflow_dispatch:
jobs:
  reset:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { submodules: true }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm, cache-dependency-path: apps/core/package-lock.json }
      - run: npm ci
        working-directory: apps/core
      - run: npm run seed:sandbox:remote
        working-directory: apps/core
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

### Operating the sandbox

| Task                                  | Command                                       |
|---------------------------------------|-----------------------------------------------|
| Deploy a new sandbox build            | `npx wrangler deploy --env=sandbox`           |
| Tail sandbox logs                     | `npx wrangler tail --env=sandbox`             |
| Seed locally before promoting         | `npm run seed:sandbox`                        |
| Reset demo data immediately           | `npm run seed:sandbox:remote`                 |
| Disable the sandbox banner (rare)     | Set `SANDBOX_MODE = ""` under `[env.sandbox.vars]` and redeploy. |

### Sandbox login

Every sandbox build exposes the same demo credentials:

- URL: `https://sandbox.inspectorhub.io/login`
- Email: `demo@openinspection.dev`
- Password: `demo1234`

The credentials are intentionally weak — sandbox traffic must never include real customer data.

### Privacy + legal

The `SandboxBanner` component (visible on every authenticated page) explicitly tells visitors:

- They are using a public demo.
- Data resets every night at 03:00 UTC.
- They must not enter real customer information.

Production deployments must keep `SANDBOX_MODE` unset — leaving the banner on a live business install is misleading.
