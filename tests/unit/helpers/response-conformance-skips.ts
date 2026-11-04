/**
 * Native contract operations the response conformance suite does not request, each with the reason.
 * Shrink-only: an operation that becomes testable moves into OPERATIONS in response-conformance.ts and leaves this list.
 * The read-only operations that can be requested with a simple fixture have been moved. What remains either writes (and has not been given a body),
 * needs a binding, or declares no JSON response body in the contract: the last kind can only be covered after the route declares a response schema.
 */
const BINDING = 'needs a binding the node harness does not provide (object storage, a Durable Object, the AI provider, signing or an external lookup)';
const NO_BODY = 'writes data and has not been given a request body in this suite yet; nothing about the route prevents it';

export const NOT_COVERED: Record<string, string> = {
    'POST /api/client/import': BINDING,
    'POST /api/inspections/{id}/complete': NO_BODY,
    'GET /api/inspections/{id}/units': 'the contract declares no JSON response body for this operation, so there is nothing to compare',
    'GET /api/inspections/{id}/unit-progress': 'the contract declares no JSON response body for this operation, so there is nothing to compare',
    'GET /api/inspections/{id}/statutory-details': 'answers 404 for a plain inspection in the harness; needs a statutory form profile seeded, and the contract declares no JSON body',
    'GET /api/inspections/{id}/statutory-form/coverage': 'answers 404 for a plain inspection in the harness; needs a statutory form profile seeded, and the contract declares no JSON body',
    'POST /api/inspections/{id}/collab/ticket': BINDING,
    'GET /api/inspections/{id}/photo': 'the response is binary image data and the contract declares no JSON body',
    'POST /api/inspections/{id}/media/upload-url': BINDING,
    'POST /api/inspections/{id}/media/video/create-upload': BINDING,
    'POST /api/inspections/{id}/media/video/finalize': BINDING,
    'POST /api/inspections/{id}/media/video/poster': BINDING,
    'DELETE /api/inspections/{id}/media/video/{streamUid}': BINDING,
    'POST /api/ai/comment-assist': BINDING,
    'POST /api/ai/reviews': BINDING,
    'POST /api/inspections/{id}/units': NO_BODY,
    'POST /api/inspections/{id}/units/bulk': NO_BODY,
    'POST /api/inspections/{id}/units/{unitId}/duplicate': NO_BODY,
    'PATCH /api/inspections/{id}/units/{unitId}': NO_BODY,
    'DELETE /api/inspections/{id}/units/{unitId}': NO_BODY,
    'POST /api/inspections/{id}/unit-mode': NO_BODY,
    'POST /api/inspections/{id}/property-facts/autofill': BINDING,
    'POST /api/inspections/{id}/inspector-signature': BINDING,
    'PATCH /api/inspections/{id}/template-snapshot': NO_BODY,
    'POST /api/inspections/{id}/publish': BINDING,
    'PATCH /api/inspections/{id}/statutory-details': NO_BODY,
    'POST /api/inspections/{id}/statutory-form/instances': NO_BODY,
    'POST /api/inspections/{id}/compliance/signoff': NO_BODY,
    'DELETE /api/inspections/{id}/compliance/signoff/{role}': NO_BODY,
    'POST /api/inspections/{id}/compliance/doc-review/seed': NO_BODY,
    'PATCH /api/inspections/{id}/compliance/doc-review/{documentKey}': NO_BODY,
    'PUT /api/inspections/{id}/compliance/psq': NO_BODY,
    'POST /api/inspections/{id}/compliance/psq/status': NO_BODY,
    'POST /api/inspections/{id}/collab/restructure': BINDING,
    'POST /api/inspections/{id}/collab/followup': BINDING,
    'POST /api/inspections/{id}/collab/restore': BINDING,
    'POST /api/inspections/{id}/collab/snapshots': BINDING,
    'GET /api/inspections/{id}/collab/snapshots': 'answers 501 in the node harness because the collaboration Durable Object is not bound',
    'GET /api/inspections/{id}/collab/snapshots/{seq}': 'needs the collaboration Durable Object, which the node harness does not bind',
    'POST /api/inspections/{id}/upload': BINDING,
    'POST /api/inspections/{id}/media/upload': BINDING,
    'POST /api/inspections/{id}/cover': BINDING,
    'POST /api/inspections/{id}/items/{itemId}/photos/{photoIndex}/annotation': BINDING,
    'POST /api/inspections/{id}/items/{itemId}/photos/{photoIndex}/crop': BINDING,
};

/**
 * Arrays of objects a covered response declares but the harness does not fill. The conformance spec fails any declared
 * array that was not walked with at least one element, because an empty list proves nothing about the keys of its
 * elements. Key: 'METHOD /path::array.path'. An entry whose array is now filled (or no longer declared) must be deleted.
 */
export const EMPTY_OK: Record<string, string> = {
    'GET /api/inspections/{id}/report-data::data.sections[].items[].repairItems[]': 'repair items are derived from a rated defect that carries repair fields; seeding one needs a full rating system and defect payload',
    'GET /api/inspections/{id}/publish-readiness::blockingDefects[]': 'lists defects missing required repair fields; the seeded draft has no rated defects, and seeding one needs a defect payload',
    'GET /api/inspections/{id}/publish-readiness::warningDefects[]': 'lists defects with unresolved tokens; the seeded draft has no rated defects, and seeding one needs a defect payload',
    'POST /api/inspections::data.inspection.deviations[]': 'a freshly created inspection records no deviations from the standard guide; they are added later by the commercial report flow',
};
