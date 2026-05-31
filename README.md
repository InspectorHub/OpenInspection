<p align="center">
  <img src="public/logo.svg" alt="OpenInspection" width="140" />
</p>

<h1 align="center">OpenInspection</h1>

<p align="center">The first open-source SaaS-grade home inspection app. Self-host on Cloudflare for ~$0/month.</p>

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/InspectorHub/OpenInspection)
[![GitHub Discussions](https://img.shields.io/github/discussions/InspectorHub/OpenInspection)](https://github.com/InspectorHub/OpenInspection/discussions)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL%203.0-blue.svg)](LICENSE)

> 🧪 **Try it in 60 seconds — no install, no credit card.**
> [**Start a free 30-day trial on inspectorhub.io →**](https://inspectorhub.io/register)
>
> Magic-link signup. Your trial workspace ships pre-loaded with starter templates + canned comments so you can click through a real inspection immediately. Decide to self-host later? Your data exports cleanly — same codebase, same schema.

---

## What it is

A complete home inspection software stack: inspector dashboard, public booking widget, mobile field form, professional HTML reports with e-signatures, AI assistance, multi-tenant routing, and PWA offline support — all running on Cloudflare's edge.

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
- Public booking widget with Turnstile bot protection
- E-sign agreements with Ed25519 audit chain — server-rendered signed PDF + Certificate of Completion via Browser Run, evidence-pack zip with email delivery, public verifier URL (`/v/<token>`) with QR code on PDFs + offline self-verify (`/verify`) for court-friendly independence from the server, optional inspector pre-sign
- Branded report viewer with print-as-PDF

### Agent / referral
- Agent CRM with referral tracking
- "Share with buyer" link generation
- Recommendations export

### Multi-tenant
- Subdomain routing
- Branded UI per tenant
- Tenant-scoped D1 data isolation

## Why OpenInspection

- **Free to run**: Cloudflare Workers Free tier covers a solo inspector's full year. Pay only for a domain (~$10).
- **Yours**: fork it, change templates, add integrations. No vendor lock-in.
- **Fast**: edge-deployed, < 100 ms response times globally
- **Compliant**: PBKDF2-SHA256 password hashing, hash-chained Ed25519 audit log on e-signatures (ESIGN Act + UETA), server-rendered PDF + Certificate of Completion via Browser Run, offline-verifiable evidence pack, multi-tenant data isolation
- **Modern**: React Router v7 + React 18 + Hono API + Drizzle + Tailwind v4 — small surface, easy to read

## Quick start

### Option 0: Try it hosted (fastest)

Not ready to commit to running infrastructure? Spin up a managed workspace at [**inspectorhub.io/register**](https://inspectorhub.io/register) — 30-day free trial, no card. Useful for evaluating the editor, report viewer, and booking flow before you decide to self-host. You can export your data and move to a self-hosted deploy at any time.

### Option 1: One-Click Deploy

1. Click the **Deploy to Cloudflare** button above — this deploys the Worker
2. Follow the dashboard prompts. Cloudflare reads the committed `wrangler.jsonc` (placeholder IDs) and **auto-provisions + binds** the resources: one D1 database, two R2 buckets (`PHOTOS` + `REPORTS`), one KV namespace (`TENANT_CACHE`), the `BROWSER` binding, two Durable Object classes and one Workflow — no manual ID entry.
3. Or deploy from the CLI:
   ```bash
   npm install
   npm run setup:cloudflare   # provisions D1/KV/R2 + writes real IDs to a gitignored wrangler.local.jsonc
   npm run deploy             # build + wrangler deploy
   ```
4. Visit your Worker URL → `/setup` (e.g., `https://openinspection.your-account.workers.dev/setup`)
5. A 6-digit setup code is generated on first boot. The code itself is **not** printed in logs — recover it with one of:
   - **Recommended**: set `SETUP_CODE=<any 6-digit value>` as a Worker secret before deploying, then use that value at `/setup`
   - Or read the generated code from KV: `wrangler kv key get setup_verification_code --binding TENANT_CACHE` (1-hour TTL)

> React Router loaders/actions call the API in-process through an injected `API_WORKER` self-binding (zero-latency, no network hop, no second worker). The single Worker is configured by the committed `wrangler.jsonc` (placeholder IDs — CF fills real ones on one-click; or `npm run setup:cloudflare` writes a gitignored `wrangler.local.jsonc`) with `main = "./workers/app.ts"` — `npm run deploy` builds and ships it.

### Option 2: CLI-First
```bash
git clone https://github.com/InspectorHub/OpenInspection
cd OpenInspection
npm install
npm run setup:cloudflare    # provisions D1 / R2 / KV automatically
npm run dev                 # http://localhost:8788
```

### Option 3: Local development
```bash
git clone https://github.com/InspectorHub/OpenInspection
cd OpenInspection
npm install
npm run setup:cloudflare -- --local    # provisions a local dev environment
npm run dev
```

Detailed setup: [`docs/developers/02_deploy.md`](docs/developers/02_deploy.md). Architecture overview: [`docs/developers/01_architecture.md`](docs/developers/01_architecture.md).

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

- 30-day free trial, no credit card required
- Simple per-seat pricing
- 30-day money-back guarantee
- Upgrade to self-hosted at any time — your data, your choice

[Try InspectorHub free →](https://inspectorhub.io/)

## License

[GNU Affero General Public License v3.0](LICENSE).
