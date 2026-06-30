# Route Metadata Conventions

Every `createRoute()` call under `server/api/` must declare metadata used by the
MCP server + Skill generator. The vitest gate at
`tests/unit/route-metadata.spec.ts` enforces this on CI; missing or
malformed metadata fails the build.

This document codifies the standard. For the broader integration architecture
see [mcp-oauth-notes.md](mcp-oauth-notes.md) (server internals) and
[connecting-claude-mcp.md](connecting-claude-mcp.md) (how a user connects Claude).

## Required fields

| Field | Required? | Purpose |
|---|---|---|
| `operationId` | YES | tool name source, stable contract |
| `summary` (4-12 words, sentence case, no terminal period) | YES | shown in tool list |
| `description` (≥ 50 chars, 1-3 sentences) | YES | tool / skill description |
| `tags` (≥ 1 from controlled vocabulary) | YES | drives skill grouping |
| `x-scopes` (array of `read`/`write`/`admin`/`agent`) | YES via `withMcpMetadata` | scope enforcement + filter |
| `x-tier` (`primary` / `extended` / `excluded`) | YES via `withMcpMetadata` | tool tier exposure |
| Every input schema field's `.describe()` (≥ 10 chars) | YES | Claude argument-selection accuracy |

## `operationId` naming

`camelCase`, derived from HTTP method + last meaningful path segment + entity.
The generator will produce `openinspection_<snake_case>` MCP tool names.

| Pattern | Example |
|---|---|
| GET collection → `list<Entity>s` | `GET /api/inspections` → `listInspections` |
| GET single → `get<Entity>` | `GET /api/inspections/{id}` → `getInspection` |
| GET sub-resource → `get<Entity><Sub>` | `GET /api/inspections/{id}/results` → `getInspectionResults` |
| POST → `create<Entity>` | `POST /api/inspections` → `createInspection` |
| PUT → `update<Entity>` | `PUT /api/inspections/{id}` → `updateInspection` |
| PATCH → `patch<Entity>` (or narrower verb) | `PATCH /api/inspections/{id}/bulk` → `bulkPatchInspection` |
| DELETE → `delete<Entity>` | `DELETE /api/inspections/{id}` → `deleteInspection` |
| Verb-named action → `<verb><Entity>` | `POST /api/inspections/{id}/clone` → `cloneInspection` |

Uniqueness: every `operationId` is globally unique across the app.

## `tags` controlled vocabulary

Primary tag (required, exactly one of):

```
auth         inspections   bookings      templates     team
agents       ai            invoices      services      messages
notifications contacts     metrics       admin         sysadmin
audit        marketplace   recommendations  agreements webhooks
public       calendar      tags          ratings       guest
profile      identity      automations   integrations  qbo
```

Optional secondary tags: `public`, `m2m`, `beta`, `webhook`.

## `x-scopes` mapping

Default by HTTP method:
- `GET` → `['read']`
- `POST/PUT/PATCH/DELETE` → `['write']`

Override when:
- `/api/admin/*` or `/api/sysadmin/*` → `['admin']`
- agent-specific routes → `['agent']`
- public routes (`/public/*`, `/api/auth/*`, M2M) → `[]` and set `tier: 'excluded'`

## `x-tier` exposure

- `primary` — exposed by MCP by default; target ≤ 45 across all modules
- `extended` — opt-in via env var; bulk ops, sysadmin, deep config
- `excluded` — never exposed (webhooks, M2M, deprecated)

Default heuristic:
- Webhooks, M2M, sysadmin routes → `excluded`
- Common CRUD on top entities (inspection, booking, template) → `primary`
- Admin, bulk, niche queries → `extended`
- When in doubt, prefer `extended` (promotion is easy later).

## Input field descriptions

Every Zod input schema field must carry `.describe('...')` with ≥ 10 chars:

```ts
// BEFORE (fails CI)
z.object({
    cursor: z.string().optional(),
    limit: z.number().min(1).max(100).optional(),
});

// AFTER
z.object({
    cursor: z.string().describe('Opaque pagination cursor from a previous response.').optional(),
    limit: z.number().min(1).max(100).describe('Page size, 1-100; defaults to 25.').optional(),
});
```

## Worked example

```ts
import { createRoute } from '@hono/zod-openapi';
import { withMcpMetadata } from '../lib/route-metadata-standards';

const listInspectionsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/api/inspections',
    operationId: 'listInspections',
    summary: 'List inspections in the current tenant',
    description: 'List inspections in the current tenant, newest first. Supports cursor pagination and filtering by status, inspectorId, propertyAddress.',
    tags: ['inspections'],
    request: {
        query: InspectionListQuerySchema,
    },
    responses: { /* ... */ },
}, { scopes: ['read'], tier: 'primary' }));
```
