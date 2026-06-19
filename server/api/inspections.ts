// Inspections API aggregator.
//
// This module is intentionally thin: the ~90 inspection routes were split into
// focused sub-routers under `server/api/inspections/` (behavior-preserving — the
// handler bodies are byte-identical to the original single-file router). Shared
// route definitions, inline schemas, and dependency re-exports live in
// `./inspections/_shared.ts`.
//
// The sub-routers are mounted at `/` so the external path surface is IDENTICAL
// to the original chain (every route path is absolute, e.g. `/dashboard`,
// `/{id}/report-data`). Hono merges each sub-router's OpenAPI + RPC types, so
// `typeof inspectionsRoutes` (exported as `InspectionsApi`) is preserved for the
// `hono/client` consumers. `server/index.ts` mounts this default export at
// `/api/inspections` unchanged.
//
// Mount order follows the original chain's first-appearance order of each group.
// Routing is order-independent here anyway: all 90 paths/methods are unique and
// Hono's router gives static segments priority over `:id` params regardless of
// registration order.
import { createApiRouter } from '../lib/openapi-router';
import templatesRoutes from './inspections/templates';
import hierarchyRoutes from './inspections/hierarchy';
import bulkRoutes from './inspections/bulk';
import mediaRoutes from './inspections/media';
import publishRoutes from './inspections/publish';
import coreRoutes from './inspections/core';

export const inspectionsRoutes = createApiRouter()
    .route('/', bulkRoutes)
    .route('/', templatesRoutes)
    .route('/', coreRoutes)
    .route('/', mediaRoutes)
    .route('/', publishRoutes)
    .route('/', hierarchyRoutes);

export type InspectionsApi = typeof inspectionsRoutes;

export default inspectionsRoutes;
