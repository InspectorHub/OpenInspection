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
// `/{id}/report-data`). `InspectionsApi` is derived from `inspectionsRouteParts`
// (see lib/api-schema.ts) for the `hono/client` consumers; a sub-router still
// written as a chain is listed with `legacyMounted`, which reads its schema
// from its own type. `server/index.ts` mounts `inspectionsRoutes` at
// `/api/inspections` unchanged.
//
// Mount order follows the original chain's first-appearance order of each group.
// Routing is order-independent here anyway: all 90 paths/methods are unique and
// Hono's router gives static segments priority over `:id` params regardless of
// registration order.
import { createApiRouter } from '../lib/openapi-router';
import { legacyMounted, mounted, type ApiOf } from '../lib/api-schema';
import templatesRoutes, { templatesRouteConfigs } from './inspections/templates';
import statutoryRoutes, { statutoryRouteConfigs } from './inspections/statutory';
import statutoryDetailsRoutes, { statutoryDetailsRouteConfigs } from './inspections/statutory-details';
import hierarchyRoutes, { hierarchyRouteConfigs } from './inspections/hierarchy';
import bulkRoutes, { bulkRouteConfigs } from './inspections/bulk';
import scheduleRoutes, { scheduleRouteConfigs } from './inspections/schedule';
import mediaRoutes, { mediaRouteConfigs } from './inspections/media';
import mediaUploadUrlRoutes, { mediaUploadUrlRouteConfigs } from './inspections/media-upload-url';
import mediaStudioRoutes, { mediaStudioRouteConfigs } from './inspections/media-studio';
import publishRoutes, { publishRouteConfigs } from './inspections/publish';
import reportGateRoutes, { reportGateRouteConfigs } from './inspections/report-gate';
import reportTranslationRoutes, { reportTranslationRouteConfigs } from './inspections/report-translation';
import reportDeliveryRoutes, { reportDeliveryRouteConfigs, reportMovedRoutes } from './inspections/report-delivery';
import sendSmsRoutes, { sendSmsRouteConfigs } from './inspections/send-sms';
import agreementsRoutes from './inspections/agreements';
// The in-person signing route, split out of agreements.ts at the 400-line
// ceiling. Mounted HERE beside its sibling rather than nested inside it, so the
// idempotency gate can resolve its path the same way it resolves every other —
// a router reached only through another router's re-export is a route the gate
// can see declared and cannot place.
import agreementSignRoutes from './inspections/agreement-sign';
import coreRoutes from './inspections/core';
import resultsRoutes, { resultsRouteConfigs } from './inspections/results';
import collabRoutes from './inspections/collab';
import costExportRoutes, { costExportRouteConfigs } from './inspections/cost-export';
import costItemRoutes, { costItemRouteConfigs } from './inspections/cost-items';
import complianceRoutes, { complianceRouteConfigs } from './inspections/compliance';
import peopleRoutes, { peopleRouteConfigs } from './inspections/people';
import communicationRoutes, { communicationRouteConfigs } from './inspections/communication';
import inspectionServiceRoutes, { inspectionServiceRouteConfigs } from './inspections/services';
import inspectionReportRoutes, { inspectionReportRouteConfigs } from './inspections/reports';
import paySplitRoutes, { paySplitRouteConfigs } from './inspections/pay-splits';
import cancellationRoutes, { cancellationRouteConfigs } from './inspections/cancellation';
import inspectionRepairRequestRoutes, { inspectionRepairRequestRouteConfigs } from './inspections/repair-requests';

export const inspectionsRoutes = createApiRouter();
inspectionsRoutes.route('/', bulkRoutes);
// Dispatch Phase C — PATCH /:id/schedule, the instant-authoritative
// reschedule + reassign write behind requireCapability('scheduleOthers').
inspectionsRoutes.route('/', scheduleRoutes);
inspectionsRoutes.route('/', templatesRoutes);
inspectionsRoutes.route('/', coreRoutes);
inspectionsRoutes.route('/', resultsRoutes);
inspectionsRoutes.route('/', mediaRoutes);
inspectionsRoutes.route('/', mediaUploadUrlRoutes);
inspectionsRoutes.route('/', mediaStudioRoutes);
inspectionsRoutes.route('/', publishRoutes);
inspectionsRoutes.route('/', reportGateRoutes);
inspectionsRoutes.route('/', reportTranslationRoutes);
inspectionsRoutes.route('/', reportDeliveryRoutes);
// The retired HTML report route (410 MOVED), a router of its own: see report-delivery.ts.
inspectionsRoutes.route('/', reportMovedRoutes);
// After the report-delivery routes: this one serves a FOURTH deliverable and
// shares their headers, not their file. See lib/deliverable-headers.ts.
inspectionsRoutes.route('/', statutoryRoutes);
// The inspection-level answers those forms ask for and nothing else does.
inspectionsRoutes.route('/', statutoryDetailsRoutes);
// Communication A3.4 — manual SMS via the shared sendOneSms TCPA core.
inspectionsRoutes.route('/', sendSmsRoutes);
// Communication design §2 — messages + platform notices, two arrays.
inspectionsRoutes.route('/', communicationRoutes);
inspectionsRoutes.route('/', agreementsRoutes);
inspectionsRoutes.route('/', agreementSignRoutes);
inspectionsRoutes.route('/', hierarchyRoutes);
// Commercial PCA Phase C — cost line CSV export (Task 11).
inspectionsRoutes.route('/', costExportRoutes);
// Commercial PCA Phase C — cost_items CRUD + finding-seed (Task 13a).
inspectionsRoutes.route('/', costItemRoutes);
// Commercial PCA Phase M — compliance API: dual sign-off/PSQ/doc-review/conformance (Task 6).
inspectionsRoutes.route('/', complianceRoutes);
// Yjs collab WS upgrade route (#181) — GET /:id/collab/ws.
// Auth + forward to INSPECTION_DOC DO; mirrors the presence WS pattern.
inspectionsRoutes.route('/', collabRoutes);
// Plan 1B Task 3 (people-role-profiles) — GET/POST/DELETE /:id/people.
inspectionsRoutes.route('/', peopleRoutes);
// IA-87 — POST/PATCH/DELETE /:id/services: the service lines on an
// inspection were write-once at creation until this router existed.
inspectionsRoutes.route('/', inspectionServiceRoutes);
// DELETE /:id/reports/:reportId — one order delivers several reports, and
// removing one destroys its document. The list itself rides the hub payload.
inspectionsRoutes.route('/', inspectionReportRoutes);
// #278 — /:id/pay-splits. Mounted HERE rather than as a top-level router
// because server/index.ts sits at its size cap; and it belongs here anyway,
// since every path is per-inspection. Visibility is query scoping inside
// the handler, not a capability: an inspector reads only their own row.
inspectionsRoutes.route('/', paySplitRoutes);
// /:id/cancellation-quote + /:id/cancel + /:id/uncancel — the cancellation
// axis in both directions. Split out of publish.ts: the report lifecycle
// and the cancellation state (plus the money it moves) are different
// concerns, and that file was at its size ceiling. Order-independent, as
// above: all three paths are unique and end in a static segment.
inspectionsRoutes.route('/', cancellationRoutes);
// #69 — GET /:id/repair-requests, the Repair Request Log. The lists it
// reads are WRITTEN through /api/public/repair-builder, which authenticates
// a client's token; this read is staff-only and cannot live there.
inspectionsRoutes.route('/', inspectionRepairRequestRoutes);

/** Registration order, mounts included. Drives `InspectionsApi`; a test pins it to what `inspectionsRoutes` really registered. */
export const inspectionsRouteParts = [
    mounted('/', bulkRoutes, bulkRouteConfigs),
    mounted('/', scheduleRoutes, scheduleRouteConfigs),
    mounted('/', templatesRoutes, templatesRouteConfigs),
    legacyMounted('/', coreRoutes),
    mounted('/', resultsRoutes, resultsRouteConfigs),
    mounted('/', mediaRoutes, mediaRouteConfigs),
    mounted('/', mediaUploadUrlRoutes, mediaUploadUrlRouteConfigs),
    mounted('/', mediaStudioRoutes, mediaStudioRouteConfigs),
    mounted('/', publishRoutes, publishRouteConfigs),
    mounted('/', reportGateRoutes, reportGateRouteConfigs),
    mounted('/', reportTranslationRoutes, reportTranslationRouteConfigs),
    mounted('/', reportDeliveryRoutes, reportDeliveryRouteConfigs),
    legacyMounted('/', reportMovedRoutes),
    mounted('/', statutoryRoutes, statutoryRouteConfigs),
    mounted('/', statutoryDetailsRoutes, statutoryDetailsRouteConfigs),
    mounted('/', sendSmsRoutes, sendSmsRouteConfigs),
    mounted('/', communicationRoutes, communicationRouteConfigs),
    legacyMounted('/', agreementsRoutes),
    legacyMounted('/', agreementSignRoutes),
    mounted('/', hierarchyRoutes, hierarchyRouteConfigs),
    mounted('/', costExportRoutes, costExportRouteConfigs),
    mounted('/', costItemRoutes, costItemRouteConfigs),
    mounted('/', complianceRoutes, complianceRouteConfigs),
    legacyMounted('/', collabRoutes),
    mounted('/', peopleRoutes, peopleRouteConfigs),
    mounted('/', inspectionServiceRoutes, inspectionServiceRouteConfigs),
    mounted('/', inspectionReportRoutes, inspectionReportRouteConfigs),
    mounted('/', paySplitRoutes, paySplitRouteConfigs),
    mounted('/', cancellationRoutes, cancellationRouteConfigs),
    mounted('/', inspectionRepairRequestRoutes, inspectionRepairRequestRouteConfigs),
] as const;

export type InspectionsApi = ApiOf<typeof inspectionsRouteParts>;
