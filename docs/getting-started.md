# Getting Started

A quick walkthrough of OpenInspection — for inspectors using the product and developers extending it.

## Setup

After deploying (see [`developers/02_deploy.md`](developers/02_deploy.md)), visit `/setup` to create your admin account, entering your `SETUP_CODE` (any value of at least 6 characters, set at deploy time — the CLI deploy generates and prints one if you didn't set it; the one-click wizard asks for it as a secret field).

---

## For Inspectors

### Core Workflow

**1. Create an Inspection** — Inspections (`/inspections`) → **+ New Inspection**. Enter address, client info, select template, assign inspector, pick a date.

**2. Field Collection** — Open inspection → Field Form (`/inspections/:id/form`).
- Rate items 1-5 via keyboard, `/` for canned comment picker (250+ pre-written)
- Photos upload to R2 and attach to items
- Works offline — IndexedDB sync on reconnect

**3. Publish** — Click Publish to create a versioned report snapshot. Client receives an email with report link (`/report/:id`).

**4. Booking (Optional)** — Enable public booking at Settings → Services + Availability. Share your company booking page `/book/<company-slug>`. Embeddable widget at `/embed/<company-slug>`. Per-inspector deep links (`/book/<company-slug>/<inspector-slug>`) still work and pre-select that inspector.

### Templates

- 9 item types: rich (rated), boolean, text, number, select, date, photo-only, etc.
- Configurable rating systems (3-level, 5-level, TREC)
- Import from Spectora: paste JSON → one-click import
- Community templates in Marketplace (`/marketplace`)

### Team Roles

| Role | Access |
|---|---|
| Owner | Full access + billing + team management |
| Admin | Full access except billing |
| Inspector | Own inspections + field form + reports |
| Agent | Referral tracking + assigned inspection reports |

---

## For Developers

### Project Structure

```
workers/app.ts        Single-worker entry: Hono mounts API in-process + delegates pages to RR SSR
server/               Hono API (business logic, D1, R2)
app/                  React Router v7 web UI (React SSR on CF Workers)
packages/shared-ui/   Design System 0523 components (Button, Card, Pill, etc.)
packages/api-types/   Hono app type re-export for end-to-end type safety
migrations/           D1 SQL migrations (drizzle-kit schema-first)
tests/                API tests · tests/web/  Web tests
docs/developers/      Architecture, deploy, API ref, testing
scripts/              Setup, seed, backup, key rotation utilities
```

### Local Development

```bash
npm install
npm run db:migrate
npm run dev                    # build-based; http://localhost:8788 (serves API + UI)
```

`npm run dev` is build-based (no HMR): it runs `react-router build` then `wrangler dev` against the single bundled worker. `npm run dev:hmr` is currently broken by the in-process API module graph.

### Key Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Build + run the single worker locally (port 8788) |
| `npm run build` | `react-router build` — bundle `server/` API + `app/` SSR into one worker |
| `npm run db:migrate` | Apply D1 migrations locally |
| `npm run db:generate` | Generate a forward migration from schema changes |
| `npm run deploy` | Build + `wrangler deploy` (single worker) |
| `npm run test:unit` | API unit tests (Vitest, `vitest.api.config.ts`) |
| `npm run test:web` | Web unit tests (Vitest, `vitest.config.ts`) |
| `npm run lint` | ESLint |

### Architecture

ONE Cloudflare Worker. `workers/app.ts` is a Hono entry that mounts the API in-process and delegates page routes to React Router SSR:

```
Browser → single Worker (Hono entry):
            ├─ API-owned paths → API app (Hono + D1) in-process
            └─ everything else → React Router v7 SSR
```

- React Router loaders/actions call the API DIRECTLY via an injected in-process `API_WORKER` self-binding — no network hop, no second worker, no Service Binding between workers
- The web layer holds the session cookie and relays the JWT to the in-process API (Token Relay BFF pattern)
- The API handles all business logic, auth, and database access

### Adding a New Page

1. Create route file in `app/routes/my-page.tsx`
2. Register in `app/routes.ts`
3. Loader calls `apiFetch("/api/...")` with token from session
4. Use `packages/shared-ui` components + Design System tokens (`bg-ih-primary`, `text-ih-fg-1`)

### Adding a New API Endpoint

1. Create or extend a route file in `server/api/`
2. Define Zod schema in `server/lib/validations/`
3. Business logic in `server/services/`
4. Register route in `server/index.ts`
5. Follow route metadata conventions (`docs/developers/07_route_metadata.md`)

### Further Reading

| Doc | Topic |
|---|---|
| [`migrating-roles.md`](migrating-roles.md) | Mapping Spectora / ISN roles to OpenInspection's 4 roles + toggles |
| [`01_architecture.md`](developers/01_architecture.md) | Single-worker architecture, request flow |
| [`02_deploy.md`](developers/02_deploy.md) | Production deployment on Cloudflare |
| [`03_api_reference.md`](developers/03_api_reference.md) | API endpoints and auth patterns |
| [`04_database_schema.md`](developers/04_database_schema.md) | D1 schema overview |
| [`05_testing.md`](developers/05_testing.md) | E2E and unit test guide |
| [`06_inspection_workflow.md`](developers/06_inspection_workflow.md) | Inspection engine internals |

---

## Key Pages

| Page | URL | Purpose |
|---|---|---|
| Inspections | `/inspections` | Inspection list, stats, filters |
| Inspection Editor | `/inspections/:id` | 3-pane editor with sections, items, photos |
| Field Form | `/inspections/:id/form` | Mobile-first field collection |
| Templates | `/templates` | Manage inspection checklists |
| Contacts | `/contacts` | Client and agent CRM |
| Calendar | `/calendar` | Schedule view |
| Settings | `/settings/*` | Workspace config, integrations, billing |
| Public Booking | `/book/:tenant` | Client self-scheduling (company-level; auto-assigns inspector) |
| Report Viewer | `/report/:id` | Client-facing inspection report |
