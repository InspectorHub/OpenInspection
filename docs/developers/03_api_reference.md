# API Reference

All API routes are under `/api/`. Authenticated endpoints require a valid JWT either in the `Authorization: Bearer <token>` header or the `inspector_token` cookie.

Responses are JSON unless noted.

---

## Public Endpoints (no auth)

### `GET /status`
Health check.

**Response:**
```json
{ "status": "Core Engine Online", "version": "1.0.0" }
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

### `GET /api/public/availability/:inspectorId?date=YYYY-MM-DD`
Get available time slots for an inspector on a given date. Slots are 1-hour blocks derived from base weekly availability, minus any overrides and existing bookings.

**Query params:**
- `date` (required) — ISO date string, e.g., `2025-06-15`

**Response:**
```json
{ "slots": ["09:00", "11:00", "14:00"] }
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
Returns the inspection agreement text for a client to review before signing.

**Response:**
```json
{
  "agreement": {
    "name": "Standard Terms",
    "content": "# Standard Inspection Agreement\n\n..."
  }
}
```

---

### `POST /api/inspections/:id/sign`
Record a client's e-signature on the inspection agreement.

**Request body:**
```json
{ "signatureBase64": "data:image/png;base64,..." }
```

**Response:**
```json
{ "success": true }
```

---

### `POST /api/inspections/:id/checkout`
Initiate a Stripe Checkout session to unlock the full report. Returns a redirect URL.

- If `STRIPE_SECRET_KEY` is configured, creates a real Stripe Checkout session.
- If the tenant has a `stripeConnectAccountId`, the payment is routed through their Stripe Connect Express account with a 10% platform fee.
- Falls back to a mock redirect if `STRIPE_SECRET_KEY` is absent or a placeholder.

**Response:**
```json
{ "url": "https://checkout.stripe.com/..." }
```

---

## Auth Endpoints

### `POST /api/auth/login`
Verify credentials and set the `inspector_token` httpOnly cookie.

**Request body:**
```json
{ "email": "user@example.com", "password": "s3cr3t" }
```

**Response:**
```json
{ "success": true, "token": "eyJ...", "redirect": "/dashboard" }
```

Sets the `inspector_token` httpOnly cookie **and** returns the JWT in the response body so standalone clients can store it in `localStorage` for Bearer-authenticated API calls.

Returns `401` if credentials are invalid.

---

### `POST /api/auth/join`
Accept a team invite token, create the user account, and set the `inspector_token` cookie.

**Request body:**
```json
{ "token": "invite-token", "password": "newpassword" }
```

**Response:**
```json
{ "success": true, "token": "eyJ...", "redirect": "/dashboard" }
```

Sets the `inspector_token` httpOnly cookie **and** returns the JWT in the response body. Store it in `localStorage` as `tenantToken` for subsequent authenticated API calls.

Returns `400` if the token is expired or already used.

---

### `POST /api/auth/change-password`
Change the calling user's password. Requires a valid JWT or `inspector_token` cookie.

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

**Roles:** `owner`, `admin`, `inspector`

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

**Roles:** `admin`, `owner`

**Response:**
```json
{ "success": true }
```

Returns `404` if the inspection is not found or belongs to a different tenant.

---

#### `PATCH /api/inspections/:id`
Update editable metadata on an inspection. Only the fields included in the request body are changed.

**Roles:** `owner`, `admin`, `inspector`

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

#### `PATCH /api/inspections/:id/results`
Save (upsert) field data for an inspection. The field form calls this continuously as the inspector fills in the checklist.

**Roles:** `owner`, `admin`, `inspector`

**Request body:**
```json
{
  "data": {
    "roof_1": { "status": "Defect", "notes": "Missing shingles", "photos": [] }
  }
}
```

**Response:**
```json
{ "success": true }
```

---

#### `POST /api/inspections/:id/complete`
Mark an inspection as completed and email the report link to the client.

**Roles:** `owner`, `admin`, `inspector`

**Response:**
```json
{ "success": true, "emailSent": true }
```

---

#### `POST /api/inspections/:id/upload`
Upload a photo to R2 storage for a specific checklist item.

**Roles:** `owner`, `admin`, `inspector`

**Request:** `multipart/form-data`
- `file` — image file
- `itemId` — checklist item ID the photo belongs to

**Response:**
```json
{ "key": "tenant-id/inspection-id/item-id_abc123_photo.jpg", "success": true }
```

---

#### `GET /api/inspections/files/:key`
Proxy for serving a photo from R2. The key must start with the caller's `tenantId` (enforced server-side).

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

**Roles:** `owner`, `admin`

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

> Requires `GEMINI_API_KEY` to be set. Returns `500` if the key is missing or invalid.

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

> Requires `GEMINI_API_KEY` to be set. Returns `403` if the inspection does not belong to the caller's tenant, `404` if no results exist.

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
Create a new template. **Roles:** `admin`, `owner`

**Request body:**
```json
{ "name": "Commercial Building", "schema": { "sections": [...] } }
```

#### `PUT /api/inspections/templates/:id`
Update a template name or schema. Bumps `version`. **Roles:** `admin`, `owner`

#### `DELETE /api/inspections/templates/:id`
Delete a template. Returns `409` if any inspection references it. **Roles:** `admin`, `owner`

---

### Google Calendar

#### `GET /api/calendar/connect`
Redirect the inspector's browser to Google OAuth consent. Requires `GOOGLE_CLIENT_ID` to be configured and a valid `inspector_token` cookie. Returns `501` if not configured.

#### `GET /api/calendar/callback`
Public OAuth redirect from Google. Exchanges the authorization code for tokens, fetches the primary calendar ID, and stores `googleRefreshToken` + `googleCalendarId` on the `users` row. Redirects to `/dashboard?calendar=connected`.

#### `DELETE /api/calendar/disconnect`
Clears stored Google tokens from the `users` row. Requires `inspector_token` cookie.

#### `POST /api/calendar/sync`
Fetches the inspector's Google Calendar events for the next 30 days and inserts `availabilityOverrides` rows for any busy blocks. Existing overrides for the same date are skipped. Requires `inspector_token` cookie.

**Response:**
```json
{ "success": true, "blockedDatesCreated": 3, "totalEvents": 12 }
```

---

### Admin

#### `GET /api/admin/export`
Export all tenant data as JSON for backup or migration.

**Roles:** `admin`, `owner`

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

**Roles:** `admin`, `owner`

**Request body:** `{ "email": "new@example.com", "role": "inspector" }`

**Response:** `201 Created` — `{ "success": true, "inviteLink": "https://…/join?token=…", "expiresAt": "…" }`

---

#### `GET /api/admin/members`
List workspace members and pending invites.

**Roles:** `admin`, `owner`

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

**Roles:** `admin`, `owner`

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

**Roles:** `admin`, `owner`

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

**Roles:** `admin`, `owner`

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

**Roles:** `admin`, `owner`

**Response:**
```json
{ "success": true }
```

Returns `404` if the agreement does not exist or does not belong to the caller's tenant.

---

#### `POST /api/admin/tenant-status` *(machine-to-machine)*
Sync a tenant's billing tier and status. Called by the portal after every Stripe subscription event. Invalidates the tenant's KV cache entry so the updated record is applied on the next request.

**Auth:** `Authorization: Bearer {JWT_SECRET}` (shared secret, not a user JWT)

**Request body:**
```json
{ "subdomain": "smith", "status": "active", "tier": "pro" }
```

- `subdomain` (required) — identifies the tenant
- `status` (required) — one of `pending`, `trialing`, `active`, `past_due`, `suspended`
- `tier` (optional) — one of `free`, `pro`, `enterprise`; omit to leave tier unchanged

**Response:**
```json
{ "success": true }
```

Returns `404` if no tenant matches the given subdomain.

---

### Agent CRM

#### `GET /api/agent/my-reports`
List inspections referred by the calling agent. Admins and owners can pass `?agentId=<id>` to view any agent's reports.

**Roles:** `agent`, `admin`, `owner`

**Query params (admin/owner only):** `agentId`

**Response:**
```json
{ "agentId": "agent-id", "reports": [...] }
```

---

#### `GET /api/agent/leaderboard`
Referral leaderboard — inspection counts grouped by `referredByAgentId`, descending.

**Roles:** `admin`, `owner`

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

## Error Responses

All endpoints return JSON errors in this format:

```json
{ "error": "Human-readable error message" }
```

Common status codes:
- `400` — Missing or invalid request fields
- `401` — Missing or invalid JWT
- `402` — Subscription required (tenant status is `past_due` or `pending`; non-GET mutations blocked)
- `403` — Forbidden (insufficient role or tenant mismatch)
- `404` — Resource not found
- `409` — Conflict (e.g., deleting a template that is in use)
- `500` — Internal server error
- `503` — Dependency unavailable (e.g., missing API key, setup not complete)
