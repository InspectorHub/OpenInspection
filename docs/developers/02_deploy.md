# Deploying OpenInspection

This guide covers self-hosted production deploys — what every adopter does to run the engine for their own inspection business.

---

## Architecture overview

OpenInspection deploys as a single Cloudflare Worker (the cloudflare/react-router-hono-fullstack-template shape):

- **`workers/app.ts`** — a Hono entry that mounts the full API (`server/`, Hono + Drizzle + D1) in-process for API-owned paths and delegates all other (page) routes to React Router v7 SSR (`app/`, React 18 + Tailwind v4).
- React Router loaders/actions call the API DIRECTLY through an injected in-process `API_WORKER` self-binding — no network hop, no second worker, no Service Binding between workers.

One deployable; `npm run deploy` builds and ships it.

---

## Self-hosted production deploy

The recommended path is the one-click button in the README:

```
[Deploy to Cloudflare] → fork → run `npm run setup:cloudflare`
```

For the manual flow, see the **Quick start** section in the [README](../../README.md).

### Required Cloudflare resources

| Resource         | Binding         | Purpose                                                    |
|------------------|-----------------|------------------------------------------------------------|
| Worker           | (one worker)    | Single Worker (API in-process + React Router SSR).        |
| D1 database      | `DB`            | All structured data (inspections, users, comments, ...).   |
| R2 bucket        | `PHOTOS`        | All object storage — field-form photos, pre-rendered report/certificate PDFs, and e-sign evidence packs. |
| KV namespace     | `TENANT_CACHE`  | Branding + tenant-config 1-hour cache.                     |
| Browser binding  | `BROWSER`       | PDF rendering for reports + e-sign certificates.           |
| Workflow         | `SIGN_COMPLETION_WORKFLOW` | Async e-sign pipeline (Spec 5H).                           |
| Durable Objects  | `INSPECTION_PRESENCE`, `TENANT_PRESENCE` | Live presence for the editor.               |

`npm run setup:cloudflare` provisions every binding listed above and writes their real IDs into a gitignored `wrangler.local.jsonc` (bootstrapped from the committed placeholder `wrangler.jsonc`).

### Minimum secrets

| Secret            | When required                                       |
|-------------------|-----------------------------------------------------|
| `JWT_SECRET`      | Always — must be >= 32 random characters.            |
| `SETUP_CODE`      | First-run setup only — any value >= 6 characters; gates `/setup` (fail-closed if unset). |
| `RESEND_API_KEY`  | Optional, only if you want outbound email.          |
| `SENDER_EMAIL`    | Required when `RESEND_API_KEY` is set.              |
| `GEMINI_API_KEY`  | Optional — enables AI comment-assist.               |
| `TURNSTILE_SECRET_KEY` | Optional but recommended for the public booking page. |

Set them via `wrangler secret put SECRET_NAME` or through the Cloudflare dashboard.

### Deploy the Worker

```bash
npm install
npm run setup:cloudflare   # provisions D1/KV/R2 + writes real IDs to wrangler.local.jsonc
npm run deploy             # build + wrangler deploy (uses wrangler.local.jsonc)
```

`npm run deploy` runs `react-router build` (bundling `server/` API + `app/` SSR into one worker) then `wrangler deploy` against the built `build/server/wrangler.json`, and finally `jwt:ensure` + `setup-code:ensure` (provision missing secrets). The build bakes whichever wrangler config wins (`WRANGLER_CONFIG` env > `wrangler.local.jsonc` > committed `wrangler.jsonc`). Apply remote D1 migrations with `npm run db:migrate:remote`.

> **One-click**: the committed `wrangler.jsonc` carries placeholder IDs; the README's *Deploy to Cloudflare* button provisions resources and injects real IDs automatically — no manual `setup:cloudflare` needed for that path.

### First-run setup code

First-run `/setup` is gated **solely** on the `SETUP_CODE` secret — the server reads `c.env.SETUP_CODE` and refuses to proceed when it is unset, so an unprotected Worker can't be claimed. It is any value >= 6 characters (compared for exact equality — no digit/charset constraint). You get one of two ways depending on how you deployed:

- **CLI** (`npm run deploy`): the final `setup-code:ensure` step (`scripts/ensure-setup-code.mjs`) generates a random `SETUP_CODE` and **prints it in the deploy output** — but only when the secret is MISSING. It never overwrites an existing value, so re-deploys keep your code. Provide your own first with `wrangler secret put SETUP_CODE` if you prefer.
- **One-click**: the wizard reads `.dev.vars.example` and surfaces `SETUP_CODE` as a secret field you fill in during deploy.

Then visit `https://<your-worker>.workers.dev/setup` and enter that value to bootstrap your first admin account.

### How the single worker is wired

The Worker entry at `workers/app.ts` is a Hono app. It routes API-owned paths (`/api/*`, `/status`, `/sign/*`, …) to the API app (`server/`) in-process, and sends every other path to React Router via `createRequestHandler` with `import("virtual:react-router/server-build")`, passing `{ cloudflare: { env, ctx } }` as the `AppLoadContext`. Before delegating to SSR it injects an in-process `API_WORKER` self-binding so React Router loaders/actions call the API app directly — no network hop, no second worker. `@cloudflare/vite-plugin` integrates the React Router SSR build with wrangler, so the standard `wrangler deploy` pipeline ships everything.

### Local development

```bash
npm run dev:hmr      # Vite dev server with HMR (react-router dev, port 5173) — fast iteration
npm run dev          # build-based: react-router build + wrangler dev (one worker, port 8788)
```

`npm run dev:hmr` is the everyday loop: instant hot updates for `app/` edits, and `server/` changes load through the worker entry's lazy API import. `npm run dev` is build-based (no HMR) and runs the real bundled worker on workerd — use it to verify production-shape behavior. Apply local D1 migrations first with `npm run db:migrate`. Note for contributors touching `workers/app.ts`: the entry must keep its top-level import graph tiny (the API is dynamically imported) — a static server import breaks the Vite dev runtime's export-type evaluation.

## Data retention & R2 lifecycle

OpenInspection is designed as a long-term evidence archive for inspectors — there is **no automatic deletion** of inspection data. Physical deletion happens only when an operator/integration explicitly purges a tenant (see *Tenant offboarding* below). To keep long-tail storage cheap without losing data, configure an R2 **lifecycle rule** on the `PHOTOS` bucket that transitions objects to the **Infrequent Access** storage class once they age past 365 days. This is a deploy-time/dashboard operation — no application code is involved.

- **Effect**: objects ≥ 365 days old move to Infrequent Access (~⅓ the storage cost). Reads still work transparently (a per-GB retrieval fee applies, latency is unchanged).
- **No expiry rule**: do NOT add a delete/expiry lifecycle action — that would erase evidence. Only the *transition* action is wanted.
- **D1 is untouched**: D1 has no storage classes and the row volume is small, so no lifecycle is needed there.

Configure it once per environment:

```bash
# Dashboard: R2 → PHOTOS bucket → Settings → Object lifecycle rules → Add rule
#   Action: "Transition to Infrequent Access", Age: 365 days, scope: whole bucket.

# Or via Wrangler:
wrangler r2 bucket lifecycle add PHOTOS ia-after-365d \
  --ia-transition-days 365
```

> A hosted/managed deployment runs the same rule on its own `PHOTOS` bucket. Self-hosters who do not want Infrequent Access can simply skip this step — it is a cost optimization, not a correctness requirement.

### Tenant offboarding (export then purge)

When a tenant is offboarded, the platform first builds a **full data export** ZIP (CSV/JSON of inspections, templates and agreements **plus the photo bytes themselves** under `photos/`, size-bounded so large tenants stay within Worker memory limits; any object beyond the budget is listed in `photos-manifest.json` with `included: false`), then purges all tenant rows, R2 objects and KV keys. The purge writes a durable, non-personal **destruction record** (`tenant_destruction_records`: tenant id, row/object/byte counts, timestamp) that intentionally has no foreign key to `tenants` so it survives the deletion as compliance proof. These run via the integration endpoints `POST /api/integration/tenants/:slug/data-export` and `.../purge`.
