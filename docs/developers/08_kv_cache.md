---
domain: "Tenant Routing & KV Cache"
related_code_paths: ["apps/core/src/features/tenant-routing/", "apps/core/src/index.ts", "apps/core/src/api/admin.ts"]
---

# KV Cache — Why and How

`TENANT_CACHE` is a Cloudflare KV namespace used for two distinct purposes: tenant routing cache and silo database routing. Both avoid repeated D1 queries on the hot path.

---

## Purpose 1 — Tenant Routing Cache (`tenant:{subdomain}`)

### The problem

Every request — page loads, API calls, assets — needs to know which tenant it belongs to. The tenant-routing middleware resolves this from the `Host` header subdomain (in the subdomain branch). Without caching that means a D1 query on **every request**:

```
GET john.inspectorhub.com/api/inspections
  → SELECT * FROM tenants WHERE subdomain = 'john'  ← D1 round-trip on every call
```

At scale this is expensive: 10,000 requests/month per tenant × 1,000 tenants = 10M D1 reads consumed purely by routing overhead, before any real query runs.

### What KV provides

- Reads are served from the **nearest Cloudflare edge location** to the user — effectively zero added latency
- Shared across all Worker instances globally — unlike module-level variables, which reset on cold starts and are not shared between the many parallel instances Cloudflare runs
- A 5-minute TTL is the right trade-off: tenant data (tier, status) rarely changes mid-session, and when it does (e.g. a Stripe webhook activates or suspends a subscription) the cache is explicitly invalidated

### Cache invalidation

`POST /api/admin/tenant-status` (called by portal after every Stripe event) deletes the KV key immediately:

```typescript
await c.env.TENANT_CACHE.delete(`tenant:${subdomain}`);
```

The next request for that subdomain triggers a fresh D1 lookup and repopulates the cache.

### Data stored

```
Key:   "tenant:john"
Value: { "id": "uuid", "subdomain": "john", "tier": "pro", "status": "active" }
TTL:   300 seconds (5 minutes)
```

Written non-blocking via `c.executionCtx.waitUntil()` so the cache write never adds latency to the response.

---

## Purpose 2 — Silo Database Routing (`silo:{tenantId}`)

### The problem

Enterprise tenants with dedicated D1 databases need the worker to know *which* database to use before any query runs. This mapping must be available globally and immediately, without requiring a D1 query (which would be circular — you need to know the DB before you can query it).

### What KV provides

- A fast, globally consistent lookup of `siloDbId` per tenant
- Written once by `POST /api/admin/silo` (m2m call from portal sysadmin) when a silo is provisioned
- Read on every request for that tenant by the silo middleware in `src/index.ts`
- No TTL — silo assignments are permanent

### Data stored

```
Key:   "silo:550e8400-e29b-41d4-a716-446655440000"
Value: "d1db-id-abc123"
TTL:   none (permanent)
```

### How silo routing uses it

```typescript
// src/index.ts — silo middleware
const siloDbId = await c.env.TENANT_CACHE.get(`silo:${tenantId}`);
if (siloDbId) {
    (c.env as any).DB = new D1HttpDatabase(c.env.CF_ACCOUNT_ID, c.env.CF_API_TOKEN, siloDbId);
}
```

All downstream Drizzle queries transparently target the tenant's isolated database without any code changes in route handlers.

---

## Why Not the Alternatives?

| Alternative | Why it doesn't work |
|---|---|
| **D1 on every request** | Adds latency + burns D1 read quota on pure routing overhead |
| **Module-level `Map` cache** | Resets on cold starts; not shared between the many parallel Worker instances Cloudflare runs simultaneously |
| **Cache API** | HTTP response caching only — not suitable for arbitrary key-value data |
| **Durable Objects** | Strong consistency + stateful coordination not needed here; significantly more expensive |
| **JWT claims only** | JWT carries `tenantId` but not live `tier`/`status` — a suspended tenant could reuse a valid JWT without a server-side status check |

The last point is the most important security reason: **tier and status must be verified from a server-side source on every request**, not trusted from the JWT. The JWT is issued at login and may be hours old. KV gives a fresh, low-latency read of live subscription state without paying full D1 query cost on every request.

---

## KV Key Summary

| Key pattern | Written by | Read by | TTL |
|---|---|---|---|
| `tenant:{subdomain}` | `tenantRouter` (subdomain branch) on cache miss | `tenantRouter` (subdomain branch) on every request | 300s |
| `silo:{tenantId}` | `POST /api/admin/silo` (portal m2m) | Silo middleware in `index.ts` | None |
