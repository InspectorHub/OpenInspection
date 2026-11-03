/**
 * Storage keys in a report link response are relative to the company.
 *
 * A stored photo key is `${tenantId}/inspections/${inspectionId}/...`. The report a person reads from a link
 * carries those keys (and photo URLs that name them in a `key=` parameter), and the company id is a storage
 * detail, not report content. So the response states each key from `inspections/` on, and the photo route
 * puts the company back from the verified link before it checks ownership.
 *
 * `relativizeReportKeys` runs once, on the already projected payload (see report-link-response.ts), and builds a
 * new value: the translation and hash readers keep receiving the payload as the service built it.
 */

import { isServableBrandAsset } from './report-style/brand-asset-key';

const BRAND_ASSET_PATH = '/api/public/brand-asset';

/** The folders of a company that a report link response may name an object in. */
const KEY_FOLDERS = ['inspections', 'credentials'] as const;

/** Key parameter of a photo URL: `key=<percent-encoded value>`, up to the next `&` or `#`. */
const KEY_PARAMETER = /([?&]key=)([^&#]*)/g;

function decode(value: string): string | null {
    try { return decodeURIComponent(value); } catch { return null; }
}

function relativizeString(value: string, tenantId: string): string {
    const own = `${tenantId}/`;
    // Only a string that is a key into one of the company's report folders; any other string that happens to begin with the id stays.
    if (value.startsWith(own)) return KEY_FOLDERS.some((folder) => value.startsWith(`${own}${folder}/`)) ? value.slice(own.length) : value;
    // An absolute brand-asset URL has no relative form: that route cannot resolve a company, so its key stays whole.
    if (!value.includes('key=') || value.includes(BRAND_ASSET_PATH)) return value;
    // Only a `key` that names an object in one of this company's report folders is rewritten; any other URL is left as it is.
    return value.replace(KEY_PARAMETER, (whole, name: string, raw: string) => {
        const key = decode(raw);
        if (key === null || !KEY_FOLDERS.some((folder) => key.startsWith(`${tenantId}/${folder}/`))) return whole;
        return `${name}${encodeURIComponent(key.slice(own.length))}`;
    });
}

/** A plain object: one made by a literal or `Object.create(null)`. A Date, a Map or a class instance is not, and is left as it is. */
function isPlainObject(value: unknown): value is object {
    if (value === null || typeof value !== 'object') return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function relativize(value: unknown, tenantId: string): unknown {
    if (typeof value === 'string') return relativizeString(value, tenantId);
    if (Array.isArray(value)) return value.map((element) => relativize(element, tenantId));
    if (isPlainObject(value)) {
        return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, relativize(child, tenantId)]));
    }
    return value;
}

/** A copy of `payload` in which every storage key (and the `key=` of every photo URL) is stated without the company id. */
export function relativizeReportKeys<T>(payload: T, tenantId: string): T {
    // The walk preserves the shape of plain JSON values, which is all a report payload holds.
    return relativize(payload, tenantId) as T;
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
 * The exit of a report link response: credential badges are served through the report's own photo route, then every
 * storage key is stated without the company id. Runs on the already projected payload; a payload without
 * `inspectorCredentials` (a pinned older version, a test double) stays without it.
 */
export function finishReportLink<T extends object>(
    payload: T,
    tenantId: string,
    photoUrl: (key: string) => string,
): T {
    const credentials: unknown = 'inspectorCredentials' in payload ? payload.inspectorCredentials : undefined;
    const routed = Array.isArray(credentials)
        ? { ...payload, inspectorCredentials: credentials.map((credential: unknown) => routeCredential(credential, tenantId, photoUrl)) }
        : payload;
    return relativizeReportKeys(routed, tenantId);
}
