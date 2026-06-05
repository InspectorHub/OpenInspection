# Database Schema

Cloudflare D1 (SQLite). Migrations are **drizzle-kit schema-first**: the Drizzle ORM schema is the source of truth, and migration SQL is generated from it.

## Source of truth

- **Drizzle schema**: `server/lib/db/schema/` — TypeScript table definitions (the source of truth)
- **Baseline migration**: `migrations/0000_baseline.sql` — the full baseline schema (50+ tables, plus indexes)
- **Schema re-export**: `server/lib/db/schema/index.ts`

## Running migrations

```bash
# Generate a forward migration from schema changes (drizzle-kit diff vs migrations/meta/)
npm run db:generate

# Apply migrations to local D1 (D1 emulator); wrangler owns the d1_migrations table
npm run db:migrate

# Apply migrations to remote D1
npm run db:migrate:remote

# Drift gate: schema vs migrations/ must match (run in CI)
npm run db:check
```

Migrations are applied with wrangler (`wrangler d1 migrations apply`), not `drizzle-kit migrate` — wrangler owns the `d1_migrations` bookkeeping table. `npm run db:generate` only emits the forward SQL.

## Key tables

| Table | Purpose |
|---|---|
| `tenants` | One row per workspace (subdomain, tier, status) |
| `users` | Inspectors, admins, agents (PBKDF2-SHA256 password hash) |
| `templates` | JSON-schema inspection checklists (v2 canonical format) |
| `inspections` | Inspection jobs with status, pricing, scheduling |
| `inspection_results` | Field data collected per inspection (JSON map of item → values) |
| `services` | Bookable inspection services with pricing |
| `contacts` | Client and agent contact records |
| `invoices` | Billing with optional QuickBooks sync |
| `agreements` / `agreement_requests` | E-sign workflow with Ed25519 audit chain |
| `comments` | Canned comment library (250+ seed comments) |
| `templates` / `marketplace_templates` | Local + community template marketplace |
| `availability` / `availability_overrides` | Inspector scheduling (weekly + date overrides) |
| `tenant_configs` | Per-tenant settings, encrypted integration secrets |
| `audit_logs` / `esign_audit_logs` | Immutable audit trail |
| `tenant_destruction_records` | Durable, non-personal proof a tenant was purged during offboarding (no FK to `tenants` so it outlives the deletion) |

For the complete schema (all tables with columns, indexes, and constraints), see `migrations/0000_baseline.sql` — or the Drizzle definitions in `server/lib/db/schema/`, which are the source of truth.

## Drizzle ORM usage

```typescript
import { drizzle } from 'drizzle-orm/d1';
import { inspections } from '../lib/db/schema';
import { eq } from 'drizzle-orm';

const db = drizzle(c.env.DB);
const results = await db.select()
  .from(inspections)
  .where(eq(inspections.tenantId, tenantId));
```

## Conventions

- Every table has `tenant_id` for multi-tenant isolation
- Primary keys are random text IDs (not auto-increment)
- Timestamps are Unix integers (`created_at`, `updated_at`)
- JSON columns stored as `TEXT` (D1 has no native JSON type)
- Indexes follow `idx_{table}_{column}` naming
