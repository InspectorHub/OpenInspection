# Getting Started

A quick walkthrough of OpenInspection — for inspectors using the product and developers extending it.

## Setup

After deploying (see [`developers/02_deploy.md`](developers/02_deploy.md)), visit `/setup` to create your admin account. A 6-digit verification code is logged on first boot.

---

## For Inspectors

### Core Workflow

**1. Create an Inspection** — Dashboard (`/dashboard`) → **+ New Inspection**. Enter address, client info, select template, assign inspector, pick a date.

**2. Field Collection** — Open inspection → Field Form (`/inspections/:id/form`).
- Rate items 1-5 via keyboard, `/` for canned comment picker (250+ pre-written)
- Photos upload to R2 and attach to items
- Works offline — IndexedDB sync on reconnect

**3. Publish** — Click Publish to create a versioned report snapshot. Client receives an email with report link (`/report/:id`).

**4. Booking (Optional)** — Enable public booking at Settings → Services + Availability. Share `/book/:tenant/:slug`. Embeddable widget at `/embed/:tenant/:slug`.

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
api/                  Hono API Worker (business logic, D1, R2)
frontend/             React Router v7 Frontend Worker (React SSR on CF Workers)
packages/shared-ui/   Design System 0523 components (Button, Card, Pill, etc.)
packages/api-types/   Hono app type re-export for end-to-end type safety
docs/developers/      Architecture, deploy, API ref, testing
scripts/              Setup, seed, backup, key rotation utilities
```

### Local Development

```bash
# Terminal 1: API Worker
npm install
npm run db:migrate
npm run dev                    # http://localhost:8788

# Terminal 2: Frontend
cd frontend && npm install
npm run dev                    # http://localhost:5173 (proxies API)
```

### Key Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start API Worker (port 8788) |
| `cd frontend && npm run dev` | Start React Router v7 dev server (port 5173) |
| `npm run db:migrate` | Apply D1 migrations locally |
| `npm run deploy` | Deploy api + web (standalone env) |
| `npm run deploy:api` / `npm run deploy:web` | Deploy a single module |
| `npm run deploy:saas` | Deploy api + web (saas env) |
| `npm run test:unit` | API unit tests (Vitest) |
| `npm run lint` | ESLint across all workspaces |

### Architecture

Two independent Cloudflare Workers connected via Service Binding:

```
Browser → Frontend Worker (React Router v7 SSR) → Service Binding → API Worker (Hono + D1)
```

- **Frontend** holds the session cookie, relays JWT to API (Token Relay BFF pattern)
- **API** handles all business logic, auth, database access
- Zero network hop between Workers in production

### Adding a New Page

1. Create route file in `frontend/app/routes/my-page.tsx`
2. Register in `frontend/app/routes.ts`
3. Loader calls `apiFetch("/api/...")` with token from session
4. Use `packages/shared-ui` components + Design System tokens (`bg-ih-primary`, `text-ih-fg-1`)

### Adding a New API Endpoint

1. Create or extend a route file in `api/src/api/`
2. Define Zod schema in `api/src/lib/validations/`
3. Business logic in `api/src/services/`
4. Register route in `api/src/index.ts`
5. Follow route metadata conventions (`docs/developers/07_route_metadata.md`)

### Further Reading

| Doc | Topic |
|---|---|
| [`01_architecture.md`](developers/01_architecture.md) | Dual Worker architecture, request flow |
| [`02_deploy.md`](developers/02_deploy.md) | Production deployment on Cloudflare |
| [`03_api_reference.md`](developers/03_api_reference.md) | API endpoints and auth patterns |
| [`04_database_schema.md`](developers/04_database_schema.md) | D1 schema overview (54 tables) |
| [`05_testing.md`](developers/05_testing.md) | E2E and unit test guide |
| [`06_inspection_workflow.md`](developers/06_inspection_workflow.md) | Inspection engine internals |

---

## Key Pages

| Page | URL | Purpose |
|---|---|---|
| Dashboard | `/dashboard` | Inspection list, stats, filters |
| Inspection Editor | `/inspections/:id` | 3-pane editor with sections, items, photos |
| Field Form | `/inspections/:id/form` | Mobile-first field collection |
| Templates | `/templates` | Manage inspection checklists |
| Contacts | `/contacts` | Client and agent CRM |
| Calendar | `/calendar` | Schedule view |
| Settings | `/settings/*` | Workspace config, integrations, billing |
| Public Booking | `/book/:tenant/:slug` | Client self-scheduling |
| Report Viewer | `/report/:id` | Client-facing inspection report |
