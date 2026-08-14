# Database Schema

Cloudflare D1 (SQLite). Migrations are **drizzle-kit schema-first**: the Drizzle ORM schema is the source of truth, and migration SQL is generated from it.

## Source of truth

- **Drizzle schema**: `server/lib/db/schema/` — TypeScript table definitions (the source of truth)
- **Baseline migration**: `migrations/0000_baseline.sql` — the full baseline schema (95 tables, plus indexes)
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

`db:check` compares two things that both live in the repo, so it can be green while a database runs a schema older than the code about to be deployed onto it. `npm run db:lag` closes that gap: it asks a database what it has applied and prints that count beside the repo's, and it runs inside `npm run deploy` before `wrangler deploy`. Both comparisons are by **filename** — neither can see a migration whose contents were rewritten in place.

`scripts/migration-lag-baseline.json` is the one escape hatch for `db:lag`. When a baseline rebuild removes forward files, their names stay in `d1_migrations` forever (wrangler never deletes a row), and that file is where such names are declared per database so the gate subtracts them instead of failing. Every list in it is currently empty, deliberately: this deployment reconciled by rewriting the ledger, so no name needs forgiving. Declaring a name there silences the report without reconciling the schema — for an existing self-hosted database the fix is the reconcile in [`self-host/upgrade.md`](../self-host/upgrade.md).

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
| `templates` / `marketplace_templates` | Tenant-owned templates, plus a curated first-party catalogue (not community-contributed; the browsing UI is SaaS-only) |
| `availability` / `availability_overrides` | Inspector scheduling (weekly + date overrides) |
| `tenant_configs` | Per-tenant settings, encrypted integration secrets |
| `audit_logs` / `esign_audit_logs` | Immutable audit trail |
| `tenant_destruction_records` | Durable, non-personal proof a tenant was purged during offboarding (no FK to `tenants` so it outlives the deletion) |

For the complete schema — every table, every column, with types, nullability,
defaults, enum vocabularies, keys and indexes — see
[`database-schema.md`](database-schema.md). It is GENERATED from the migration
chain and the Drizzle definitions by `npm run docs:schema`, and
`npm run lint:schema-doc` (part of `npm run lint`) fails if the committed copy
has fallen behind the schema. Regenerate it in the same commit as a schema
change; do not edit it by hand.

The sources it derives from remain the authority if the two ever disagree:
`migrations/` for structure, `server/lib/db/schema/` for meaning.

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
