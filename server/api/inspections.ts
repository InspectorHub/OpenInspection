// Inspections API aggregator.
//
// This module is intentionally thin: the ~90 inspection routes were split into
// focused sub-routers under `server/api/inspections/` (behavior-preserving — the
// handler bodies + route definitions are byte-identical to the original
// single-file router). Each route's `createRoute({...})` definition is
// co-located with its `.openapi()` handler in the owning sub-router, and each
// sub-router imports the dependencies it needs directly — there is no shared
// barrel module.
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
import mediaStudioRoutes from './inspections/media-studio';
import publishRoutes from './inspections/publish';
import reportDeliveryRoutes from './inspections/report-delivery';
import agreementsRoutes from './inspections/agreements';
import coreRoutes from './inspections/core';
import resultsRoutes from './inspections/results';
import collabRoutes from './inspections/collab';
import costExportRoutes from './inspections/cost-export';
import costItemRoutes from './inspections/cost-items';
import complianceRoutes from './inspections/compliance';

export const inspectionsRoutes = createApiRouter()
    .route('/', bulkRoutes)
    .route('/', templatesRoutes)
    .route('/', coreRoutes)
    .route('/', resultsRoutes)
    .route('/', mediaRoutes)
    .route('/', mediaStudioRoutes)
    .route('/', publishRoutes)
    .route('/', reportDeliveryRoutes)
    .route('/', agreementsRoutes)
    .route('/', hierarchyRoutes)
    // Commercial PCA Phase C — cost line CSV export (Task 11).
    .route('/', costExportRoutes)
    // Commercial PCA Phase C — cost_items CRUD + finding-seed (Task 13a).
    .route('/', costItemRoutes)
    // Commercial PCA Phase M — compliance API: dual sign-off/PSQ/doc-review/conformance (Task 6).
    .route('/', complianceRoutes)
    // Yjs collab WS upgrade route (#181) — GET /:id/collab/ws.
    // Auth + forward to INSPECTION_DOC DO; mirrors the presence WS pattern.
    .route('/', collabRoutes);

export type InspectionsApi = typeof inspectionsRoutes;

export default inspectionsRoutes;
