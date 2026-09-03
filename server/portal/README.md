# Portal Integration (SaaS only)

Optional integration with the InspectorHub SaaS control plane. **Active only when
`APP_MODE=saas`** (declared in `wrangler.saas.jsonc`). The worker entry
(`workers/app.ts`) returns 404 for `/api/platform/*` otherwise, and the outbox
publishes only when the `SYNC_QUEUE` producer binding is present. A self-host
build (default `wrangler.jsonc`) executes none of this directory.

Since 2026-06-04 core holds **no Service Binding to portal** (the old binding's
last functional use — the outbox drain POST — was replaced by a Cloudflare Queue,
`inspectorhub-sync-saas`). Direction of traffic today:

- **core → portal**: CloudEvents envelopes on the sync queue (outbox sweeper +
  inline publish). The DLQ (`inspectorhub-sync-dlq-saas`) is consumed by this
  worker to mark failed outbox rows.
- **portal → core**: request/response M2M over portal's own `CORE_SERVICE`
  binding into `integration.routes.ts`, guarded by the `x-portal-m2m` HMAC.

Core code depends only on abstractions — `IntegrationProvider`
(`StandaloneProvider` is the self-host impl) and `UserSyncOutbox`
(`server/lib/integration/user-sync.ts`). The concrete classes here are wired in at
a single composition point, `server/lib/middleware/di.ts` — the outbox when
`SYNC_QUEUE` is bound, the SaaS provider when `APP_MODE=saas`.

To produce a portal-free build: delete this directory, the
`registerPortalIntegration(app)` call in `server/index.ts`, the
`drainPortalOutbox` call in `server/scheduled.ts`, the `PortalProvider` +
`OutboxService` branches in `server/lib/middleware/di.ts` (fall back to
`StandaloneProvider` + leave `outbox` undefined), and the `/api/platform/*`
guard in `workers/app.ts`.

Detailed integration docs live in the super-project `docs/saas-ops/`.

| File | Purpose |
|---|---|
| `integration.module.ts` | The seam: `registerPortalIntegration` + the outbox sweeper + DLQ writeback |
| `integration.routes.ts` | portal→core M2M routes (tenant sync/update, SSO handoff, data export, purge, seat-quota sync, starter-content seed, template backfill, sync-health/redrive) |
| `statutory-admin.routes.ts` | portal→core M2M routes for the statutory catalogue: who is on which revision, how many documents one revision produced, and delisting a catalogue entry. Separate from the file above because those routes are one tenant's lifecycle and these are the catalogue's |
| `outbox.service.ts` | core→portal async event sync over the queue (implements `UserSyncOutbox`) |
| `portal.provider.ts` | `IntegrationProvider` impl for SaaS |
| `service-binding-guard.ts` | `x-portal-m2m` HMAC guard for the M2M routes |
