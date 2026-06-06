# OpenInspection Workflow

## 1. Data Model — Template-Driven JSON Schema

Inspection forms are not flat database tables. Two key tables:

### `templates`

Form structure as JSON in the `schema` column. Each tenant has one or more templates.

```json
{
  "title": "Standard Home Inspection",
  "sections": [
    {
      "id": "sec_exterior",
      "title": "Exterior",
      "items": [
        {
          "id": "item_roof",
          "title": "Roof Coverings",
          "type": "rich"
        }
      ]
    }
  ]
}
```

**9 item types**: `rich` (rating + 3 canned-comment tabs) plus `boolean`, `text`, `textarea`, `number`, `select`, `multi_select`, `date`, `photo_only`. Rating stored on `result.rating`, non-rich values on `result.value`.

**Rating systems** are configurable per template (`rating_system_id` → `rating_systems` table). Each system defines levels with labels, colors, and severity buckets.

Schema is validated by `server/lib/validations/template.schema.ts` (single canonical v2 format).

### `inspection_results`

Inspector's field responses as JSON in `data`. One row per inspection.

```json
{
  "item_roof": { "rating": "Defect", "notes": "Missing 3 shingles", "media": ["uuid-photo"] },
  "item_siding": { "rating": "Satisfactory", "notes": "" }
}
```

Keys are item IDs from the template. Only items the inspector interacted with are stored (sparse).

## 2. Offline-First Field Collection

The form renderer (`app/routes/form-renderer.tsx`) uses the `useOfflineQueue` hook + IndexedDB to cache responses locally. When offline, changes are saved to IndexedDB. On reconnect, a background sync queue PATCHes changes to `PATCH /api/inspections/:id/results`.

**Field-level merge**: PATCH does last-write-wins per item key — only changed items need to be sent.

## 3. Photo Upload Pipeline

```
POST /api/inspections/:id/upload
Content-Type: multipart/form-data
```

Worker stores the file in R2 under `{tenantId}/{inspectionId}/{filename}`. Files retrieved via `GET /api/inspections/files/:key` (tenant-scoped verification before proxying from R2).

Photos can have annotations and captions (`inspection_media_pool` table).

## 4. Report Generation & PDF

When an inspection is published:
1. `inspections.status` is set to `'published'`
2. A report version snapshot is created (`report_versions` table)
3. Email sent to client with report link
4. Report rendered as HTML with print stylesheet — users invoke `window.print()` for PDF

Report viewer: `app/routes/public/report.tsx` (card-stack layout with section navigation).

## 5. Canned Comments & AI

**Canned comments**: 250+ pre-written inspection comments in `comments` table. 3-tab picker (Satisfactory / Monitor / Defect) on each `rich` item. Slash-trigger (`/`) opens snippet picker in the notes field.

**AI assistance** (`server/api/ai.ts`):

| Endpoint | Purpose |
|---|---|
| `POST /api/ai/comment-assist` | Professional rewrite of inspector's note |
| `POST /api/ai/auto-summary` | Bullet-point summary of all defects |

Both call Gemini 1.5 Flash. Temperature 0.2.

## 6. Template Management

| Endpoint | Role | Purpose |
|---|---|---|
| `GET /api/inspections/templates` | Any | List templates |
| `POST /api/inspections/templates` | admin/owner | Create (name + schema JSON) |
| `PUT /api/inspections/templates/:id` | admin/owner | Update, bumps version |
| `DELETE /api/inspections/templates/:id` | admin/owner | Delete (409 if in use) |
| `POST /api/inspections/templates/import-spectora` | admin/owner | Import from Spectora export |

**Marketplace**: Community templates available via `GET /api/marketplace/templates` with one-click install.

## 7. Availability & Booking

Inspectors manage weekly schedule + date overrides via `availability` / `availability_overrides` tables.

Public booking: `GET /public/book/:tenant` returns the company booking page with all services and available slots; the system auto-assigns the first available qualified inspector. An optional inspector-choice dropdown is shown when the tenant enables "Allow clients to choose their inspector" (Settings → Online Booking → Booking policies). Customer submits via `POST /public/book` with Turnstile bot protection. Legacy per-inspector URLs `GET /public/book/:tenant/:slug` redirect 302 to the company page with that inspector pre-selected.

## 8. Execution Flow

```
1. Admin/inspector creates inspection
   → selects template, assigns inspector, enters address + client info

2. Inspector opens inspection on mobile (form-renderer)
   → template JSON parsed into interactive checklist
   → keyboard-driven: 1-5 ratings, / snippet picker, Cmd-K palette
   → responses saved to IndexedDB immediately

3. Inspector photographs defects
   → POST /api/inspections/:id/upload → R2

4. Background sync pushes IndexedDB data
   → PATCH /api/inspections/:id/results (field-level merge)

5. Inspector publishes report
   → report version snapshot created
   → email sent to client with report link

6. Client receives email → opens report
   → signs agreement if required
   → pays via Stripe if required
   → full report accessible
```

## Key code paths

| Path | Purpose |
|---|---|
| `server/api/inspections.ts` | Inspection + template CRUD |
| `server/api/bookings.ts` | Public booking + availability |
| `server/api/ai.ts` | AI comment assist + auto-summary |
| `server/services/inspection.service.ts` | Core business logic (130KB) |
| `server/lib/validations/template.schema.ts` | Template v2 schema validation |
| `app/routes/inspection-edit.tsx` | 3-pane inspection editor |
| `app/routes/form-renderer.tsx` | Mobile field form |
| `app/hooks/useInspection.ts` | Inspection state management (866 LOC) |
| `app/hooks/useCannedComments.ts` | Comment picker logic |
