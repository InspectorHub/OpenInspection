# Portal Integration (SaaS Only)

This directory contains code that integrates Core with the InspectorHub SaaS Portal.
It is only active when deployed with `wrangler.saas.toml` (which declares the
`PORTAL_SERVICE` Service Binding).

**Self-hosted users: do not modify files in this directory.**

In standalone deployments (the default `wrangler.toml`), none of this code
executes — the Service Binding is absent and all portal-related code paths
are guarded by `if (env.PORTAL_SERVICE)` checks.

## Files

| File | Purpose |
|------|---------|
| `service-binding-guard.ts` | Middleware that verifies requests arrive via Service Binding (`cf-worker` header) |
| `integration.routes.ts` | Hono routes for portal→core M2M calls (tenant sync, SSO handoff, data export, purge) |
| `outbox.service.ts` | Core→portal async event sync (user lifecycle events) |
| `portal.provider.ts` | `IntegrationProvider` implementation for SaaS mode |
