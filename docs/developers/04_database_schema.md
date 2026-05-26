# Database Schema

Cloudflare D1 (SQLite). Schema defined in Drizzle ORM, applied via migration files.

## Source of truth

- **Drizzle schema**: `api/src/lib/db/schema/` — TypeScript table definitions
- **Baseline migration**: `api/migrations/0001_baseline.sql` — 54 tables, 90+ indexes
- **Schema re-export**: `api/src/lib/db/schema/index.ts`

## Running migrations

```bash
# Local dev (D1 emulator)
npm run db:migrate

# Production
npm run db:migrate:remote
```

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

For the complete schema (all 54 tables with columns, indexes, and constraints), see `api/migrations/0001_baseline.sql`.

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
