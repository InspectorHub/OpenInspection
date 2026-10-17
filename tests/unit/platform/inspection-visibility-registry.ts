/**
 * Where each read of inspection-derived data gets its visibility rule from.
 *
 * Data for tests/unit/platform/inspection-visibility-registry.spec.ts, which fails when a route
 * or an API file is not declared here, when a declaration names something that no longer exists,
 * and when `viewAllInspections` becomes writable while any entry is still pending.
 *
 * Three layers watch three different things, because each alone has a blind spot:
 *   - the ROUTE TABLE: every route under /api/inspections/:id is behind the path guard, and every
 *     other route that carries an inspection id (or sits on a data prefix and reads) is listed below;
 *   - the SOURCE of server/api: every file that imports an inspection-derived table is classified;
 *   - the SIGNATURES of the service methods that return sets (visibility-set-reads.spec-d.ts).
 */
export type Rule =
    | 'guarded-by-path'     // under /api/inspections/:id, covered by the path guard
    | 'scoped-service'      // the service takes a required InspectionScope
    | 'handler-assert'      // the handler asserts the inspection is visible
    | 'projection'          // returns a reduced shape to the caller's tier
    | 'capability-gated'    // needs scheduleOthers, which a restricted inspector never holds
    | 'company-open-staff'  // company-level data every staff role may read; carries no inspection rows
    | 'admin-only'          // owner or manager only (the administrator tier is never narrowed)
    | 'self-only'           // returns only what belongs to the caller
    | 'public-token'        // reached by a token the recipient holds, not by a staff session
    | 'no-inspection-data'; // not inspection-derived data at all

export interface Entry { rule: Rule; status: 'enforced' | 'pending'; reason: string }

const E = (rule: Rule, reason: string): Entry => ({ rule, status: 'enforced', reason });
const P = (rule: Rule, reason: string): Entry => ({ rule, status: 'pending', reason });

/** Routes outside /api/inspections/:id/** that read or act on inspection-derived data. Key: "METHOD /hono/path". */
export const SET_READS: Record<string, Entry> = {
    // The inspection collection, behind its own role gate and the required scope.
    'GET /api/inspections': E('scoped-service', 'listInspections(scope)'),
    'GET /api/inspections/counts': E('scoped-service', 'getCounts(scope)'),
    'GET /api/inspections/dashboard': E('scoped-service', 'getDashboardBuckets(scope)'),
    'GET /api/inspections/inspectors': E('capability-gated', 'scheduleOthers, normalised off for a restricted inspector'),
    'PATCH /api/inspections/bulk': E('capability-gated', 'scheduleOthers, normalised off for a restricted inspector'),
    'GET /api/inspections/schedule-conflicts': E('self-only', 'another inspector needs scheduleOthers; the caller sees their own roster'),
    'GET /api/inspections/templates': E('company-open-staff', 'templates are company assets'),
    'GET /api/inspections/templates/duplicates': E('company-open-staff', 'templates are company assets'),
    'GET /api/inspections/templates/:id': E('company-open-staff', 'templates are company assets'),

    // Contacts and conversations.
    'GET /api/contacts': E('scoped-service', 'contacts of visible inspections, plus the ones the caller created'),
    'GET /api/contacts/:id': E('scoped-service', 'same rule as the list'),
    'GET /api/contacts/:id/access': E('scoped-service', 'same rule as the list'),
    'GET /api/messages/threads': E('scoped-service', 'messages of visible inspections only'),
    'GET /api/messages/threads/:contactId': E('scoped-service', 'messages of visible inspections only; marks only those read'),
    'POST /api/messages/threads/:contactId': E('handler-assert', 'an inspection mention must be visible'),
    'GET /api/messages/unread-count': E('scoped-service', 'same rule as the threads'),

    // Analytics, money, events, requests.
    'GET /api/analytics/growth': E('scoped-service', 'counts visible inspections'),
    'GET /api/analytics/findings-heatmap': E('scoped-service', 'rated items of visible inspections'),
    'GET /api/metrics': E('scoped-service', 'a restricted caller gets the own-row view, never company totals'),
    'GET /api/invoices': E('scoped-service', 'invoices of visible inspections'),
    'GET /api/invoices/:id/payments': E('handler-assert', 'the invoice must belong to a visible inspection'),
    'POST /api/invoices/:id/payments': E('handler-assert', 'the invoice must belong to a visible inspection'),
    'POST /api/invoices/:id/payments/:paymentId/corrections': E('handler-assert', 'the invoice must belong to a visible inspection'),
    'PUT /api/events/:id': E('handler-assert', 'the event row names an inspection that must be visible'),
    'DELETE /api/events/:id': E('admin-only', 'requireRole(owner, manager)'),
    'GET /api/inspection-requests': E('scoped-service', 'requests with at least one visible inspection'),
    'GET /api/inspection-requests/:id': E('scoped-service', 'same rule as the list'),
    'GET /api/inspection-requests/by-inspection/:inspectionId': E('handler-assert', 'the inspection must be visible'),
    'POST /api/inspection-requests/:id/inspections': E('admin-only', 'requireRole(owner, manager)'),
    'GET /api/tags': E('company-open-staff', 'the tag vocabulary with a usage count per tag; no inspection ids'),
    'GET /api/tags/:id/inspections': E('scoped-service', 'inspection ids reduced to the visible set'),
    'GET /api/admin/sms/consent': E('handler-assert', 'the inspection must be visible'),
    'GET /api/team/members': P('projection', 'non-administrators get id, name and role (and email with scheduleOthers)'),

    // Calendar and schedule. Aligning these with the list belongs with the change that opens the write surface.
    'GET /api/calendar/events': E('scoped-service', 'local inspections cut to the visible set'),
    'GET /api/calendar/items': P('self-only', 'forced to the caller for a non-administrator; reconciled with the list later'),
    'GET /api/calendar/dispatch': E('capability-gated', 'scheduleOthers, normalised off for a restricted inspector'),
    'GET /api/schedule/week-summary': P('self-only', 'forced to the caller for a non-administrator; reconciled with the list later'),
    'GET /api/schedule/day-slots': E('capability-gated', 'scheduleOthers, normalised off for a restricted inspector'),
    'GET /api/calendar/blocks': E('no-inspection-data', 'personal time blocks'),
    'GET /api/calendar/ics-links': E('self-only', 'the caller own feed links'),
    'GET /api/calendar/status': E('no-inspection-data', 'calendar connection state'),
    'GET /api/calendar/read-set': E('no-inspection-data', 'calendar connection state'),
    'GET /api/calendar/connect': E('no-inspection-data', 'starts the calendar OAuth flow'),
    'GET /api/calendar/callback': E('no-inspection-data', 'calendar OAuth redirect'),
    'GET /api/ics/inspector/:token': E('self-only', 'the token resolves to one user and that user own roster'),
    'GET /api/ics/:token': E('self-only', 'the token resolves to one user and that user own roster'),

    // Exports and company-level reads that are owner/manager only.
    'GET /api/data/export/inspections': E('admin-only', 'requireRole(owner, manager)'),
    'GET /api/data/export/contacts': E('admin-only', 'requireRole(owner, manager)'),
    'GET /api/admin/export': E('admin-only', 'requireRole(owner, manager)'),
    'GET /api/audit/entity/:entityId': E('admin-only', 'requireRole(owner, manager)'),
    'GET /api/automations/logs/recent': E('admin-only', 'requireRole(owner, manager)'),
    'GET /api/admin/agreements/requests': E('admin-only', 'requireRole(owner, manager)'),
    'GET /api/admin/agreements/requests/:id': E('admin-only', 'requireRole(owner, manager)'),
    'POST /api/team/payroll-export': E('admin-only', 'requireRole(owner, manager) and companyFinance'),
    'GET /api/usage/summary': E('company-open-staff', 'lifetime capacity figures; no inspection rows'),
    'GET /api/billing/summary': E('admin-only', 'requireRole(owner, manager)'),
    'GET /api/agent/leaderboard': E('admin-only', 'requireRole(owner, manager)'),
};

/**
 * Every server/api file that imports a table holding inspection-derived rows, with the rule that
 * covers what it serves. A new file that imports one of those tables fails the registry spec until
 * somebody classifies it, which is the point.
 */
export const API_FILE_CLASSIFICATION: Record<string, Entry> = {
    // Under /api/inspections/:id behind the path guard (or helpers used only by routes that are).
    'server/api/inspection-sync.ts': E('guarded-by-path', 'every route is /api/inspections/{id}/...'),
    'server/api/inspections/act-guard.ts': E('guarded-by-path', 'helper for roster checks on /{id} routes; also used by request-payment, which checks the roster itself'),
    'server/api/inspections/agreement-sign.ts': E('guarded-by-path', '/{id}/... routes'),
    'server/api/inspections/agreements.ts': E('guarded-by-path', '/{id}/agreement-requests'),
    'server/api/inspections/communication.ts': E('guarded-by-path', '/{id}/communication'),
    'server/api/inspections/compliance.ts': E('guarded-by-path', '/{id}/compliance routes'),
    'server/api/inspections/core-access.ts': E('guarded-by-path', 'guards for PATCH and DELETE /{id}'),
    'server/api/inspections/cost-export.ts': E('guarded-by-path', '/{id}/cost routes'),
    'server/api/inspections/cost-items.ts': E('guarded-by-path', '/{id}/cost-items routes'),
    'server/api/inspections/hierarchy.ts': E('guarded-by-path', '/{id}/units and /{id}/versions'),
    'server/api/inspections/people.ts': E('guarded-by-path', '/{id}/people routes'),
    'server/api/inspections/publish.ts': E('guarded-by-path', '/{id}/publish routes'),
    'server/api/inspections/repair-requests.ts': E('guarded-by-path', '/{id}/repair-requests'),
    'server/api/inspections/report-delivery.ts': E('guarded-by-path', '/{id}/hub and /{id}/recipients'),
    'server/api/inspections/report-send-guards.ts': E('guarded-by-path', 'helper for the send routes under /{id}'),
    'server/api/inspections/results.ts': E('guarded-by-path', '/{id}/results routes'),
    'server/api/inspections/schedule.ts': E('guarded-by-path', '/{id}/schedule; the board is capability-gated'),
    'server/api/inspections/send-sms.ts': E('guarded-by-path', '/{id}/send-sms'),
    'server/api/inspections/core.ts': E('guarded-by-path', '/{id} routes, plus the create and wizard routes (creator rule)'),
    // The collection itself.
    'server/api/inspections/bulk.ts': E('scoped-service', 'list, counts and dashboard take the scope; bulk update and the inspector list are capability-gated'),
    // Staff-readable, outside the family.
    'server/api/calendar-events.ts': E('scoped-service', 'GET / is cut to the visible set'),
    'server/api/calendar-items.ts': P('self-only', 'forced to the caller for a non-administrator; the dispatch board is capability-gated'),
    'server/api/invoices.ts': E('scoped-service', 'the list is cut to visible inspections; mutations are owner/manager'),
    'server/api/metrics.ts': E('scoped-service', 'a restricted caller gets the own-row view'),
    'server/api/usage.ts': E('company-open-staff', 'lifetime capacity counters'),
    'server/api/ics.ts': E('self-only', 'a token resolves to one user and that user own roster'),
    'server/api/sms.ts': E('handler-assert', 'public opt-in and webhooks are token-driven; GET /sms/consent asserts visibility; the rest is owner/manager'),
    'server/api/agent.ts': E('self-only', 'the agent portal is keyed to the signed-in agent account; the leaderboard is owner/manager'),
    // Admin-only.
    'server/api/admin/admin-esign.ts': E('admin-only', 'every route is requireRole(owner, manager)'),
    'server/api/admin/admin-finding-keys.ts': E('admin-only', 'requireRole(owner)'),
    // Reached by a token the recipient holds.
    'server/api/bookings/agreement.ts': E('public-token', 'signing and checkout tokens'),
    'server/api/public-report.ts': E('public-token', 'published report links'),
    'server/api/public-share.ts': E('public-token', 'share tokens'),
    'server/api/public/deposit-intent.ts': E('public-token', 'checkout token'),
    'server/api/public/uploads.ts': E('public-token', 'upload token'),
    'server/api/public/verify.ts': E('public-token', 'envelope verification'),
};

/** Files allowed to name ALL_INSPECTIONS: where nobody narrowed to a person is acting. Anything new is reviewed here. */
export const ALL_INSPECTIONS_AUDITED_USES: readonly string[] = [
    'server/lib/inspection/visibility.ts',
    // Both are reached from owner/manager-only paths (mark-sent re-reads the list; the request service
    // reloads a request it has just written), so the whole company is the intended answer.
    'server/api/invoices.ts',
    // The unread badge: the administrator tier is answered with everything, anyone else from the capabilities just resolved.
    'server/api/session-context.ts',
    'server/services/inspection-request.service.ts',
];

/** Path prefixes whose GET routes read inspection-derived data; every such route must be in SET_READS. */
export const READ_PREFIXES: readonly string[] = [
    '/api/contacts', '/api/messages', '/api/invoices', '/api/analytics', '/api/metrics', '/api/events',
    '/api/inspection-requests', '/api/calendar', '/api/schedule', '/api/tags', '/api/ics', '/api/team/members',
];
