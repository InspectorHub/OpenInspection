# Database Schema

The database is Cloudflare D1 (SQLite). The schema is defined in TypeScript using Drizzle ORM and applied via migration files in `migrations/`.

## Running Migrations

```bash
# Local dev (applies to the local D1 emulator)
npm run db:migrate

# Production (requires wrangler auth)
npx wrangler d1 migrations apply openinspection-db --remote
```

---

## Tables

### `tenants`

One row per deployed workspace.

| Column | Type | Notes |
|---|---|---|
| `id` | text (PK) | Random ID |
| `name` | text | Company display name |
| `subdomain` | text (unique) | Used for subdomain routing |
| `tier` | text | `'free'` (default) · `'pro'` · `'enterprise'` |
| `status` | text | `'pending'` · `'trialing'` · `'active'` (default) · `'past_due'` · `'suspended'` |
| `stripe_connect_account_id` | text | Stripe Connect Express account ID — routes checkout payments to this account |
| `created_at` | integer | Unix timestamp |

---

### `users`

Inspectors and admins who log in to the dashboard.

| Column | Type | Notes |
|---|---|---|
| `id` | text (PK) | Random ID |
| `tenant_id` | text (FK → tenants) | Scopes the user to a workspace |
| `email` | text (unique) | Login credential |
| `password_hash` | text | SHA-256 hex of the plain password |
| `role` | text | `'owner'`, `'admin'`, `'inspector'`, or `'agent'` |
| `google_refresh_token` | text | Google OAuth refresh token — set after Calendar OAuth flow |
| `google_calendar_id` | text | Primary Google Calendar ID — used for event creation and sync |
| `created_at` | integer | Unix timestamp |

---

### `templates`

Defines the checklist structure for inspections. The `schema` column holds a JSON object describing sections, items, and fields.

| Column | Type | Notes |
|---|---|---|
| `id` | text (PK) | Random ID |
| `tenant_id` | text (FK → tenants) | |
| `name` | text | e.g., `'Standard Home Inspection'` |
| `version` | integer | Incremented on update, default `1` |
| `schema` | text (JSON) | See schema structure below |
| `created_at` | integer | Unix timestamp |

**Template schema structure:**
```json
{
  "sections": [
    {
      "title": "Roof & Structure",
      "items": [
        {
          "id": "roof_1",
          "label": "Shingles Condition",
          "fields": ["status", "notes", "photos"]
        }
      ]
    }
  ]
}
```

Each item has a unique `id` used as the key in `inspection_results.data`.

---

### `inspections`

One row per inspection job.

| Column | Type | Notes |
|---|---|---|
| `id` | text (PK) | Random ID |
| `tenant_id` | text (FK → tenants) | |
| `inspector_id` | text (FK → users) | Assigned inspector |
| `property_address` | text | Full street address |
| `client_name` | text | |
| `client_email` | text | Used for report email delivery |
| `template_id` | text (FK → templates) | Checklist used for this job |
| `date` | text | ISO 8601 datetime string |
| `status` | text | `'draft'`, `'completed'`, or `'delivered'` |
| `payment_status` | text | `'unpaid'` or `'paid'` |
| `referred_by_agent_id` | text | Optional — ID of referring agent |
| `price` | integer | Price in cents (e.g., `45000` = $450.00) |
| `created_at` | integer | Unix timestamp |

---

### `inspection_results`

Stores the field data collected by the inspector. One row per inspection.

| Column | Type | Notes |
|---|---|---|
| `id` | text (PK) | |
| `inspection_id` | text (FK → inspections) | |
| `data` | text (JSON) | Map of item ID → field values |
| `last_synced_at` | integer | Timestamp of last sync from the mobile form |

**`data` structure:**
```json
{
  "roof_1": {
    "status": "Monitor",
    "notes": "Slight wear on north face",
    "photos": ["tenant-id/insp-id/roof_1_abc123_photo.jpg"]
  },
  "foundation_1": {
    "status": "OK",
    "notes": ""
  }
}
```

The field form performs upserts: if a row exists it is updated, otherwise a new row is inserted.

---

### `agreements`

Inspection service agreement templates. One per tenant (typically).

| Column | Type | Notes |
|---|---|---|
| `id` | text (PK) | |
| `tenant_id` | text (FK → tenants) | |
| `name` | text | e.g., `'Standard Terms'` |
| `content` | text | Markdown-formatted agreement body |
| `version` | integer | Default `1` |
| `created_at` | integer | Unix timestamp |

---

### `inspection_agreements`

Records a client's e-signature on the agreement for a specific inspection.

| Column | Type | Notes |
|---|---|---|
| `id` | text (PK) | |
| `inspection_id` | text (FK → inspections) | |
| `signature_base64` | text | PNG data URI of the signature canvas |
| `signed_at` | integer | Timestamp |
| `ip_address` | text | `cf-connecting-ip` header value |
| `user_agent` | text | Browser user agent |

---

### `availability`

Recurring weekly availability for each inspector.

| Column | Type | Notes |
|---|---|---|
| `id` | text (PK) | |
| `tenant_id` | text (FK → tenants) | |
| `inspector_id` | text (FK → users) | |
| `day_of_week` | integer | `0` = Sunday, `6` = Saturday |
| `start_time` | text | `'HH:MM'` 24-hour format |
| `end_time` | text | `'HH:MM'` 24-hour format |
| `created_at` | integer | Unix timestamp |

---

### `availability_overrides`

Date-specific overrides that take precedence over recurring availability.

| Column | Type | Notes |
|---|---|---|
| `id` | text (PK) | |
| `tenant_id` | text (FK → tenants) | |
| `inspector_id` | text (FK → users) | |
| `date` | text | `'YYYY-MM-DD'` |
| `is_available` | integer (boolean) | `0` = blocked, `1` = custom hours |
| `start_time` | text | Only relevant when `is_available = 1` |
| `end_time` | text | Only relevant when `is_available = 1` |
| `created_at` | integer | Unix timestamp |

---

## Migration Files

| File | Tables |
|---|---|
| `migrations/0001_auth.sql` | `tenants`, `users` |
| `migrations/0002_inspections.sql` | `templates`, `inspections`, `inspection_results`, `agreements`, `inspection_agreements`, `availability`, `availability_overrides` |
| `migrations/0003_agent_crm.sql` | Adds `referred_by_agent_id` to `inspections`, creates index |
| `migrations/0004_calendar_connect.sql` | Adds `google_refresh_token`, `google_calendar_id` to `users`; adds `stripe_connect_account_id` to `tenants` |

---

## Indexes

```sql
-- 0003_agent_crm.sql
CREATE INDEX IF NOT EXISTS idx_inspections_agent
    ON inspections(referred_by_agent_id);
```

---

## Drizzle ORM Usage

Schema is defined in `src/lib/db/schema/`. To use in a handler:

```typescript
import { drizzle } from 'drizzle-orm/d1';
import { inspections } from '../lib/db/schema';
import { eq } from 'drizzle-orm';

const db = drizzle(c.env.DB);
const results = await db.select()
    .from(inspections)
    .where(eq(inspections.tenantId, tenantId));
```

All schema is re-exported from `src/lib/db/schema/index.ts` for convenience.
