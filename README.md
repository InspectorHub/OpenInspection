<p align="center">
  <img src="public/logo.svg" alt="OpenInspection" width="140" />
</p>

<h1 align="center">OpenInspection</h1>

<p align="center"><strong>Open source home inspection software.</strong> AGPL-3.0, self-hostable on a single Cloudflare Worker, with a JSON data export.</p>

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/InspectorHub/OpenInspection)
[![GitHub Discussions](https://img.shields.io/github/discussions/InspectorHub/OpenInspection)](https://github.com/InspectorHub/OpenInspection/discussions)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL%203.0-blue.svg)](LICENSE)

> 🧪 **Try it in 60 seconds — no install, no credit card.**
> [**Start free on inspectorhub.io →**](https://inspectorhub.io/register)
>
> Activation-link signup; the hosted service has a free plan that needs no card. Your workspace ships pre-loaded with starter templates + canned comments so you can click through a real inspection immediately. The app is the same open-source codebase you can run yourself. The engine can export inspections, results, templates and agreement records as JSON, plus contacts, members and inspections as CSV. It does not yet export photos, report PDFs, settings or invoices, and the JSON export cannot be re-imported, so moving a workspace between deployments is not automatic today.

---

## What it is

OpenInspection is [open source home inspection software](https://inspectorhub.io/open-source) — an inspection stack with an inspector dashboard, public booking widget, a field-ready inspection editor, professional HTML reports with e-signatures, AI assistance, and PWA offline support, all running on Cloudflare's edge and self-hosted on a single Worker.

### Architecture

- **Single Cloudflare Worker** (`workers/app.ts`) — a Hono entry that mounts the full API in-process and delegates page routes to React Router v8 SSR (the cloudflare/react-router-hono-fullstack-template shape)
- **API** (`server/`) — Hono + Drizzle + D1, handles all business logic
- **Web** (`app/`) — React Router v8 + React 19 + Tailwind v4, SSR on CF Workers
- **Shared UI** (`packages/shared-ui/`) — Design System 0523 token-based components
- One deployable; React Router loaders/actions call the API directly through an in-process `API_WORKER` self-binding (no network hop, no second worker)

### Inspector workflow
- 3-pane editor; a new workspace starts with 250+ canned comments, 80 repair items, 4 rating systems and 7 inspection templates (residential, pre-listing, new construction ×2, sewer scope, radon, mold)
- Keyboard-driven: `1`-`5` ratings, `/` canned-comment library, `;` snippets, `?` cheatsheet, `⌘K` palette in the workspace
- Simultaneous editing — inspection results are a Yjs CRDT in a Durable Object
- Installable PWA; field data is offline-capable (the results document buffers in IndexedDB and merges on reconnect). Item photos, crops and annotations taken offline are held in IndexedDB and upload when the connection returns. Photos attached to a defect and video upload in the web app need a connection (the add-video control is disabled while offline)
- Migrate from Spectora through the import wizard, which shows what the conversion produced before anything is written
- Native client: [OpenInspection-App](https://github.com/InspectorHub/OpenInspection-App) is the offline-first native client, built with Capacitor, in its own AGPL-3.0 repository; it talks to this engine through the generated API contract. Android builds are published as signed APKs on its Releases page; iOS and a Windows client (Electron) are in development and not yet publicly available

### Customer experience
- Company-level public booking widget (`/book/<slug>`) with auto-assignment, optional inspector choice, and Turnstile bot protection
- E-sign agreements with Ed25519 audit chain — server-rendered signed PDF + Certificate of Completion via Browser Run, evidence-pack zip with email delivery, public verifier URL (`/v/<token>`) with QR code on PDFs + offline self-verify (`/verify`) that does not depend on the server, optional inspector pre-sign
- Branded report viewer with print-as-PDF

### Agent / referral
- Agent CRM with referral tracking
- "Share with buyer" link generation
- Recommendations export

### Self-host friendly
- Runs **standalone** (single-tenant) by default — one fixed tenant holds all your data, no subdomains to manage
- Branded UI (logo, colors) configurable in Settings
- Every tenant-owned table carries the tenant id, and tenant queries are scoped by it

## Why OpenInspection

- **Open**: the whole stack is AGPL-3.0 source you can read, fork and run yourself, and the engine can export a company's inspections, results, templates and agreement records as JSON (`GET /api/admin/export`, see the API reference), plus contacts, members and inspections as CSV. Photos, report PDFs, settings and invoices are not part of the export, and the JSON cannot be re-imported.
- **Cheap to run**: a solo inspector's whole year fits in Cloudflare's smallest paid Workers plan, plus a domain (~$10/yr). The free plan is enough to try it and enough to deploy it, but ⚠️ **not enough to run it**: its CPU ceiling is in the low milliseconds and this application's p95 request is ~49ms (measured over seven days of live traffic, 2026-09-05). A statutory-form render alone is ~470ms.
- **Yours**: fork it, change templates, add integrations.
- **Fast**: runs at the Cloudflare edge; over seven days of live traffic a request used a median of 8 ms of CPU and 49 ms at p95 (2026-09-05); this excludes network distance and heavy renders such as statutory forms.
- **Security and signing**: PBKDF2-SHA256 password hashing, tenant-scoped data, a hash-chained Ed25519 record of signer intent and consent that can be verified offline, and a server-rendered signed PDF with a certificate of completion
- **Modern**: React Router v8 + React 19 + Hono API + Drizzle + Tailwind v4 — small surface, easy to read

## Quick start

There are three ways to run OpenInspection, from zero effort to full control. Pick one.

### 1. Try the hosted service (no deployment)

Want to evaluate the product without running any infrastructure? Register at [**inspectorhub.io/register**](https://inspectorhub.io/register) with your email, click the activation link, and a workspace is created for you — the app lives at `app.inspectorhub.io`. This is the managed edition of this exact codebase (there is a free plan, no card needed), pre-loaded with starter templates so you can click through a real inspection immediately. You can download your data from Settings, Data (JSON and CSV). A hosted workspace cannot yet be loaded into a self-hosted deployment automatically; see the export limits above.

### 2. Deploy to Cloudflare (one-click)

1. Click the **Deploy to Cloudflare** button above and follow the wizard. The DEPLOY was verified end-to-end on the Cloudflare Workers **Free** plan (2026-05-31), and the wizard's "Workers Paid" notice banner is **non-blocking** — the deploy completes. ⚠️ That verified the install, not the running application: under real traffic the free plan's CPU ceiling returns HTTP 1102 on ordinary pages (observed 2026-09-05). Plan for a paid Workers plan before putting it in front of clients.
2. Cloudflare reads the committed `wrangler.jsonc` (which carries **placeholder IDs only**) and **auto-provisions and binds** the required resources — D1 (`DB`), KV (`TENANT_CACHE`), R2 (`PHOTOS`), the `BROWSER` binding, the Durable Objects and the Workflow — injecting the real resource IDs for you. There is no manual ID editing.
3. After the deploy finishes, visit `/setup` on your new Worker URL and enter your **`SETUP_CODE`** to create the first admin account. For the one-click path, the wizard reads [`.dev.vars.example`](.dev.vars.example) and surfaces `SETUP_CODE` as a secret field you fill in **during** the deploy — that is the value you type at `/setup`. It must be any value of at least 6 characters. `/setup` is gated solely on this secret: if `SETUP_CODE` is unset the endpoint refuses to proceed, so an unprovisioned Worker can't be claimed. You can change it later in the dashboard under **Settings → Variables and Secrets**.

Deep dive: [`docs/operate/deploy.md`](docs/operate/deploy.md).

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
- For local development, use `npm run dev:hmr` (Vite dev server with hot module replacement, port 5173) for the fast iteration loop, or `npm run dev` (build-based — `react-router build` then `wrangler dev` on port 8787) to run the real bundled worker.

Deep dive: [`docs/operate/deploy.md`](docs/operate/deploy.md). Architecture overview: [`docs/develop/architecture.md`](docs/develop/architecture.md).

## Documentation

**[`docs/README.md`](docs/README.md) is the map.** The most-used entries:

- [Deploy](docs/operate/deploy.md) — first-time setup on Cloudflare
- [Upgrading](docs/operate/upgrade.md) — upgrade an existing deployment to a newer release
- [User guide](https://inspectorhub.io/docs) — the inspection workflow end to end, for hosted and self-hosted alike
- [Architecture](docs/develop/architecture.md) — module map, request flow, cost model
- [Design System](docs/develop/design-system.md) — tokens, shared-ui components, dark mode, `lint:ds`
- [Contributing](CONTRIBUTING.md) — code conventions and PR process, including the [Versioning & Deprecation Policy](CONTRIBUTING.md#versioning--deprecation-policy)
- [Community](docs/community.md) — Discussions categories and where to talk

## Tech stack

- **Cloudflare Workers**: edge runtime (single Worker — Hono entry mounts the API in-process + delegates page routes to React Router SSR)
- **React Router v8** + React 19: frontend SSR on Workers
- **Hono** + Zod OpenAPI: typed API layer
- **Drizzle ORM** + Cloudflare D1: SQLite at the edge
- **Cloudflare R2 / KV**: object storage and config cache
- **Tailwind CSS**: v4 only (via `@tailwindcss/vite`, design system tokens + utility CSS)
- **Optional**: any OpenAI-compatible AI endpoint, Stripe Connect, email (Resend / SendGrid / Postmark / Mailgun), SMS (Twilio / Telnyx), QuickBooks Online, Google or Apple calendar, Google Places

## Community

- 💬 [Q&A](https://github.com/InspectorHub/OpenInspection/discussions/categories/q-a)
- 📣 [Roadmap & releases](https://github.com/InspectorHub/OpenInspection/discussions/categories/announcements)
- 💡 [Ideas & feature requests](https://github.com/InspectorHub/OpenInspection/discussions/categories/ideas)
- 🐛 [Issue tracker](https://github.com/InspectorHub/OpenInspection/issues)

## Hosted version

Prefer not to run it yourself? InspectorHub runs OpenInspection for you at [inspectorhub.io](https://inspectorhub.io): sign up and start inspecting, with no servers to set up or keep updated. It is the same open-source software, and there is a free plan to try it. Current plans, limits and terms are on the site. For what differs between the hosted service and a copy you run yourself, see [Deployment modes](https://github.com/InspectorHub/OpenInspection/blob/main/docs/reference/deployment-modes.md).

## License

[GNU Affero General Public License v3.0](LICENSE).
