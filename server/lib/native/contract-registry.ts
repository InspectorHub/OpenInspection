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
 *    upgrades, binary bodies, the OAuth endpoints a library serves, plain JSON
 *    routes). Their shape is pinned by tests/unit/native/contract-non-openapi.spec.ts.
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

type NativeNonOpenApiKind = 'websocket' | 'binary' | 'json' | 'oauth';

export interface NativeNonOpenApiEntry {
    kind: NativeNonOpenApiKind;
    method: 'get' | 'post';
    /** Path template; `{id}` stands for an inspection id. */
    path: string;
    /** What the client relies on, in one sentence. */
    note: string;
}

export const NATIVE_CONTRACT: readonly NativeContractEntry[] = [
    // Version handshake, identity and offline package import.
    { method: 'get', path: '/api/client/compat' },
    { method: 'get', path: '/api/client/session' },
    { method: 'post', path: '/api/client/import' },
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
    { method: 'get', path: '/api/admin/defect-categories' },
    { method: 'get', path: '/api/recommendations' },
    { method: 'get', path: '/api/contractor-types' },
    // Realtime access and media.
    { method: 'post', path: '/api/inspections/{id}/collab/ticket' },
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
];

export const NATIVE_NON_OPENAPI_CONTRACT: readonly NativeNonOpenApiEntry[] = [
    {
        kind: 'websocket', method: 'get', path: '/api/inspections/{id}/collab/ws',
        note: 'Yjs results document sync; authenticated by a one-time ticket query parameter. Frames: MSG_SYNC = 0, MSG_RESTORE = 2.',
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
        kind: 'binary', method: 'post', path: '/api/public/uploads/video',
        note: 'Video bytes as multipart field "file", authorized by the signed token from the create-upload call.',
    },
    {
        kind: 'json', method: 'get', path: '/api/session/context',
        note: 'Branding, user, tenant locale and timezone for the signed-in session; a plain JSON route with no OpenAPI declaration.',
    },
    {
        kind: 'oauth', method: 'get', path: '/oauth/authorize',
        note: 'Authorization endpoint of the OAuth provider; the app signs in through the system browser with PKCE (S256).',
    },
    {
        kind: 'oauth', method: 'post', path: '/oauth/token',
        note: 'Token endpoint: authorization code exchange and refresh.',
    },
    {
        kind: 'oauth', method: 'post', path: '/oauth/register',
        note: 'Dynamic client registration used by the app on first run.',
    },
];
