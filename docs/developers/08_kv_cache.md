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

## All KV Key Patterns (standalone)

| Key pattern | Written by | Read by | TTL |
|---|---|---|---|
| `global_tenant:{tenantId}` | Fixed-tenant resolver | Fixed-tenant resolver (every request) | 3600s |
| `pwchanged:{userId}` | Password change/reset handlers | Auth middleware (JWT validation) | None |
| `qbo_oauth_state:{state}` | QBO OAuth initiation | QBO OAuth callback | 600s |
| `google_token:{tenantId}:{userId}` | Google Calendar OAuth | Calendar API calls | 3500s |
| `places:{hash}` | Google Places proxy | Address autocomplete | 3600s |

> SaaS mode adds subdomain/silo routing keys (`tenant:{subdomain}`, `silo:{tenantId}`,
> `sso:{code}`); those are not used by a standalone deploy.

## Why Not Alternatives?

| Alternative | Why it doesn't work |
|---|---|
| D1 on every request | Latency + D1 read quota on pure routing overhead |
| Module-level `Map` cache | Resets on cold starts; not shared across parallel Worker instances |
| Cache API | HTTP response caching only — not for key-value data |
| Durable Objects | Overkill for simple caching; more expensive |
| JWT claims only | JWT doesn't carry live `tier`/`status` — a suspended tenant could reuse a valid JWT |

The last point is the key security reason: **tier and status must be verified server-side on every request**, not trusted from the JWT.
