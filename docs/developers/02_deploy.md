# Deploying OpenInspection

This guide covers self-hosted production deploys — what every adopter does to run the engine for their own inspection business.

---

## Architecture overview

OpenInspection deploys as a single Cloudflare Worker (the cloudflare/react-router-hono-fullstack-template shape):

- **`workers/app.ts`** — a Hono entry that mounts the full API (`src/`, Hono + Drizzle + D1) in-process for API-owned paths and delegates all other (page) routes to React Router v7 SSR (`app/`, React 18 + Tailwind v4).
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
| R2 bucket        | `PHOTOS`        | Field-form photo uploads.                                  |
| R2 bucket        | `REPORTS`       | Pre-rendered Summary + Full Report PDFs (Spec 5A).         |
| KV namespace     | `TENANT_CACHE`  | Branding + tenant-config 1-hour cache.                     |
| Browser binding  | `BROWSER`       | PDF rendering for reports + e-sign certificates.           |
| Workflow         | `SIGN_COMPLETION_WORKFLOW` | Async e-sign pipeline (Spec 5H).                           |
| Durable Objects  | `INSPECTION_PRESENCE`, `TENANT_PRESENCE` | Live presence for the editor.               |

`npm run setup:cloudflare` provisions every binding listed above and writes their real IDs into a gitignored `wrangler.local.jsonc` (bootstrapped from the committed placeholder `wrangler.jsonc`). Re-run with `--refresh-setup-code` to mint a new first-run setup code if you misplace yours.

### Minimum secrets

| Secret            | When required                                       |
|-------------------|-----------------------------------------------------|
| `JWT_SECRET`      | Always — must be >= 32 random characters.            |
| `RESEND_API_KEY`  | Optional, only if you want outbound email.          |
| `SENDER_EMAIL`    | Required when `RESEND_API_KEY` is set.              |
| `GEMINI_API_KEY`  | Optional — enables AI comment-assist.               |
| `TURNSTILE_SECRET_KEY` | Optional but recommended for the public booking page. |

Set them via `wrangler secret put SECRET_NAME` or through the Cloudflare dashboard.

### Deploy the Worker

```bash
npm install
npm run setup:cloudflare   # provisions D1/KV/R2 + writes real IDs to wrangler.local.jsonc
npm run deploy             # standalone: build + wrangler deploy (uses wrangler.local.jsonc)
# npm run deploy:saas      # saas: uses the gitignored wrangler.saas.jsonc
```

`npm run deploy` runs `react-router build` (bundling `src/` API + `app/` SSR into one worker) then `wrangler deploy` against the built `build/server/wrangler.json`. The build bakes whichever wrangler config wins (`WRANGLER_CONFIG` env > `wrangler.local.jsonc` > committed `wrangler.jsonc`). Apply remote D1 migrations with `npm run db:migrate:remote`.

> **One-click**: the committed `wrangler.jsonc` carries placeholder IDs; the README's *Deploy to Cloudflare* button provisions resources and injects real IDs automatically — no manual `setup:cloudflare` needed for that path.

After the Worker boots, visit `https://<your-worker>.workers.dev/setup` and enter the 6-digit setup code. **The code itself is not printed in logs** — recover it with one of:

- **Recommended**: set `SETUP_CODE=<any 6-digit value>` as a Worker secret before deploying (`wrangler secret put SETUP_CODE`) and use that value at `/setup`.
- Or read the auto-generated code from KV: `wrangler kv key get setup_verification_code --binding TENANT_CACHE` (1-hour TTL). Re-run `npm run setup:cloudflare -- --refresh-setup-code` to mint a fresh one if it expires.

That bootstraps your first admin account.

### How the single worker is wired

The Worker entry at `workers/app.ts` is a Hono app. It routes API-owned paths (`/api/*`, `/status`, `/sign/*`, …) to the API app (`src/`) in-process, and sends every other path to React Router via `createRequestHandler` with `import("virtual:react-router/server-build")`, passing `{ cloudflare: { env, ctx } }` as the `AppLoadContext`. Before delegating to SSR it injects an in-process `API_WORKER` self-binding so React Router loaders/actions call the API app directly — no network hop, no second worker. `@cloudflare/vite-plugin` integrates the React Router SSR build with wrangler, so the standard `wrangler deploy` pipeline ships everything.

### Local development

```bash
npm run dev          # build-based: react-router build + wrangler dev (one worker, port 8788)
```

`npm run dev` is build-based (no HMR): it runs `react-router build` and then `wrangler dev` against the bundled worker. `npm run dev:hmr` (`react-router dev`) is currently broken by the in-process API module graph, so use `npm run dev`. Apply local D1 migrations first with `npm run db:migrate`.
