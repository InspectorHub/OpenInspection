/**
 * The native client contract: every endpoint the offline-first native app calls.
 *
 * Two lists, because the app depends on two different kinds of surface:
 *
 *  - NATIVE_CONTRACT: operations declared through `createRoute()`. Their request
 *    and response schemas are written to `contracts/native-contract.openapi.json`
 *    by `npm run native:contract`, and CI diffs that file against the base branch
 *    with oasdiff so a breaking change to a shipped app is a red build.
 *  - NATIVE_NON_OPENAPI_CONTRACT: endpoints OpenAPI cannot describe (WebSocket
 *    upgrades, binary bodies, the OAuth endpoints a library serves). Their shape
 *    is pinned by tests/unit/native/contract-non-openapi.spec.ts.
 *
 * A shipped app binary cannot be recalled, so removing or reshaping anything
 * listed here breaks installed clients. Adding an entry is how a new endpoint
 * becomes part of the promise; removing one is a breaking change.
 *
 * This module must stay erasable TypeScript (no enums, no parameter properties):
 * `scripts/check-native-contract.mjs` imports it under Node's type stripping.
 */

type NativeContractMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface NativeContractEntry {
    method: NativeContractMethod;
    /** OpenAPI path template, e.g. `/api/inspections/{id}`. */
    path: string;
}

type NativeNonOpenApiKind = 'websocket' | 'binary' | 'oauth' | 'token-json';

export interface NativeNonOpenApiEntry {
    kind: NativeNonOpenApiKind;
    method: 'get' | 'post' | 'put' | 'delete';
    /** Path template; `{id}` stands for an inspection id and `{n}` for a part number. */
    path: string;
    /** What the client relies on, in one sentence. */
    note: string;
}

export const NATIVE_CONTRACT: readonly NativeContractEntry[] = [
    // Version handshake, identity, offline package import and reconcile.
    { method: 'get', path: '/api/client/compat' },
    { method: 'get', path: '/api/client/session' },
    // Branding, user, tenant locale and timezone for the signed-in session.
    { method: 'get', path: '/api/session/context' },
    { method: 'post', path: '/api/client/import' },
    { method: 'post', path: '/api/client/inspections/visible' },
    // Inspection record: list, create (client-supplied id), read, update, complete.
    { method: 'get', path: '/api/inspections' },
    { method: 'post', path: '/api/inspections' },
    { method: 'get', path: '/api/inspections/{id}' },
    { method: 'patch', path: '/api/inspections/{id}' },
    { method: 'post', path: '/api/inspections/{id}/complete' },
    // What the field editor loads for one inspection.
    { method: 'get', path: '/api/inspections/{id}/results' },
    { method: 'get', path: '/api/inspections/{id}/report-data' },
    { method: 'get', path: '/api/inspections/{id}/units' },
    { method: 'get', path: '/api/inspections/{id}/unit-progress' },
    { method: 'get', path: '/api/inspections/{id}/compliance' },
    { method: 'get', path: '/api/inspections/{id}/statutory-details' },
    { method: 'get', path: '/api/inspections/{id}/statutory-form/coverage' },
    // Reference data the editor reads.
    { method: 'get', path: '/api/tags' },
    // The tags on a checklist item: the whole inspection's map for the editor's chips, then attach and detach. The
    // attach is idempotent (a tag already on the item changes nothing), so the app may replay it after a dropped answer.
    { method: 'get', path: '/api/inspections/{id}/tags' },
    { method: 'post', path: '/api/inspections/{id}/items/{itemId}/tags' },
    { method: 'delete', path: '/api/inspections/{id}/items/{itemId}/tags/{tagId}' },
    { method: 'get', path: '/api/admin/defect-categories' },
    { method: 'get', path: '/api/recommendations' },
    { method: 'get', path: '/api/contractor-types' },
    // Realtime access and media.
    { method: 'post', path: '/api/inspections/{id}/collab/ticket' },
    // Download a photo by its stored key; `w` asks for a thumbnail where the deployment has an image service.
    { method: 'get', path: '/api/inspections/{id}/photo' },
    { method: 'post', path: '/api/inspections/{id}/media/upload-url' },
    { method: 'post', path: '/api/inspections/{id}/media/video/create-upload' },
    { method: 'post', path: '/api/inspections/{id}/media/video/finalize' },
    { method: 'post', path: '/api/inspections/{id}/media/video/poster' },
    { method: 'delete', path: '/api/inspections/{id}/media/video/{streamUid}' },
    // AI assistance.
    { method: 'post', path: '/api/ai/comment-assist' },
    { method: 'post', path: '/api/ai/reviews' },
    // Cost items.
    { method: 'get', path: '/api/inspections/{id}/cost-items' },
    { method: 'post', path: '/api/inspections/{id}/cost-items' },
    { method: 'patch', path: '/api/inspections/{id}/cost-items/{itemId}' },
    { method: 'delete', path: '/api/inspections/{id}/cost-items/{itemId}' },
    // Units: the building tree of a multi-unit inspection.
    { method: 'post', path: '/api/inspections/{id}/units' },
    { method: 'post', path: '/api/inspections/{id}/units/bulk' },
    { method: 'post', path: '/api/inspections/{id}/units/{unitId}/duplicate' },
    { method: 'patch', path: '/api/inspections/{id}/units/{unitId}' },
    { method: 'delete', path: '/api/inspections/{id}/units/{unitId}' },
    { method: 'post', path: '/api/inspections/{id}/unit-mode' },
    // Inspection-level editor writes: property facts, narrative, signature, template snapshot, statutory details, publish.
    { method: 'get', path: '/api/inspections/{id}/publish-readiness' },
    { method: 'patch', path: '/api/inspections/{id}/property-facts' },
    { method: 'post', path: '/api/inspections/{id}/property-facts/autofill' },
    { method: 'patch', path: '/api/inspections/{id}/pca-narrative' },
    { method: 'post', path: '/api/inspections/{id}/inspector-signature' },
    { method: 'patch', path: '/api/inspections/{id}/template-snapshot' },
    { method: 'post', path: '/api/inspections/{id}/publish' },
    { method: 'patch', path: '/api/inspections/{id}/statutory-details' },
    { method: 'post', path: '/api/inspections/{id}/statutory-form/instances' },
    // Compliance: sign-off, document review, property-condition questionnaire.
    { method: 'post', path: '/api/inspections/{id}/compliance/signoff' },
    { method: 'delete', path: '/api/inspections/{id}/compliance/signoff/{role}' },
    { method: 'post', path: '/api/inspections/{id}/compliance/doc-review/seed' },
    { method: 'patch', path: '/api/inspections/{id}/compliance/doc-review/{documentKey}' },
    { method: 'put', path: '/api/inspections/{id}/compliance/psq' },
    { method: 'post', path: '/api/inspections/{id}/compliance/psq/status' },
    // Collaboration JSON routes (the sync socket itself is in the non-OpenAPI list).
    { method: 'post', path: '/api/inspections/{id}/collab/restructure' },
    { method: 'post', path: '/api/inspections/{id}/collab/followup' },
    { method: 'post', path: '/api/inspections/{id}/collab/restore' },
    { method: 'post', path: '/api/inspections/{id}/collab/snapshots' },
    { method: 'get', path: '/api/inspections/{id}/collab/snapshots' },
    { method: 'get', path: '/api/inspections/{id}/collab/snapshots/{seq}' },
    // Templates the editor reads and saves back to.
    { method: 'get', path: '/api/inspections/templates' },
    { method: 'get', path: '/api/inspections/templates/{id}' },
    { method: 'post', path: '/api/inspections/templates' },
    { method: 'put', path: '/api/inspections/templates/{id}' },
    // Multipart uploads (binary bodies) and the media pool listing.
    { method: 'get', path: '/api/inspections/{id}/media' },
    { method: 'post', path: '/api/inspections/{id}/upload' },
    { method: 'post', path: '/api/inspections/{id}/media/upload' },
    { method: 'post', path: '/api/inspections/{id}/cover' },
    { method: 'post', path: '/api/inspections/{id}/items/{itemId}/photos/{photoIndex}/annotation' },
    { method: 'post', path: '/api/inspections/{id}/items/{itemId}/photos/{photoIndex}/crop' },
];

export const NATIVE_NON_OPENAPI_CONTRACT: readonly NativeNonOpenApiEntry[] = [
    {
        kind: 'websocket', method: 'get', path: '/api/inspections/{id}/collab/ws',
        note: 'Yjs results document sync; authenticated by a one-time ticket query parameter. Frames: MSG_SYNC = 0, MSG_RESTORE = 2, MSG_ACK = 3 (optional: sent only to sockets opened with ack=1, after the document reached the Durable Object storage).',
    },
    {
        kind: 'websocket', method: 'get', path: '/api/inspections/{id}/presence/ws',
        note: 'Who else is editing this inspection; authenticated by the same one-time ticket.',
    },
    {
        kind: 'binary', method: 'post', path: '/api/inspections/{id}/collab/import',
        note: 'Applies an offline Yjs update to the results document; the body is the binary update.',
    },
    {
        kind: 'binary', method: 'post', path: '/api/public/uploads/photo',
        note: 'Photo bytes as multipart field "file", authorized by the signed token from the upload-url call.',
    },
    {
        kind: 'binary', method: 'post', path: '/api/inspections/{id}/media/video/r2-upload-poster',
        note: 'Poster image as multipart field "file", authorized by the upload token query parameter from the create-upload call; answers 404 until the clip was uploaded under that token. Only image/jpeg, image/png and image/webp are accepted (400 otherwise), up to the photo size cap (413 over it), and the object is stored with that type.',
    },
    {
        kind: 'binary', method: 'post', path: '/api/public/uploads/video',
        note: 'Video bytes as multipart field "file", authorized by the signed token from the create-upload call. The single-request path: capped at 64 MiB: over it the answer is 413 VIDEO_TOO_LARGE_FOR_FORM with limits.maxBytes and limits.chunkedPath, so a client uses the chunked routes for large clips.',
    },
    {
        kind: 'token-json', method: 'post', path: '/api/public/uploads/video/chunked',
        note: 'Opens a chunked video upload for the signed token from create-upload. Body {totalBytes}; answers {success, data:{state, mediaId, totalBytes, partBytes, partCount, r2Key, received:[{partNumber,size}]}}. Repeating it resumes: the same size returns the parts already received, another size is 409 VIDEO_UPLOAD_PARAMS_MISMATCH. Errors carry a stable `code`.',
    },
    {
        kind: 'binary', method: 'put', path: '/api/public/uploads/video/chunked/parts/{n}',
        note: 'One part as the raw body, authorized by the same token. The part must be exactly `partBytes` long (the last part is the remainder) and the request must carry Content-Length, otherwise 413 VIDEO_PART_SIZE_MISMATCH or 411. Part 1 must be sent before any other part (409 VIDEO_FIRST_PART_REQUIRED) and must start like an mp4, mov or webm video (400 VIDEO_FORMAT_MISMATCH). Re-sending a part replaces it.',
    },
    {
        kind: 'token-json', method: 'post', path: '/api/public/uploads/video/chunked/complete',
        note: 'Joins the parts into the video and answers {success, data:{mediaId, r2Key}}, the key to hand to finalize. 409 VIDEO_PARTS_MISSING lists the missing part numbers; 409 VIDEO_PARTS_MISMATCH means send every part again. Repeating it after success answers the same.',
    },
    {
        kind: 'token-json', method: 'delete', path: '/api/public/uploads/video/chunked',
        note: 'Cancels an unfinished chunked upload (204, repeatable). A finished upload answers 409 VIDEO_ALREADY_COMPLETED.',
    },
    {
        kind: 'oauth', method: 'get', path: '/oauth/authorize',
        note: 'Authorization endpoint of the OAuth provider; the app signs in through the system browser with PKCE (S256).',
    },
    {
        kind: 'oauth', method: 'post', path: '/oauth/token',
        note: 'Token endpoint: authorization code exchange and refresh. A refresh refused because the member was removed answers 400 invalid_grant with an extra top-level field session_end_reason set to member_removed.',
    },
    {
        kind: 'oauth', method: 'post', path: '/oauth/register',
        note: 'Dynamic client registration used by the app on first run.',
    },
];
