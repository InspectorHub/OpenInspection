<p align="center">
  <img src="public/logo.svg" alt="OpenInspection" width="140" />
</p>

<h1 align="center">OpenInspection</h1>

<p align="center"><strong>Open source home inspection software.</strong> Self-host the full SaaS-grade inspection stack on Cloudflare for ~$0/month.</p>

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/InspectorHub/OpenInspection)
[![GitHub Discussions](https://img.shields.io/github/discussions/InspectorHub/OpenInspection)](https://github.com/InspectorHub/OpenInspection/discussions)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL%203.0-blue.svg)](LICENSE)

> 🧪 **Try it in 60 seconds — no install, no credit card.**
> [**Start free on inspectorhub.io →**](https://inspectorhub.io/register)
>
> Activation-link signup, and your first 5 inspections are free — no card, no clock. Your workspace ships pre-loaded with starter templates + canned comments so you can click through a real inspection immediately. Decide to self-host later? Your data exports cleanly — same codebase, same schema.

---

## What it is

OpenInspection is [open source home inspection software](https://inspectorhub.io/open-source) — a complete inspection stack: inspector dashboard, public booking widget, mobile field form, professional HTML reports with e-signatures, AI assistance, and PWA offline support, all running on Cloudflare's edge and self-hosted on a single Worker.

### Architecture

- **Single Cloudflare Worker** (`workers/app.ts`) — a Hono entry that mounts the full API in-process and delegates page routes to React Router v7 SSR (the cloudflare/react-router-hono-fullstack-template shape)
- **API** (`server/`) — Hono + Drizzle + D1, handles all business logic
- **Web** (`app/`) — React Router v7 + React 18 + Tailwind v4, SSR on CF Workers
- **Shared UI** (`packages/shared-ui/`) — Design System 0523 token-based components
- One deployable; React Router loaders/actions call the API directly through an in-process `API_WORKER` self-binding (no network hop, no second worker)

### Inspector workflow
- 3-pane editor with 248 canned comments, slash-trigger snippet picker, AI rewrite
- Keyboard-driven: 1-5 ratings, ⌘K palette, `/` snippet picker, `?` HUD
- Offline-capable PWA with photo upload queue
- Migrate from Spectora in under 5 minutes via paste-JSON import

### Customer experience
- Company-level public booking widget (`/book/<slug>`) with auto-assignment, optional inspector choice, and Turnstile bot protection
- E-sign agreements with Ed25519 audit chain — server-rendered signed PDF + Certificate of Completion via Browser Run, evidence-pack zip with email delivery, public verifier URL (`/v/<token>`) with QR code on PDFs + offline self-verify (`/verify`) for court-friendly independence from the server, optional inspector pre-sign
- Branded report viewer with print-as-PDF

### Agent / referral
- Agent CRM with referral tracking
- "Share with buyer" link generation
- Recommendations export

### Self-host friendly
- Runs **standalone** (single-tenant) by default — one fixed tenant holds all your data, no subdomains to manage
- Branded UI (logo, colors) configurable in Settings
- Tenant-scoped D1 data isolation baked into every table

## Why OpenInspection

- **Free to run**: Cloudflare Workers Free tier covers a solo inspector's full year. Pay only for a domain (~$10).
- **Yours**: fork it, change templates, add integrations. No vendor lock-in.
- **Fast**: edge-deployed, < 100 ms response times globally
- **Compliant**: PBKDF2-SHA256 password hashing, hash-chained Ed25519 audit log on e-signatures (ESIGN Act + UETA), server-rendered PDF + Certificate of Completion via Browser Run, offline-verifiable evidence pack, tenant-scoped data isolation
- **Modern**: React Router v7 + React 18 + Hono API + Drizzle + Tailwind v4 — small surface, easy to read

## Quick start

There are three ways to run OpenInspection, from zero effort to full control. Pick one.

### 1. Try the hosted service (no deployment)

Want to evaluate the product without running any infrastructure? Register at [**inspectorhub.io/register**](https://inspectorhub.io/register) with your email, click the activation link, and a workspace is created for you — the app lives at `app.inspectorhub.io`. This is the managed edition of this exact codebase (first 5 inspections free, no card), pre-loaded with starter templates so you can click through a real inspection immediately. You can export your data and switch to a self-hosted deploy at any time.

### 2. Deploy to Cloudflare (one-click)

1. Click the **Deploy to Cloudflare** button above and follow the wizard. This was verified end-to-end on the Cloudflare Workers **Free** plan (2026-05-31). The wizard may surface a "Workers Paid" notice banner — it is **non-blocking**; the deploy completes on the free plan.
2. Cloudflare reads the committed `wrangler.jsonc` (which carries **placeholder IDs only**) and **auto-provisions and binds** the required resources — D1 (`DB`), KV (`TENANT_CACHE`), R2 (`PHOTOS`), the `BROWSER` binding, the Durable Objects and the Workflow — injecting the real resource IDs for you. There is no manual ID editing.
3. After the deploy finishes, visit `/setup` on your new Worker URL and enter your **`SETUP_CODE`** to create the first admin account. For the one-click path, the wizard reads [`.dev.vars.example`](.dev.vars.example) and surfaces `SETUP_CODE` as a secret field you fill in **during** the deploy — that is the value you type at `/setup`. It must be any value of at least 6 characters. `/setup` is gated solely on this secret: if `SETUP_CODE` is unset the endpoint refuses to proceed, so an unprovisioned Worker can't be claimed. You can change it later in the dashboard under **Settings → Variables and Secrets**.

Deep dive: [`docs/developers/02_deploy.md`](docs/developers/02_deploy.md).

### 3. Deploy with the CLI

```bash
git clone https://github.com/InspectorHub/OpenInspection
cd OpenInspection
npm install
npm run setup:cloudflare    # provisions D1/KV/R2 + writes real IDs to a gitignored wrangler.local.jsonc
npm run deploy              # full react-router build, then wrangler deploy
```

- `npm run setup:cloudflare` (`scripts/setup-cloudflare.js`) provisions the Cloudflare resources and writes their real IDs into a gitignored `wrangler.local.jsonc` (bootstrapped from the committed placeholder `wrangler.jsonc`).
- Use `npm run deploy`, **not** raw `wrangler deploy` — the npm script runs the full `react-router build` (bundling `server/` API + `app/` SSR into one worker) before deploying. Its tail then runs idempotent ensure-steps that provision the JWT keypair and **print the `SETUP_CODE` in the deploy output** if one is not already set (it never overwrites an existing value). Visit `/setup` with that code for your first login.
- For local development, use `npm run dev:hmr` (Vite dev server with hot module replacement, port 5173) for the fast iteration loop, or `npm run dev` (build-based — `react-router build` then `wrangler dev` on port 8788) to run the real bundled worker.

Deep dive: [`docs/developers/02_deploy.md`](docs/developers/02_deploy.md). Architecture overview: [`docs/developers/01_architecture.md`](docs/developers/01_architecture.md).

## Documentation

- [Deploy](docs/developers/02_deploy.md) — first-time setup on Cloudflare
- [Architecture](docs/developers/01_architecture.md) — module map, request flow, cost model
- [Contributing](CONTRIBUTING.md) — code conventions and PR process
- [Community](docs/community.md) — Discussions categories and where to talk

## Tech stack

- **Cloudflare Workers**: edge runtime (single Worker — Hono entry mounts the API in-process + delegates page routes to React Router SSR)
- **React Router v7** + React 18: frontend SSR on Workers
- **Hono** + Zod OpenAPI: typed API layer
- **Drizzle ORM** + Cloudflare D1: SQLite at the edge
- **Cloudflare R2 / KV**: object storage and config cache
- **Tailwind CSS**: v4 only (via `@tailwindcss/vite`, design system tokens + utility CSS)
- **Optional**: Gemini AI, Stripe Connect, Resend email, Google Places

## Community

- 💬 [Q&A](https://github.com/InspectorHub/OpenInspection/discussions/categories/q-a)
- 📣 [Roadmap & releases](https://github.com/InspectorHub/OpenInspection/discussions/categories/announcements)
- 💡 [Ideas & feature requests](https://github.com/InspectorHub/OpenInspection/discussions/categories/ideas)
- 🐛 [Issue tracker](https://github.com/InspectorHub/OpenInspection/issues)

## Prefer a managed setup?

If you'd rather skip the infrastructure work, **[InspectorHub](https://inspectorhub.io/)** offers a fully-hosted version of this software — same codebase, managed for you.

- First 5 inspections free — no credit card required
- Simple per-seat pricing
- Any-month money-back guarantee
- Upgrade to self-hosted at any time — your data, your choice

[Try InspectorHub free →](https://inspectorhub.io/)

## License

[GNU Affero General Public License v3.0](LICENSE).
