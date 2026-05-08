# OpenInspection

> The first open-source SaaS-grade home inspection app. Self-host on Cloudflare for ~$0/month.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/InspectorHub/OpenInspection)
[![Try the sandbox](https://img.shields.io/badge/sandbox-live-emerald)](https://sandbox.inspectorhub.io)
[![GitHub Discussions](https://img.shields.io/github/discussions/InspectorHub/OpenInspection)](https://github.com/InspectorHub/OpenInspection/discussions)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL%203.0-blue.svg)](LICENSE)

🧪 **Live demo**: [sandbox.inspectorhub.io](https://sandbox.inspectorhub.io) — login `demo@inspectorhub.io` / `demo1234`. Data resets daily.

---

<!-- Screenshots are committed after the sandbox demo deploys. Captured at 1440x900 from the live sandbox. -->

> **Screenshot gallery — to be captured after sandbox deploy:**
> - `screenshots/dashboard.png` — Portfolio view with defect distribution + attention thresholds
> - `screenshots/inspection-edit.png` — 3-pane editor with section nav, item editor, canned comments + photos
> - `screenshots/report-viewer.png` — Left sidebar with defect badges, top tabs (Full / Summary / Safety), Share + PDF dropdowns
> - `screenshots/marketplace.png` — Community templates and comment libraries with one-click import

---

## What it is

A complete home inspection software stack: inspector dashboard, public booking widget, mobile field form, professional HTML reports with e-signatures, AI assistance, multi-tenant routing, and PWA offline support — all running on Cloudflare's edge.

### Inspector workflow
- 3-pane editor with 248 canned comments, slash-trigger snippet picker, AI rewrite
- Keyboard-driven: 1-5 ratings, ⌘K palette, `/` snippet picker, `?` HUD
- Offline-capable PWA with photo upload queue

### Customer experience
- Public booking widget with Turnstile bot protection
- E-sign agreements with Ed25519 audit chain
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
- **Compliant**: PBKDF2-SHA256 password hashing, Ed25519 audit chain on e-signatures, multi-tenant data isolation
- **Modern**: Hono + JSX + Drizzle + Tailwind — small surface, easy to read

## Quick start

### Zero-Setup (Web-First)
1. Click the **Deploy to Cloudflare** button above
2. Follow the dashboard prompts to create your D1 database, R2 bucket, and KV namespace
3. Visit your Worker URL (e.g., `https://openinspection.workers.dev/setup`)
4. A 6-digit setup code is generated and logged. Enter it to initialize your admin account.

> If you don't see the setup code in your deployment logs, run `npm run setup:cloudflare -- --refresh-setup-code` to generate a new one.

### CLI-First
```bash
git clone https://github.com/InspectorHub/OpenInspection
cd OpenInspection
npm install
npm run setup:cloudflare    # provisions D1 / R2 / KV automatically
npm run dev                 # http://localhost:8788
```

### Local development
```bash
git clone https://github.com/InspectorHub/OpenInspection
cd OpenInspection
npm install
npm run setup:cloudflare -- --local    # provisions a local-only sandbox
npm run dev
```

Detailed setup: [`docs/deploy.md`](docs/deploy.md). Architecture overview: [`docs/architecture.md`](docs/architecture.md). Extension cookbook: [`docs/extending.md`](docs/extending.md).

## Documentation

- [Deploy](docs/deploy.md) — first-time setup on Cloudflare, sandbox runbook
- [Architecture](docs/architecture.md) — module map, request flow, cost model
- [Extending](docs/extending.md) — recipes for templates, payments, automation, themes
- [Contributing](CONTRIBUTING.md) — code conventions and PR process
- [Community](docs/community.md) — Discussions categories and where to talk

## Tech stack

- **Cloudflare Workers**: edge runtime
- **Hono** with hono/jsx: routing + server-rendered HTML
- **Drizzle ORM** + Cloudflare D1: SQLite at the edge
- **Cloudflare R2 / KV**: object storage and config cache
- **Alpine.js** + Tailwind CSS: client-side interactivity and styling
- **Optional**: Gemini AI, Stripe Connect, Resend email, Mapbox geocoding

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
