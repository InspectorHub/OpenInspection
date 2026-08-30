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
import statutoryRoutes from './inspections/statutory';
import statutoryDetailsRoutes from './inspections/statutory-details';
import hierarchyRoutes from './inspections/hierarchy';
import bulkRoutes from './inspections/bulk';
import scheduleRoutes from './inspections/schedule';
import mediaRoutes from './inspections/media';
import mediaStudioRoutes from './inspections/media-studio';
import publishRoutes from './inspections/publish';
import reportGateRoutes from './inspections/report-gate';
import reportTranslationRoutes from './inspections/report-translation';
import reportDeliveryRoutes from './inspections/report-delivery';
import sendSmsRoutes from './inspections/send-sms';
import agreementsRoutes from './inspections/agreements';
// The in-person signing route, split out of agreements.ts at the 400-line
// ceiling. Mounted HERE beside its sibling rather than nested inside it, so the
// idempotency gate can resolve its path the same way it resolves every other —
// a router reached only through another router's re-export is a route the gate
// can see declared and cannot place.
import agreementSignRoutes from './inspections/agreement-sign';
import coreRoutes from './inspections/core';
import resultsRoutes from './inspections/results';
import collabRoutes from './inspections/collab';
import costExportRoutes from './inspections/cost-export';
import costItemRoutes from './inspections/cost-items';
import complianceRoutes from './inspections/compliance';
import peopleRoutes from './inspections/people';
import communicationRoutes from './inspections/communication';
import inspectionServiceRoutes from './inspections/services';
import inspectionReportRoutes from './inspections/reports';
import paySplitRoutes from './inspections/pay-splits';
import cancellationRoutes from './inspections/cancellation';
import inspectionRepairRequestRoutes from './inspections/repair-requests';

export const inspectionsRoutes = createApiRouter()
    .route('/', bulkRoutes)
    // Dispatch Phase C — PATCH /:id/schedule, the instant-authoritative
    // reschedule + reassign write behind requireCapability('scheduleOthers').
    .route('/', scheduleRoutes)
    .route('/', templatesRoutes)
    .route('/', coreRoutes)
    .route('/', resultsRoutes)
    .route('/', mediaRoutes)
    .route('/', mediaStudioRoutes)
    .route('/', publishRoutes)
    .route('/', reportGateRoutes)
    .route('/', reportTranslationRoutes)
    .route('/', reportDeliveryRoutes)
    // After the report-delivery routes: this one serves a FOURTH deliverable and
    // shares their headers, not their file. See lib/deliverable-headers.ts.
    .route('/', statutoryRoutes)
    // The inspection-level answers those forms ask for and nothing else does.
    .route('/', statutoryDetailsRoutes)
    // Communication A3.4 — manual SMS via the shared sendOneSms TCPA core.
    .route('/', sendSmsRoutes)
    // Communication design §2 — messages + platform notices, two arrays.
    .route('/', communicationRoutes)
    .route('/', agreementsRoutes)
    .route('/', agreementSignRoutes)
    .route('/', hierarchyRoutes)
    // Commercial PCA Phase C — cost line CSV export (Task 11).
    .route('/', costExportRoutes)
    // Commercial PCA Phase C — cost_items CRUD + finding-seed (Task 13a).
    .route('/', costItemRoutes)
    // Commercial PCA Phase M — compliance API: dual sign-off/PSQ/doc-review/conformance (Task 6).
    .route('/', complianceRoutes)
    // Yjs collab WS upgrade route (#181) — GET /:id/collab/ws.
    // Auth + forward to INSPECTION_DOC DO; mirrors the presence WS pattern.
    .route('/', collabRoutes)
    // Plan 1B Task 3 (people-role-profiles) — GET/POST/DELETE /:id/people.
    .route('/', peopleRoutes)
    // IA-87 — POST/PATCH/DELETE /:id/services: the service lines on an
    // inspection were write-once at creation until this router existed.
    .route('/', inspectionServiceRoutes)
    // DELETE /:id/reports/:reportId — one order delivers several reports, and
    // removing one destroys its document. The list itself rides the hub payload.
    .route('/', inspectionReportRoutes)
    // #278 — /:id/pay-splits. Mounted HERE rather than as a top-level router
    // because server/index.ts sits at its size cap; and it belongs here anyway,
    // since every path is per-inspection. Visibility is query scoping inside
    // the handler, not a capability: an inspector reads only their own row.
    .route('/', paySplitRoutes)
    // /:id/cancellation-quote + /:id/cancel + /:id/uncancel — the cancellation
    // axis in both directions. Split out of publish.ts: the report lifecycle
    // and the cancellation state (plus the money it moves) are different
    // concerns, and that file was at its size ceiling. Order-independent, as
    // above: all three paths are unique and end in a static segment.
    .route('/', cancellationRoutes)
    // #69 — GET /:id/repair-requests, the Repair Request Log. The lists it
    // reads are WRITTEN through /api/public/repair-builder, which authenticates
    // a client's token; this read is staff-only and cannot live there.
    .route('/', inspectionRepairRequestRoutes);

export type InspectionsApi = typeof inspectionsRoutes;
