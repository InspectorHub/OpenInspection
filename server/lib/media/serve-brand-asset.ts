/**
 * The bytes of a brand asset (a company logo or a credential badge), at the size the surface draws it.
 *
 * One body for every route that serves one: the public brand-asset route and the report photo route (which serves a
 * credential badge for a report link, so that the response never has to name the company). The caller has already
 * proven the key is servable (`isServableBrandAsset`) and, where it matters, that it belongs to the caller's company.
 *
 * FAILS OPEN IN EVERY DIRECTION: no variant asked for, no IMAGES binding, a vector, or a transform that throws all
 * serve the original. A badge larger than it needed to be is a cost; a badge that does not render is a broken document.
 */
import { imagesBinding } from './serve-photo';
import { resolveBadgeVariant, isVectorBadge } from './badge-variant';
import { r2Get } from '../r2/objects';
import { logger } from '../logger';
import { BRAND_ASSET_SAFETY_HEADERS } from './svg-safety';

/** The stored bytes, unchanged: the answer whenever a transform is not wanted or not possible. */
function brandAssetResponse(obj: R2ObjectBody, cacheControl: string | undefined): Response {
    const headers = new Headers();
    headers.set('Content-Type', obj.httpMetadata?.contentType || 'application/octet-stream');
    headers.set('Cache-Control', cacheControl ?? 'public, max-age=3600');
    if (obj.httpEtag) headers.set('etag', obj.httpEtag);
    // A stored SVG opened directly is a document: the sandbox policy keeps it from running script on the application origin.
    for (const [name, value] of Object.entries(BRAND_ASSET_SAFETY_HEADERS)) headers.set(name, value);
    return new Response(obj.body, { status: 200, headers });
}

/** The asset as a response, or null when the object is missing. `variant` is the raw `?v=`; an unknown one serves the original. */
export async function serveBrandAssetObject(
    bucket: R2Bucket,
    env: unknown,
    key: string,
    variant: string | undefined,
    /** Replaces the public cache header, for a caller whose URL is not public (a report link). The brand-asset route passes none. */
    cacheControl?: string,
): Promise<Response | null> {
    const obj = await r2Get(bucket, key);
    if (!obj) return null;

    // Serve-time downscale. This is what reaches the badges ALREADY in R2: an upload-time rule only ever helps the next
    // upload, and the 2 MB photograph somebody has already saved is the one costing every recipient of every email.
    const resolved = resolveBadgeVariant(variant);
    const images = imagesBinding(env);
    if (resolved && images && !isVectorBadge(obj.httpMetadata?.contentType)) {
        try {
            const out = await images.input(obj.body)
                .transform({ width: resolved.width })
                .output({ format: resolved.format });
            const r = out.response();
            const h = new Headers(r.headers);
            // Immutable: the key carries a uuid, so a replaced badge is a new key. Longer than the original's hour for that reason.
            h.set('Cache-Control', cacheControl ?? 'public, max-age=31536000, immutable');
            for (const [name, value] of Object.entries(BRAND_ASSET_SAFETY_HEADERS)) h.set(name, value);
            return new Response(r.body, { status: 200, headers: h });
        } catch (err) {
            logger.warn('[brand-asset] badge transform failed — serving original', { key, variant, error: String(err) });
            const orig = await r2Get(bucket, key);
            return orig ? brandAssetResponse(orig, cacheControl) : null;
        }
    }
    return brandAssetResponse(obj, cacheControl);
}
