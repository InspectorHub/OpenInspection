# KV Cache — Why and How

`TENANT_CACHE` is a Cloudflare KV namespace used to avoid repeated D1 queries on hot paths.

## Tenant resolution cache (`global_tenant:{tenantId}`)

Every request needs to know which tenant it belongs to. In a standalone (self-hosted)
deploy there is exactly one tenant — pinned by `SINGLE_TENANT_ID` — so the fixed-tenant
resolver caches that profile under `global_tenant:{tenantId}` instead of hitting D1 on every
request.

KV reads are served from the nearest edge location — effectively zero latency. A 1-hour TTL
balances freshness with efficiency.

### Data stored

```
Key:   "global_tenant:00000000-0000-0000-0000-000000000000"
Value: { "id": "uuid", "tier": "...", "status": "active", ... }
TTL:   3600 seconds (1 hour)
```

Written non-blocking via `c.executionCtx.waitUntil()`.

## The main KV key patterns (standalone)

⚠️ **This table is not exhaustive and has never been gated.** It was headed "All
KV Key Patterns" for a long time while carrying a key that does not exist
(`google_token:…`) and a wrong shape for another, so treat it as a guide to the
load-bearing ones and grep for the rest. New keys arrive without anything
failing.

| Key pattern | Written by | Read by | TTL |
|---|---|---|---|
| `global_tenant:{tenantId}` | Fixed-tenant resolver | Fixed-tenant resolver (every request) | 3600s |
| `pwchanged:{userId}` | Password change/reset handlers | Auth middleware (JWT validation) | None |
| `pw_reset:{token}` | Password-reset request | Password-reset redeem | 3600s, one-time |
| `agent_view_token:{token}` | Agent report-share link mint | The shared-report reader | 30 days |
| `qbo_oauth_state:{state}` | QBO OAuth initiation | QBO OAuth callback | 600s |
| `places:auto:{sha256(query)}` · `places:detail:{placeId}` | Google Places proxy | Address autocomplete | 3600s |
| `intsecrets:{tenantId}` | Integration-secrets middleware (on D1 read) | Every /api request (decrypted tenant secrets) | 300s — invalidated on PUT/POST /api/admin/secrets |
| `branding:{tenantId}` | Branding middleware (on D1 read) | Page renders / email pipeline | 3600s — invalidated on branding update |
| `cron:cursor:{job}` · `cron:lastrun:{job}` | The cron queue consumer | The next run of the same job | None — bookkeeping, see [architecture](../develop/architecture.md#background-work) |
| `msg_notify:contact:{address}` | Transactional email dispatch | The same, as a send throttle | short-lived |

> SaaS mode adds subdomain/silo routing keys (`tenant:{subdomain}`, `silo:{tenantId}`,
> `sso:{code}`); those are not used by a standalone deploy.
>
> `OAUTH_KV` is a **second, separate namespace**, owned by
> `@cloudflare/workers-oauth-provider` and holding MCP OAuth grants. Nothing in
> this document applies to it: the library owns its key shapes and its binding
> name cannot be changed.

## Why Not Alternatives?

| Alternative | Why it doesn't work |
|---|---|
| D1 on every request | Latency + D1 read quota on pure routing overhead |
| Module-level `Map` cache | Resets on cold starts; not shared across parallel Worker instances |
| Cache API | HTTP response caching only — not for key-value data |
| Durable Objects | Overkill for simple caching; more expensive |
| JWT claims only | JWT doesn't carry live `tier`/`status` — a suspended tenant could reuse a valid JWT |

The last point is the key security reason: **tier and status must be verified server-side on every request**, not trusted from the JWT.
