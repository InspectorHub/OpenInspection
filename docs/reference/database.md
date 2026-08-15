# Database Schema

**This page holds the rules; [`database-schema.md`](database-schema.md) holds the
facts.** Anything countable — how many tables, which ones lack `tenant_id`, how
many timestamp columns and in what unit — is generated there from the migration
chain and the Drizzle definitions, and `npm run lint:schema-doc` fails if the
committed copy has fallen behind. Nothing countable is written here, because this
page had four such claims and every one of them was wrong by the time anyone
read it.

What is here instead: why the schema is the way it is, how to change it safely,
and what an audit of every table concluded.

Cloudflare D1 (SQLite). Migrations are **drizzle-kit schema-first**: the Drizzle ORM
schema is the source of truth, and `db:generate` diffs against it.

Generated SQL is the starting point, not the rule. A `DROP COLUMN` is **hand-written**,
because drizzle emits a twelve-step table rebuild that needs `PRAGMA foreign_keys=OFF`
outside a transaction and D1 cannot do that — see the Schema Rules in `CLAUDE.md`, which
also give the grep that checks a hand-written drop carries none of the rebuild's
signature. Most recent migrations here are hand-written for that reason.

## Source of truth

- **Drizzle schema**: `server/lib/db/schema/` — TypeScript table definitions (the source of truth)
- **Baseline migration**: `migrations/0000_baseline.sql` — the full baseline schema, plus indexes.
  The table and column counts live in [`database-schema.md`](database-schema.md), which is
  generated and gated; repeating them here would only give them somewhere to drift.
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
| `marketplace_templates` | A curated first-party catalogue beside the tenant's own templates (not community-contributed; the browsing UI is SaaS-only) |
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

## What a 2026-08 audit of every table concluded

Recorded here because the answers cost real measurement and would otherwise be
re-derived from scratch by the next person to ask.

**Do not merge tables to make queries faster.** The obvious candidates —
`report_pdfs` with `report_exports`, the several artifact tables — share a shape
but not a lifecycle, and merging them trades a join nobody was waiting on for a
wider row that every reader then pays for. The list endpoint's cost was never the
join count: it was selecting 76 columns to publish 9, which is a projection
problem and was fixed as one. Measure the query before reshaping the schema.

**Prefix-redundant indexes are dead weight, but prove it per index.** Seventeen
went: two exact duplicates and fifteen strict left-prefixes of a wider index.
The theory that a narrower index scans fewer pages and may still be preferred is
real, so each was checked with `EXPLAIN QUERY PLAN` rather than reasoned about.
One caveat cost an hour and is worth passing on: sqlite3 caches statements, so an
"after" plan read on the same connection can still name an index that has already
been dropped. Read it on a fresh connection.

**A dead column is not the same as an unused one.** Ten came out on the first
pass; the ones that survived it did so because a name search made them look alive.
`commercial_subtypes` (the table) matched only because a template-schema FIELD
shares its name; `agreement_requests.token` looked like a throwaway handle because
that is what the code wrote, while production still held real tokens from before
that code shipped. Compare against a sibling that IS alive, and check the data,
not only the code.

**The schema reference is generated for this reason.** Hand-written schema facts
drift silently — this file claimed 95 tables and universal `tenant_id` while
neither was true. Facts that can be derived should be derived, and the ones that
cannot (why a column exists) belong in a comment next to the column, where they
travel with it.

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

- **Any table holding tenant data carries `tenant_id`.** A table may omit it only by
  not being *about* a tenant. Which tables those are is listed in the generated
  reference, and `npm run lint:tenant-scope` is the gate; if a table you just added
  turns up on that list, the table is the bug.
- Primary keys are random text IDs (not auto-increment)
- **Timestamps are epoch milliseconds** — `integer(..., { mode: 'timestamp_ms' })`,
  never seconds. The two are one multiplication apart and the mistake reads as a date
  tens of thousands of years out. A calendar date with no time component may be
  `YYYY-MM-DD` TEXT if its comment says so. The current census is in the generated
  reference.
- JSON columns stored as `TEXT` (D1 has no native JSON type)
- Indexes follow `idx_{table}_{column}` naming
