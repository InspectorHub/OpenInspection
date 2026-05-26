---
domain: "Core Inspection Workflow & Reporting Engine"
related_code_paths: ["apps/core/src/api/inspections.ts", "apps/core/src/api/ai.ts", "apps/core/src/api/bookings.ts", "apps/core/src/lib/db/schema/inspection.ts"]
---

# 07. Core Inspection Workflow

## 1. Data Model — Template-Driven JSON Schema

Inspection forms are not flat database tables. The schema uses two key tables:

### `templates`
Stores the form structure as a JSON blob in the `schema` column. Each tenant has one or more templates (a default is seeded on registration).

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
          "type": "condition",
          "options": ["Satisfactory", "Marginal", "Defect", "Not Inspected"]
        }
      ]
    }
  ]
}
```

There are **no** separate `TemplateSections` or `TemplateItems` tables. The entire nested structure lives in `templates.schema` (JSON column).

### `inspection_results`
Stores the inspector's field responses as a JSON blob in the `data` column. One row per inspection session.

```json
{
  "item_roof": { "status": "Defect", "notes": "Missing 3 shingles", "media": ["uuid-photo"] },
  "item_siding": { "status": "Satisfactory", "notes": "" }
}
```

Keys are item IDs from the template. Only items the inspector interacted with are stored (sparse).

### Full Schema

| Table | Key Columns | Purpose |
|---|---|---|
| `templates` | `tenantId`, `name`, `version`, `schema` (JSON) | Form structure definition |
| `inspections` | `tenantId`, `inspectorId`, `templateId`, `propertyAddress`, `clientEmail`, `status`, `paymentStatus`, `price` | Job record |
| `inspection_results` | `inspectionId`, `data` (JSON), `lastSyncedAt` | Field data collected |
| `agreements` | `tenantId`, `name`, `content` (Markdown), `version` | Legal agreement template |
| `inspection_agreements` | `inspectionId`, `signatureBase64`, `signedAt`, `ipAddress`, `userAgent` | Signed agreement record |
| `availability` | `tenantId`, `inspectorId`, `dayOfWeek`, `startTime`, `endTime` | Weekly recurring schedule |
| `availability_overrides` | `tenantId`, `inspectorId`, `date`, `isAvailable`, `startTime`, `endTime` | Date-specific slot changes |

## 2. Offline-First Field Collection

The form renderer (`src/templates/pages/form-renderer.template.ts`) uses **IndexedDB** to cache form responses locally. When the inspector is offline, all changes are saved to IndexedDB. When connectivity is restored, a background sync queue PATCHes the accumulated changes to `PATCH /api/inspections/:id/results`.

**Field-level merge**: `PATCH /api/inspections/:id/results` does a **last-write-wins merge per item key** — incoming fields are merged over the existing blob so each PATCH only needs to send changed items, not the full results object.

> **Not implemented**: CRDT / incremental conflict resolution.

## 3. Photo Upload Pipeline

Photos are uploaded via:
```
POST /api/inspections/:id/upload
Content-Type: multipart/form-data
```

The Worker receives the file, stores it in R2 under a tenant-scoped key (`{tenantId}/{inspectionId}/{filename}`), and returns the key. Files are retrieved via:
```
GET /api/inspections/files/:key
```
The retrieval endpoint verifies the key is scoped to the requesting tenant before proxying from R2.

> **Not implemented**: Direct presigned URL uploads (client-to-R2 bypass). All uploads currently pass through the Worker.

## 4. Report Generation & PDF Export

When an inspection is completed (`POST /api/inspections/:id/complete`):
1. `inspections.status` is set to `'completed'`
2. Resend email is sent to `clientEmail` with a link to `GET /api/inspections/:id/report`
3. The report page (`src/templates/pages/report.template.ts`) renders the full inspection as HTML

**PDF Export**: The report template includes print stylesheets (`@media print`). Users invoke `window.print()` in the browser to export a formatted PDF. No Puppeteer or third-party PDF service is used.

Report access is gated:
- Agreement must be signed first (`inspection_agreements` record required)
- Full report requires `paymentStatus === 'paid'` (blurred/locked otherwise)

## 5. Template CRUD (apps/core/src/api/inspections.ts)

Templates are managed by admin/owner users. All endpoints require JWT auth.

| Endpoint | Role | Purpose |
|---|---|---|
| `GET /api/inspections/templates` | Any | List all templates (id, name, version) for tenant |
| `POST /api/inspections/templates` | admin/owner | Create template — requires `name` + `schema` JSON |
| `PUT /api/inspections/templates/:id` | admin/owner | Update name/schema, bumps `version` counter |
| `DELETE /api/inspections/templates/:id` | admin/owner | Delete — blocked with 409 if any inspection references it |

## 5b. Availability Management (apps/core/src/api/availability.ts)

Inspectors manage their own weekly schedule and date-specific overrides. Admins can manage any inspector's schedule via `?inspectorId=` query param.

| Endpoint | Purpose |
|---|---|
| `GET /api/availability` | List weekly recurring slots |
| `PUT /api/availability` | Full replace of weekly schedule; validates `dayOfWeek` (0–6), `startTime`, `endTime` |
| `GET /api/availability/overrides` | List date-specific overrides |
| `POST /api/availability/overrides` | Add block-out or extra slot for a specific date |
| `DELETE /api/availability/overrides/:id` | Remove an override (returns 404 if not found) |

## 6. AI Assistance (apps/core/src/api/ai.ts)

| Endpoint | Input | Output |
|---|---|---|
| `POST /api/ai/comment-assist` | `{inspectionId, itemId, rawNote}` | Professional rewrite of the inspector's note |
| `POST /api/ai/auto-summary` | `{inspectionId}` | Bullet-point summary of all defects |

Both call **Gemini 1.5 Flash** via `callGemini()`. Temperature is 0.2 for consistent professional output.

## 7. Screenshots

### Public Booking Page

![Booking Page](screenshots/core-booking.png)

### Inspection Report (Demo)

![Report Page](screenshots/core-report.png)

See [`docs/screenshots.md`](../screenshots.md) for the full UI screenshot index.

## 8. Execution Flow

```
1. Admin creates inspection (POST /api/inspections/)
   → selects template, assigns inspector, enters address

2. Inspector opens /inspections/:id/form on mobile
   → template JSON parsed into interactive checklist UI
   → responses saved to IndexedDB immediately

3. Inspector photographs defects
   → POST /api/inspections/:id/upload → stored in R2

4. Background sync pushes IndexedDB data
   → PATCH /api/inspections/:id/results

5. Inspector marks complete (POST /api/inspections/:id/complete)
   → status = 'completed'
   → email sent to client with report link

6. Client receives email → opens report URL
   → signs agreement (POST /api/inspections/:id/sign)
   → pays via Stripe checkout (POST /api/inspections/:id/checkout)
   → full report unlocked
```
