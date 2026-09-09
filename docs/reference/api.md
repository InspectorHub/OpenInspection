# API Reference

> ⚠️ **This page is a hand-written sample, not the API.** It describes a few
> dozen endpoints; the deployment serves several hundred. The authoritative
> surface is the **live OpenAPI document at `/doc`**, with Swagger UI at `/ui`,
> both generated from the route definitions themselves — plus
> `server/lib/mcp/openapi-snapshot.json`, the committed snapshot of the same
> thing. Nothing generates or checks the page you are reading, and a 2026-09-09
> audit found six endpoints on it that do not exist and three written under the
> wrong prefix. **When this page and `/doc` disagree, `/doc` is right.**
>
> What is worth reading here is the part `/doc` does not carry: the auth model,
> the response envelope, and the status-code vocabulary.

Almost all API routes are under `/api/`. Inbound provider **webhooks** are the
deliberate exception and mount at the top level (`/webhooks/{vendor}`), because
the producer owns the body and the signature and none of the `/api/*` middleware
applies to them. `/status`, `/photos/*`, `/.well-known/*`, `/sign/*`, `/sso`,
`/m2m/*` and the ICS feed are also top-level.

Authenticated endpoints require a valid JWT in the `__Host-inspector_token`
HttpOnly cookie. The token is ES256-signed with a `kid` naming its keyring
entry. A `Authorization: Bearer <token>` header is also accepted.

Responses are JSON unless noted.

---

## Public Endpoints (no auth)

### `GET /status`
Health check. Its shape is load-bearing — `scripts/check-deploy-lag.mjs` reads
`commit` and `branch` and refuses to report "no lag" for a status it cannot
parse.

**Response:**
```json
{
  "status": "ok",
  "app": "openinspection-core",
  "version": "1.0.0",
  "commit": "…",
  "branch": "…",
  "buildTime": "…",
  "timestamp": "…"
}
```

---

### `GET /api/public/inspectors`
List all inspectors for the current tenant (used by the booking page).

**Response:**
```json
{
  "inspectors": [
    { "id": "user-id", "email": "john@example.com", "role": "inspector" }
  ]
}
```

---

### `GET /api/public/availability/:inspectorId?tenant=<slug>&start=YYYY-MM-DD&end=YYYY-MM-DD`
Get an inspector's raw availability for a date range: base weekly windows, date overrides, and already-booked dates. Rate-limited per IP.

**Query params:**
- `tenant` (required) — the tenant slug from the booking page URL; resolved server-side (404 if unknown)
- `start` (optional) — ISO date string; defaults to today
- `end` (optional) — ISO date string; defaults to 14 days from now

**Response:**
```json
{
  "success": true,
  "data": {
    "baseAvailability": [{ "dayOfWeek": 1, "startTime": "09:00", "endTime": "17:00" }],
    "overrides": [{ "date": "2025-06-15", "isAvailable": false }],
    "bookedSlots": ["2025-06-16"]
  }
}
```

---

### `POST /api/public/book`
Submit a booking request. Creates an inspection record with `status: 'draft'`.

**Request body:**
```json
{
  "propertyAddress": "123 Main St, Springfield",
  "clientName": "Jane Smith",
  "clientEmail": "jane@example.com",
  "inspectorId": "user-id",
  "date": "2025-06-15T09:00:00.000Z",
  "templateId": "optional-template-id"
}
```

**Response:**
```json
{ "success": true, "inspectionId": "abc12345" }
```

---

### `GET /api/inspections/:id/report`
Returns the rendered HTML report page. Publicly accessible — no auth required. Supports `id=demo` for a demo report.

---

### `GET /api/inspections/:id/agreement`
Returns the agreement to sign on-site. Find-or-creates the signing **envelope**
(`agreement_requests` + `agreement_signers`) so the on-site surface reads the
SAME pinned snapshot + signer set as the emailed flow. Returns
`{ "agreement": null }` when the tenant has no agreement template configured.

**Response:**
```json
{
  "agreement": {
    "id": "agr-123",
    "name": "Standard Terms",
    "content": "# Standard Inspection Agreement\n\n..."
  },
  "requestId": "env-456",
  "completionPolicy": "all",
  "signers": [
    { "id": "sgr-1", "name": "Jane", "email": "jane@x.com", "role": "client", "status": "sent" }
  ]
}
```

`agreement.{id,name,content}` is a backward-compatible subset; new fields are additive.

---

### `POST /api/inspections/:id/sign`
Record an on-site e-signature. The signature rides the agreement **envelope**
(snapshot + Spec 5H audit chain + per-signer receipt email), and on completion
runs the same pipeline as the emailed flow. Requires a configured agreement
template — signing against no template is rejected (closes the prior legal hole
where on-site signatures had zero legal evidence).

**Request body:**
```json
{
  "signatureBase64": "data:image/png;base64,...",
  "signerId": "sgr-1",
  "onBehalfOf": "Jane Doe",
  "onBehalfDisclaimer": "..."
}
```
`signerId`/`onBehalfOf`/`onBehalfDisclaimer` are optional. Without `signerId`,
the first non-terminal signer is targeted.

**Response:**
```json
{ "success": true, "data": { "signed": true, "signerId": "sgr-1", "envelopeStatus": "signed" } }
```
A repeat sign returns `{ "signed": true, "alreadySigned": true, ... }`. With no
template configured, responds `409` with `{ "code": "no_agreement_template" }`.

---

### ~~`POST /api/inspections/:id/checkout`~~ — does not exist

**Removed from this page 2026-09-09: no such route has been found in the
codebase.** The report pay-gate is driven from the public token track instead —
`GET /api/public/checkout/:token` and
`POST /api/public/inspections/:id/pay-intent`. See
[`../integrations/stripe.md`](../integrations/stripe.md) for the payment flow
and `/doc` for the current shapes.

---

## Auth Endpoints

### `POST /api/auth/login`
Verify credentials and set the `__Host-inspector_token` httpOnly cookie.

**Request body:**
```json
{ "email": "user@example.com", "password": "s3cr3t" }
```

**Response:**
```json
{ "success": true, "data": { "redirect": "/inspections" } }
```

The JWT is delivered **only** as the `__Host-inspector_token` HttpOnly cookie.
It is not in the body, and browser JavaScript must never store a token —
`CLAUDE.md` § JWT & Auth Security Rules makes both of those rules. The one
exception is the server-side BFF: a caller sending `x-token-relay: 1` also gets
`token` in `data`, because Workers `fetch()` may strip `Set-Cookie` on a
server-to-server hop and the BFF has to put the token in its own session cookie.
The browser never sends that header.

**If the user has 2FA enabled, no session is granted here.** The response is
`{ "success": true, "data": { "requires2fa": true, "challengeToken": "…" } }`
with **no** `Set-Cookie` — challenge tokens travel JSON-only, so a stolen session
cookie alone can never bypass the second factor. The challenge is valid for five
minutes; post it back with the TOTP code to `POST /api/auth/login/2fa` to get a
session.

Returns `401` if credentials are invalid.

### The rest of the 2FA surface

`POST /api/auth/2fa/setup`, `/2fa/verify`, `/2fa/disable`,
`/2fa/recovery-codes/regenerate`, and `POST /api/auth/login/2fa`. Shapes are in
`/doc`; the server side lives in `server/api/auth/totp.ts`.

---

### `POST /api/auth/join`
Accept a team invite token, create the user account, and set the `__Host-inspector_token` cookie.

**Request body:**
```json
{ "token": "invite-token", "password": "newpassword" }
```

**Response:**
```json
{ "success": true, "data": { "redirect": "/inspections" } }
```

Sets the `__Host-inspector_token` HttpOnly cookie. As with login, the JWT is not
returned to a browser and must not be stored in `localStorage`.

Returns `400` if the token is expired or already used.

---

### `POST /api/auth/change-password`
Change the calling user's password. Requires a valid JWT or `__Host-inspector_token` cookie.

**Request body:**
```json
{ "currentPassword": "oldpass", "newPassword": "newpass123" }
```

**Response:**
```json
{ "success": true }
```

Returns `401` if `currentPassword` is wrong, `400` if `newPassword` is under 8 characters.

---

### `POST /api/auth/forgot-password`
Send a password reset link to the given email address. Always returns `200` — no enumeration.

**Request body:**
```json
{ "email": "user@example.com" }
```

**Response:**
```json
{ "success": true }
```

A signed one-time token is stored in `TENANT_CACHE` KV with a 1-hour TTL. If `RESEND_API_KEY` is configured, an email is sent with the reset link. The link format is `{APP_BASE_URL}/reset-password?token=<token>`.

---

### `POST /api/auth/reset-password`
Exchange a valid reset token for a new password.

**Request body:**
```json
{ "token": "reset-token", "newPassword": "newpass123" }
```

**Response:**
```json
{ "success": true }
```

Returns `400` if the token is invalid, expired, or already used. Returns `400` if `newPassword` is under 8 characters. The token is invalidated on use.

---

## Authenticated Endpoints (JWT required)

All endpoints below require a valid JWT. The `tenantId` is extracted from the JWT `custom:tenantId` claim and scopes all queries.

### Inspections

#### `GET /api/inspections`
List all inspections for the tenant.

**Roles:** any authenticated user

**Response:**
```json
{
  "inspections": [
    {
      "id": "abc12345",
      "tenantId": "tenant-id",
      "inspectorId": "user-id",
      "propertyAddress": "123 Main St",
      "clientName": "Jane Smith",
      "clientEmail": "jane@example.com",
      "templateId": "template-id",
      "date": "2025-06-15T09:00:00.000Z",
      "status": "draft",
      "paymentStatus": "unpaid",
      "price": 45000,
      "referredByAgentId": null,
      "createdAt": "..."
    }
  ]
}
```

---

#### `GET /api/inspections/:id`
Get a single inspection with its template schema.

**Response:**
```json
{
  "inspection": { ... },
  "template": {
    "id": "template-id",
    "name": "Standard Home Inspection",
    "version": 1,
    "schema": { "sections": [...] }
  }
}
```

---

#### `POST /api/inspections`
Create a new inspection.

**Roles:** `owner`, `manager`, `inspector`

**Request body:**
```json
{
  "propertyAddress": "456 Oak Ave, Portland",
  "clientName": "Bob Jones",
  "clientEmail": "bob@example.com",
  "templateId": "template-id",
  "inspectorId": "user-id",
  "referredByAgentId": "optional-agent-id"
}
```

**Response:** `201 Created`
```json
{ "message": "Inspection created successfully", "inspection": { ... } }
```

---

#### `DELETE /api/inspections/:id`
Delete an inspection and its associated results. The inspection must belong to the caller's tenant.

**Roles:** `owner`, `manager`

**Response:**
```json
{ "success": true }
```

Returns `404` if the inspection is not found or belongs to a different tenant.

---

#### `PATCH /api/inspections/:id`
Update editable metadata on an inspection. Only the fields included in the request body are changed.

**Roles:** `owner`, `manager`, `inspector`

**Allowed fields:** `propertyAddress`, `clientName`, `clientEmail`, `date`, `inspectorId`, `price`, `status`

Valid `status` values: `draft`, `completed`, `delivered`

**Request body (all fields optional):**
```json
{
  "propertyAddress": "99 Updated Ave, Portland",
  "clientName": "Jane Smith",
  "clientEmail": "jane@example.com",
  "date": "2025-07-01T10:00:00.000Z",
  "inspectorId": "user-id",
  "price": 45000,
  "status": "completed"
}
```

**Response:**
```json
{ "inspection": { ... } }
```

Returns `400` if no valid fields are provided or `status` is not a recognised value. Returns `404` if the inspection is not found or belongs to a different tenant.

---

#### `GET /api/inspections/:id/results`
Get the field data collected for an inspection.

**Response:**
```json
{
  "data": {
    "roof_1": { "status": "Monitor", "notes": "Wear on north side", "photos": ["key1", "key2"] },
    "foundation_1": { "status": "OK", "notes": "" }
  }
}
```

---

#### ~~`PATCH /api/inspections/:id/results`~~ — does not exist

**There has never been a `PATCH` on `/{id}/results`; the only method there is
`GET`.** The bulk write path is `POST /api/inspections/:id/results/batch`, and
in normal editing nothing calls it per keystroke either: the editor's writes go
into a Yjs document held in a Durable Object, and the DO is the only writer of
`inspection_results.data`. See
[`../concepts/collab-editing.md`](../concepts/collab-editing.md).

This phantom route has cost real time before — `develop/testing.md` records an
E2E spec that patched it, got a silent 404 on its seed step, and stayed green
while testing nothing.

---

#### `POST /api/inspections/:id/complete`
Mark an inspection as completed and email the report link to the client.

**Roles:** `owner`, `manager`, `inspector`

**Response:**
```json
{ "success": true, "emailSent": true }
```

---

#### `POST /api/inspections/:id/upload`
Upload a photo to R2 storage for a specific checklist item.

**Roles:** `owner`, `manager`, `inspector`

**Request:** `multipart/form-data`
- `file` — image file
- `itemId` — checklist item ID the photo belongs to

**Response:**
```json
{ "key": "tenant-id/inspection-id/item-id_abc123_photo.jpg", "success": true }
```

---

#### `GET /api/inspections/:id/photo?key=<r2-key>`
Streams a photo from R2, scoped to the caller's tenant and inspection by the key
prefix. `?download=1` forces an attachment named after the stored original;
`?w=<px>` serves an on-the-fly thumbnail. The key contains `/`, which is why it
travels as a query parameter rather than a path segment.

The public report viewer has its own token-scoped twin in `public-report.ts`.
(This section used to describe `GET /api/inspections/files/:key`, a route that
does not exist.)

---

#### `GET /api/inspections/templates`
List all inspection templates for the tenant.

**Response:**
```json
{
  "templates": [
    { "id": "template-id", "name": "Standard Home Inspection", "version": 1 }
  ]
}
```

---

#### `GET /api/inspections/inspectors`
List all users (inspectors) in the tenant.

**Roles:** `owner`, `manager`

**Response:**
```json
{
  "inspectors": [
    { "id": "user-id", "email": "john@example.com", "role": "inspector" }
  ]
}
```

---

### AI Assist

#### `POST /api/ai/comment-assist`
Rewrite a rough inspector note into a professional, objective comment using Gemini 1.5 Flash.

**Roles:** any authenticated user

**Request body:**
```json
{
  "text": "Some rust visible",
  "context": "Electrical Panel"
}
```

- `text` (required) — the raw inspector note to rewrite
- `context` (optional) — checklist item label used as context for the AI

**Response:**
```json
{
  "text": "Rust observed on the electrical panel enclosure. Recommend evaluation by a licensed electrician to assess corrosion extent and potential impact on panel safety."
}
```

> Requires AI to be configured: a resolvable credential (the tenant's own key, or a deployment-provided one in `saas`) **and** `AI_MODEL`. Returns `503` when either is missing, and `500` when the model call itself fails.

---

#### `POST /api/ai/auto-summary`
Generate a high-level defect summary from an inspection's collected results using Gemini 1.5 Flash.

**Roles:** any authenticated user

**Request body:**
```json
{ "inspectionId": "abc12345" }
```

**Response:**
```json
{
  "summary": "The inspection identified significant concerns with the roof shingles and electrical panel that warrant immediate attention from licensed contractors."
}
```

If no defect-status items are recorded the response is:
```json
{ "summary": "No significant defects observed during this inspection." }
```

> Requires AI to be configured (a resolvable credential **and** `AI_MODEL`; `503` otherwise). Returns `403` if the inspection does not belong to the caller's tenant, `404` if no results exist.

---

### Availability

#### `GET /api/availability`
Get the calling inspector's weekly availability schedule.

**Roles:** any authenticated user

**Response:**
```json
{ "availability": [{ "id": "...", "dayOfWeek": 1, "startTime": "09:00", "endTime": "17:00" }] }
```

---

#### `PUT /api/availability`
Replace the calling inspector's entire weekly schedule (full replace, not merge).

**Roles:** any authenticated user

**Request body:**
```json
{
  "slots": [
    { "dayOfWeek": 1, "startTime": "09:00", "endTime": "17:00" },
    { "dayOfWeek": 3, "startTime": "09:00", "endTime": "17:00" }
  ]
}
```

**Response:** `{ "success": true, "count": 2 }`

---

#### `GET /api/availability/overrides`
List date-specific availability overrides for the calling inspector.

---

#### `POST /api/availability/overrides`
Add a block-out date or custom-hours override.

**Request body:**
```json
{ "date": "2025-07-04", "isAvailable": false }
```
```json
{ "date": "2025-12-24", "isAvailable": true, "startTime": "09:00", "endTime": "13:00" }
```

**Response:** `201 Created` — `{ "success": true, "override": { ... } }`

---

#### `DELETE /api/availability/overrides/:id`
Delete a date override by ID.

---

### Templates

#### `GET /api/inspections/templates`
List all inspection templates for the tenant.

#### `POST /api/inspections/templates`
Create a new template. **Roles:** `owner`, `manager`

**Request body:**
```json
{ "name": "Commercial Building", "schema": { "sections": [...] } }
```

#### `PUT /api/inspections/templates/:id`
Update a template name or schema. Bumps `version`. **Roles:** `owner`, `manager`

#### `DELETE /api/inspections/templates/:id`
Delete a template. Returns `409` if any inspection references it. **Roles:** `owner`, `manager`

---

### Google Calendar

#### `GET /api/calendar/connect`
Redirect the inspector's browser to Google OAuth consent. Requires `GOOGLE_CLIENT_ID` to be configured and a valid `__Host-inspector_token` cookie. Returns `501` if not configured.

#### `GET /api/calendar/callback`
Public OAuth redirect from Google. Exchanges the authorization code for tokens, fetches the primary calendar ID, and stores `googleRefreshToken` + `googleCalendarId` on the `users` row. Redirects to `/inspections?calendar=connected`.

#### `DELETE /api/calendar/disconnect`
Clears stored Google tokens from the `users` row. Requires `__Host-inspector_token` cookie.

#### `POST /api/calendar/sync`
Fetches the inspector's Google Calendar events for the next 30 days and inserts `availabilityOverrides` rows for any busy blocks. Existing overrides for the same date are skipped. Requires `__Host-inspector_token` cookie.

**Response:**
```json
{ "success": true, "blockedDatesCreated": 3, "totalEvents": 12 }
```

---

### Admin

#### `GET /api/admin/export`
Export all tenant data as JSON for backup or migration.

**Roles:** `owner`, `manager`

**Response:**
```json
{
  "exportedAt": "2025-06-15T12:00:00.000Z",
  "tenantId": "tenant-id",
  "inspections": [...],
  "inspectionResults": [...],
  "templates": [...],
  "agreements": [...],
  "inspectionAgreements": [...]
}
```

---

#### `POST /api/admin/invite`
Create a 7-day team invite link. Sends a Resend email if `RESEND_API_KEY` is configured, otherwise logs the link to console.

**Roles:** `owner`, `manager`

**Request body:** `{ "email": "new@example.com", "role": "inspector" }`

**Response:** `201 Created` — `{ "success": true, "inviteLink": "https://…/join?token=…", "expiresAt": "…" }`

---

#### `GET /api/admin/members`
List workspace members and pending invites.

**Roles:** `owner`, `manager`

**Response:**
```json
{
  "members": [
    { "id": "user-id", "email": "john@example.com", "role": "inspector", "createdAt": "..." }
  ],
  "invites": [
    { "id": "token", "email": "pending@example.com", "role": "inspector", "expiresAt": "...", "status": "pending" }
  ]
}
```

---

#### `GET /api/admin/agreements`
List all agreement templates for the tenant.

**Roles:** `owner`, `manager`

**Response:**
```json
{
  "agreements": [
    { "id": "agreement-id", "name": "Standard Terms", "version": 1, "createdAt": "..." }
  ]
}
```

---

#### `POST /api/admin/agreements`
Create a new agreement template.

**Roles:** `owner`, `manager`

**Request body:**
```json
{ "name": "Standard Terms", "content": "# Inspection Agreement\n\nThis agreement..." }
```

**Response:** `201 Created`
```json
{ "success": true, "agreement": { "id": "agreement-id", "name": "Standard Terms", "version": 1, "createdAt": "..." } }
```

---

#### `PUT /api/admin/agreements/:id`
Update an existing agreement template. Bumps the `version` field.

**Roles:** `owner`, `manager`

**Request body** (all fields optional):
```json
{ "name": "Updated Terms", "content": "# Revised Inspection Agreement\n\n..." }
```

**Response:**
```json
{ "success": true, "agreement": { "id": "agreement-id", "name": "Updated Terms", "version": 2, "createdAt": "..." } }
```

Returns `404` if the agreement does not exist or does not belong to the caller's tenant.

---

#### `DELETE /api/admin/agreements/:id`
Delete an agreement template.

**Roles:** `owner`, `manager`

**Response:**
```json
{ "success": true }
```

Returns `404` if the agreement does not exist or does not belong to the caller's tenant.

---

> Portal ↔ core machine-to-machine endpoints (e.g. `POST /api/admin/tenant-status`,
> `POST /api/admin/silo`) are SaaS-only and not used by a standalone self-hosted deploy.

---

### Agent CRM

#### `GET /api/agent/my-reports`
List inspections referred by the calling agent. Admins and owners can pass `?agentId=<id>` to view any agent's reports.

**Roles:** `agent`, `owner`, `manager`

**Query params (admin/owner only):** `agentId`

**Response:**
```json
{ "agentId": "agent-id", "reports": [...] }
```

---

#### `GET /api/agent/leaderboard`
Referral leaderboard — inspection counts grouped by `referredByAgentId`, descending.

**Roles:** `owner`, `manager`

**Response:**
```json
{
  "leaderboard": [
    { "agentId": "agent-id", "total": 12 },
    { "agentId": "agent-id-2", "total": 7 }
  ]
}
```

---

## Response envelope

Both halves come from `server/lib/response.ts` (`sendSuccess` / `sendError`) and
are the same on every endpoint that uses them:

```json
{ "success": true, "data": { }, "meta": { } }
```

```json
{ "success": false, "error": { "message": "…", "code": "…", "details": { } } }
```

`code` is the machine-readable half and is what a client should branch on;
`message` is for a person. `details` carries whatever the specific failure can
say — the AI refusals, for instance, put their reason vocabulary there.

(The flat `{ "error": "…" }` shape this section described until 2026-09-09 was
never what the code sends.)

Common status codes:
- `400` — Missing or invalid request fields
- `401` — Missing or invalid JWT
- `402` — Subscription required (tenant status is `past_due` or `pending`; non-GET mutations blocked)
- `403` — Forbidden (insufficient role or tenant mismatch)
- `404` — Resource not found
- `409` — Conflict (e.g., deleting a template that is in use)
- `500` — Internal server error
- `503` — Dependency unavailable (e.g., missing API key, setup not complete)
