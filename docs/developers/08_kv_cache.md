# KV Cache — Why and How

`TENANT_CACHE` is a Cloudflare KV namespace used to avoid repeated D1 queries on hot paths.

## Tenant Routing Cache (`tenant:{subdomain}`)

Every request needs to know which tenant it belongs to. Without caching, that's a D1 query on every request.

KV reads are served from the nearest edge location — effectively zero latency. A 1-hour TTL balances freshness with efficiency. When tenant state changes (e.g., Stripe webhook activates/suspends), the cache is explicitly invalidated.

### Cache invalidation

`POST /api/admin/tenant-status` (called by portal after Stripe events) deletes the KV key:

```typescript
await c.env.TENANT_CACHE.delete(`tenant:${subdomain}`);
```

### Data stored

```
Key:   "tenant:john"
Value: { "id": "uuid", "subdomain": "john", "tier": "pro", "status": "active" }
TTL:   3600 seconds (1 hour)
```

Written non-blocking via `c.executionCtx.waitUntil()`.

## All KV Key Patterns

| Key pattern | Written by | Read by | TTL |
|---|---|---|---|
| `tenant:{subdomain}` | Tenant router on cache miss | Tenant router (every request) | 3600s |
| `global_tenant:{tenantId}` | Fixed-tenant resolver (standalone mode) | Fixed-tenant resolver | 3600s |
| `silo:{tenantId}` | `POST /api/admin/silo` (portal m2m) | Silo middleware | None |
| `pwchanged:{userId}` | Password change/reset handlers | Auth middleware (JWT validation) | None |
| `setup_verification_code` | Setup wizard | Setup endpoint | 3600s |
| `sso:{code}` | Portal SSO handoff | `GET /sso?code=` | Short |
| `qbo_oauth_state:{state}` | QBO OAuth initiation | QBO OAuth callback | 600s |
| `google_token:{tenantId}:{userId}` | Google Calendar OAuth | Calendar API calls | 3500s |
| `places:{hash}` | Google Places proxy | Address autocomplete | 3600s |

## Why Not Alternatives?

| Alternative | Why it doesn't work |
|---|---|
| D1 on every request | Latency + D1 read quota on pure routing overhead |
| Module-level `Map` cache | Resets on cold starts; not shared across parallel Worker instances |
| Cache API | HTTP response caching only — not for key-value data |
| Durable Objects | Overkill for simple caching; more expensive |
| JWT claims only | JWT doesn't carry live `tier`/`status` — a suspended tenant could reuse a valid JWT |

The last point is the key security reason: **tier and status must be verified server-side on every request**, not trusted from the JWT.
