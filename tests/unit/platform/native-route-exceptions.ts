/**
 * Routes the application serves that are deliberately NOT OpenAPI operations.
 *
 * native-routes-are-exceptions.spec.ts requires this list to equal, exactly, the routes the running
 * application serves minus the ones the generated OpenAPI document declares. A plain JSON API does not
 * belong here: describe it with `createRoute` instead. What belongs here is a route that cannot be an
 * OpenAPI operation (a WebSocket upgrade, a raw-body webhook, a redirect, a file) or that is held out of the
 * public document on purpose (the platform control-plane routes, a GET with a write side effect).
 *
 * MAX_ENTRIES is a ratchet. It may only go down: removing an exception (by converting the route) lowers it,
 * and a new exception needs a reviewed reason and a category, never a higher ceiling.
 */
export const NATIVE_ROUTE_CATEGORIES = [
    'websocket', 'webhook-raw-body', 'oauth-redirect', 'binary-or-stream', 'multipart-upload', 'text-feed',
    'html-page', 'well-known', 'health', 'static-or-redirect', 'test-only', 'm2m-hold', 'write-side-effect-get',
    'other-held',
] as const;

type NativeRouteCategory = (typeof NATIVE_ROUTE_CATEGORIES)[number];

export interface NativeRouteException {
    /** `METHOD /full/mounted/path`, parameters spelled `{id}`. */
    key: string;
    category: NativeRouteCategory;
    /** One line, English, at most 120 characters: why this cannot or should not be an OpenAPI route. */
    reason: string;
}

export const MAX_ENTRIES = 79;

export const NATIVE_ROUTE_EXCEPTIONS: readonly NativeRouteException[] = [
    { key: 'GET /api/inspections/{id}/collab/ws', category: 'websocket', reason: 'WebSocket upgrade for the collaborative editor; answers 426 to a plain request' },
    { key: 'GET /api/inspections/{id}/presence/ws', category: 'websocket', reason: 'WebSocket upgrade for inspection presence; answers 426 to a plain request' },
    { key: 'GET /api/tenant/presence/ws', category: 'websocket', reason: 'WebSocket upgrade for company-wide presence; answers 426 to a plain request' },
    { key: 'POST /webhooks/stripe', category: 'webhook-raw-body', reason: 'Third-party webhook; signature is verified over the raw body' },
    { key: 'POST /webhooks/stripe/{tenant}', category: 'webhook-raw-body', reason: 'Third-party webhook, per-tenant form; signature is verified over the raw body' },
    { key: 'POST /webhooks/quickbooks', category: 'webhook-raw-body', reason: 'Third-party webhook; HMAC signature is verified over the raw body' },
    { key: 'POST /webhooks/sms/inbound/{tenant}', category: 'webhook-raw-body', reason: 'Carrier webhook (form or JSON body); signature is verified over the raw body' },
    { key: 'POST /webhooks/sms/status/{tenant}', category: 'webhook-raw-body', reason: 'Carrier delivery-status webhook; raw-body signature, answers TwiML or empty' },
    { key: 'POST /webhooks/email/{provider}/{tenant}', category: 'webhook-raw-body', reason: 'Email provider event webhook; signature is verified over the raw body' },
    { key: 'POST /webhooks/compliance-status/{provider}/{tenant}', category: 'webhook-raw-body', reason: 'Carrier registration-status webhook; signature is verified over the raw body' },
    { key: 'GET /api/calendar/connect', category: 'oauth-redirect', reason: 'Starts the Google consent flow; answers a 302 to the provider' },
    { key: 'GET /api/calendar/callback', category: 'oauth-redirect', reason: 'Provider redirect target; cookie-less, authorised by single-use state' },
    { key: 'GET /api/integrations/qbo/connect', category: 'oauth-redirect', reason: 'Starts the Intuit consent flow; answers a 302 to the provider' },
    { key: 'GET /api/integrations/qbo/callback', category: 'oauth-redirect', reason: 'Provider redirect target; cookie-less, authorised by single-use state' },
    { key: 'POST /api/inspections/{id}/collab/import', category: 'binary-or-stream', reason: 'Binary Yjs update body (octet-stream), part of the native client contract' },
    { key: 'PUT /api/inspections/{id}/documents', category: 'binary-or-stream', reason: 'Raw request-body stream upload; the body is the file, not JSON' },
    { key: 'PUT /api/public/inspections/{id}/documents', category: 'binary-or-stream', reason: 'Raw request-body stream upload for the client portal; the body is the file' },
    { key: 'GET /api/inspections/{id}/documents/{docId}', category: 'binary-or-stream', reason: 'File download streamed from object storage' },
    { key: 'GET /api/public/inspections/{id}/documents/{docId}', category: 'binary-or-stream', reason: 'File download streamed from object storage for the client portal' },
    { key: 'GET /api/public/inspections/{id}/messages/attachments/{attachmentId}', category: 'binary-or-stream', reason: 'Message attachment streamed from object storage' },
    { key: 'GET /api/inspections/{id}/media/video/r2-object/{mediaId}', category: 'binary-or-stream', reason: 'Video bytes with HTTP Range and 206 support' },
    { key: 'GET /api/inspections/{id}/media/video/r2-object/{mediaId}/poster', category: 'binary-or-stream', reason: 'JPEG poster bytes streamed from object storage' },
    { key: 'GET /photos/{tenantId}/inspector-photos/{filename}', category: 'binary-or-stream', reason: 'Public image bytes passed through from object storage' },
    { key: 'GET /api/data/export/inspections', category: 'binary-or-stream', reason: 'CSV download (text/csv attachment), not a JSON response' },
    { key: 'GET /api/data/export/contacts', category: 'binary-or-stream', reason: 'CSV download (text/csv attachment), not a JSON response' },
    { key: 'GET /api/data/export/members', category: 'binary-or-stream', reason: 'CSV download (text/csv attachment), not a JSON response' },
    { key: 'GET /api/public/verify/{envelopeId}/public-key', category: 'binary-or-stream', reason: 'PEM file download (application/x-pem-file attachment)' },
    { key: 'GET /api/public/verify/{envelopeId}/audit-trail', category: 'binary-or-stream', reason: 'JSON served as a file attachment for the offline verifier' },
    { key: 'POST /api/platform/tenants/{slug}/data-export', category: 'binary-or-stream', reason: 'Control-plane route; answers a ZIP stream with a manifest header' },
    { key: 'GET /api/platform/migration-runs/{batchId}/source', category: 'binary-or-stream', reason: 'Control-plane route; streams the uploaded import file' },
    { key: 'POST /api/inspections/{id}/media/video/r2-upload', category: 'multipart-upload', reason: 'Multipart video upload gated by a signed token' },
    { key: 'POST /api/inspections/{id}/media/video/r2-upload-poster', category: 'multipart-upload', reason: 'Multipart JPEG poster upload gated by a signed token' },
    { key: 'POST /api/public/inspections/{id}/messages/upload', category: 'multipart-upload', reason: 'Multipart attachment upload from the client portal' },
    { key: 'POST /api/public/uploads/photo', category: 'multipart-upload', reason: 'Multipart photo upload gated by a signed token' },
    { key: 'POST /api/public/uploads/video', category: 'multipart-upload', reason: 'Multipart video upload gated by a signed token' },
    { key: 'GET /api/ics/{token}', category: 'text-feed', reason: 'iCalendar feed (text/calendar) behind a public token' },
    { key: 'GET /api/ics/inspector/{token}', category: 'text-feed', reason: 'iCalendar feed (text/calendar) behind a sealed token' },
    { key: 'GET /inspector/{tenant}/{slug}/calendar.ics', category: 'text-feed', reason: 'iCalendar feed (text/calendar) for one inspector' },
    { key: 'GET /m2m/agreement-render/{tenant}/{id}', category: 'html-page', reason: 'HTML agreement page rendered by the headless PDF renderer' },
    { key: 'GET /m2m/cert-render/{id}', category: 'html-page', reason: 'HTML certificate page rendered by the headless PDF renderer' },
    { key: 'GET /setup', category: 'html-page', reason: 'Plain-text stub page of the setup wizard, mounted only in some profiles' },
    { key: 'GET /.well-known/openinspection/tenant-keys/{slug}', category: 'well-known', reason: 'Well-known discovery document for third-party verifiers' },
    { key: 'GET /doc', category: 'well-known', reason: 'Serves the OpenAPI document itself, so it cannot describe itself' },
    { key: 'GET /status', category: 'health', reason: 'Health and version probe, byte-compatible with the worker entry and deploy tooling' },
    { key: 'GET /favicon.svg', category: 'static-or-redirect', reason: 'Static asset served from the asset directory' },
    { key: 'GET /logo.svg', category: 'static-or-redirect', reason: 'Static asset served from the asset directory' },
    { key: 'GET /fonts.css', category: 'static-or-redirect', reason: 'Static asset served from the asset directory' },
    { key: 'GET /fonts/*', category: 'static-or-redirect', reason: 'Static asset tree served from the asset directory' },
    { key: 'GET /vendor/*', category: 'static-or-redirect', reason: 'Static asset tree served from the asset directory' },
    { key: 'GET /', category: 'static-or-redirect', reason: 'Redirect to /inspections' },
    { key: 'GET /agreement-sign', category: 'static-or-redirect', reason: 'Legacy path; 302 to the not-found page' },
    { key: 'GET /agreements/sign', category: 'static-or-redirect', reason: 'Legacy path; 302 to the not-found page' },
    { key: 'GET /sign/{tenant}/{id}', category: 'static-or-redirect', reason: '302 to the token-gated signer page' },
    { key: 'GET /api/public/verify/{envelopeId}/document', category: 'static-or-redirect', reason: '302 to the signed-document renderer' },
    { key: 'GET /api/inspections/{id}/report', category: 'static-or-redirect', reason: '410 Gone tombstone for a removed endpoint; documenting it adds nothing' },
    { key: 'GET /api/__test__/last-email', category: 'test-only', reason: 'End-to-end test hook; answers 404 unless the email sink is enabled' },
    { key: 'POST /api/__test__/calendar-connection', category: 'test-only', reason: 'End-to-end test hook; answers 404 unless the email sink is enabled' },
    { key: 'POST /api/__test__/report-translation', category: 'test-only', reason: 'End-to-end test hook; answers 404 unless the email sink is enabled' },
    { key: 'PATCH /api/platform/tenants/{slug}', category: 'm2m-hold', reason: 'Platform control-plane route kept out of the public document' },
    { key: 'POST /api/platform/tenants/{slug}/purge', category: 'm2m-hold', reason: 'Platform control-plane route kept out of the public document' },
    { key: 'POST /api/platform/tenants/{slug}/inspection-doc/purge', category: 'm2m-hold', reason: 'Platform control-plane route kept out of the public document' },
    { key: 'GET /api/platform/destruction-records', category: 'm2m-hold', reason: 'Platform control-plane route kept out of the public document' },
    { key: 'POST /api/platform/discovery-objections', category: 'm2m-hold', reason: 'Platform control-plane route kept out of the public document' },
    { key: 'DELETE /api/platform/discovery-objections', category: 'm2m-hold', reason: 'Platform control-plane route kept out of the public document' },
    { key: 'POST /api/platform/sso-handoff', category: 'm2m-hold', reason: 'Platform control-plane route kept out of the public document' },
    { key: 'POST /api/platform/sync-quota', category: 'm2m-hold', reason: 'Platform control-plane route kept out of the public document' },
    { key: 'GET /api/platform/tenants/{slug}/seat-usage', category: 'm2m-hold', reason: 'Platform control-plane route kept out of the public document' },
    { key: 'POST /api/platform/seed-starter-content', category: 'm2m-hold', reason: 'Platform control-plane route kept out of the public document' },
    { key: 'POST /api/platform/backfill-default-templates', category: 'm2m-hold', reason: 'Platform control-plane route kept out of the public document' },
    { key: 'GET /api/platform/sync-health', category: 'm2m-hold', reason: 'Platform control-plane route kept out of the public document' },
    { key: 'POST /api/platform/sync-redrive', category: 'm2m-hold', reason: 'Platform control-plane route kept out of the public document' },
    { key: 'POST /api/platform/secrets/reencrypt', category: 'm2m-hold', reason: 'Platform control-plane route kept out of the public document' },
    { key: 'GET /api/platform/usage', category: 'm2m-hold', reason: 'Platform control-plane route kept out of the public document' },
    { key: 'GET /api/platform/ai-provisioning', category: 'm2m-hold', reason: 'Platform control-plane route kept out of the public document' },
    { key: 'GET /api/platform/tenants/by-email', category: 'm2m-hold', reason: 'Platform control-plane route kept out of the public document' },
    { key: 'GET /api/platform/statutory-forms/installs', category: 'm2m-hold', reason: 'Platform control-plane route kept out of the public document' },
    { key: 'GET /api/platform/statutory-forms/impact', category: 'm2m-hold', reason: 'Platform control-plane route kept out of the public document' },
    { key: 'POST /api/platform/marketplace/{libraryId}/delist', category: 'm2m-hold', reason: 'Platform control-plane route kept out of the public document' },
    { key: 'GET /api/inspections/{id}/agreement', category: 'write-side-effect-get', reason: 'A GET that creates an envelope when none exists; documenting it as a read would enshrine that' },
];
