/**
 * Storage keys in a report link response are relative to the company.
 *
 * A stored photo key is `${tenantId}/inspections/${inspectionId}/...`. The report a person reads from a link
 * carries those keys (and photo URLs that name them in a `key=` parameter), and the company id is a storage
 * detail, not report content. So the response states each key from `inspections/` on, and the photo route
 * puts the company back from the verified link before it checks ownership.
 *
 * The rewrite runs on the SERIALIZED body, once, after the payload has been projected (see report-link-response.ts):
 * `<companyId>/inspections/` and `<companyId>/credentials/`, in their literal and percent-encoded (`%2F`) forms, lose the
 * company id. A walk over the object tree did the same job at several times the cost of serializing it, which matters on a
 * plan with a few milliseconds of CPU per request. The translation and hash readers keep receiving the payload as the
 * service built it, because only the serialized copy is rewritten.
 */
import type { Context, TypedResponse } from 'hono';
import type { JSONParsed } from 'hono/utils/types';
import { isServableBrandAsset } from './report-style/brand-asset-key';

const BRAND_ASSET_PATH = '/api/public/brand-asset';

function escapeForPattern(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The body text with the company id removed from every key into the company's report folders.
 *
 * One precompiled pattern over the whole string (about a third of the cost of four separate passes). The id has to be followed by
 * a separator and one of the two folders, so the id on its own, a note that merely mentions it, or a key of another company is
 * left alone. The id must also stand on its own on the left: preceded by a letter, digit, `_` or `-` it is the tail of some longer
 * identifier and is not touched. A free-text value that itself contains `<companyId>/inspections/` would be rewritten too; an identifier
 * followed by a storage path is not something a person types into a note. A brand-asset URL that was not routed through the photo
 * route is rewritten as well, and is not servable either way (the service builds only the relative form, which is routed first).
 */
export function relativizeSerialized(text: string, tenantId: string): string {
    if (!text.includes(tenantId)) return text;
    const ownFolders = new RegExp(`(?<![A-Za-z0-9_-])${escapeForPattern(tenantId)}(/|%2[Ff])(inspections|credentials)(/|%2[Ff])`, 'g');
    return text.replace(ownFolders, '$2$3');
}

/**
 * A JSON response whose body has been serialized once and relativized. Same status, content type and key order as `c.json`.
 * The type is the one `c.json(body, 200)` gives, so the route keeps its typed response; the cast only restates that the text
 * IS the serialization of `body`.
 */
export function respondRelativizedJson<T extends object>(c: Context, body: T, tenantId: string): Response & TypedResponse<JSONParsed<T>, 200, 'json'> {
    const text = relativizeSerialized(JSON.stringify(body), tenantId);
    return c.newResponse(text, 200, { 'Content-Type': 'application/json' }) as Response & TypedResponse<JSONParsed<T>, 200, 'json'>;
}

/**
 * The full storage key a photo request names, or null when it does not name an object of this inspection.
 *
 * Accepts the relative form a response carries (`inspections/<inspectionId>/...`) and the full form earlier links
 * carry (`<tenantId>/inspections/<inspectionId>/...`). The check is made on the FULL key and is strict: it must sit
 * under this company's folder for this inspection (or be one of its servable credential badges), and no segment may
 * be empty, `.` or `..`.
 */
export function resolveReportPhotoKey(requested: string, tenantId: string, inspectionId: string): string | null {
    const relativePrefix = `inspections/${inspectionId}/`;
    const credentialPrefix = 'credentials/';
    const full = requested.startsWith(relativePrefix) || requested.startsWith(credentialPrefix) ? `${tenantId}/${requested}` : requested;
    if (full.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) return null;
    if (full.startsWith(`${tenantId}/${relativePrefix}`)) return full;
    // A credential badge belongs to the company, not to one inspection; it is served only if the public brand-asset route would serve it.
    return full.startsWith(`${tenantId}/${credentialPrefix}`) && isServableBrandAsset(full) ? full : null;
}

/**
 * The URL a credential badge image is fetched from, for a report link response.
 *
 * The brand-asset route is keyed by the full storage key and has no link to resolve a company from, so a response
 * that must not name the company serves the badge through the report's own photo route instead. Any other URL
 * (a badge of another company, a path that is not brand-asset) is returned as it was.
 */
export function credentialImageUrl(imageUrl: string | null, tenantId: string, photoUrl: (key: string) => string): string | null {
    if (imageUrl === null || !imageUrl.startsWith(`${BRAND_ASSET_PATH}?`)) return imageUrl;
    const raw = new URLSearchParams(imageUrl.slice(BRAND_ASSET_PATH.length + 1)).get('key');
    return raw !== null && raw.startsWith(`${tenantId}/credentials/`) && isServableBrandAsset(raw) ? photoUrl(raw) : imageUrl;
}

/** A credential with its badge image URL served through the report's photo route; anything that is not a credential object is returned as it was. */
function routeCredential(credential: unknown, tenantId: string, photoUrl: (key: string) => string): unknown {
    if (credential === null || typeof credential !== 'object' || !('imageUrl' in credential)) return credential;
    const imageUrl = typeof credential.imageUrl === 'string' ? credential.imageUrl : null;
    return { ...credential, imageUrl: credentialImageUrl(imageUrl, tenantId, photoUrl) };
}

/**
 * The payload with each credential badge image served through the report's own photo route. Walks only `inspectorCredentials`;
 * a payload without it (a pinned older version, a test double) stays without it, and nothing else is copied.
 */
export function projectCredentialBadgeUrls<T extends object>(
    payload: T,
    tenantId: string,
    photoUrl: (key: string) => string,
): T {
    const credentials: unknown = 'inspectorCredentials' in payload ? payload.inspectorCredentials : undefined;
    if (!Array.isArray(credentials)) return payload;
    return { ...payload, inspectorCredentials: credentials.map((credential: unknown) => routeCredential(credential, tenantId, photoUrl)) };
}
