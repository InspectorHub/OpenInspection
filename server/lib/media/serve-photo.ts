/**
 * One R2-object-to-Response path for every photo endpoint (staff, public
 * token-gated, agent). Each endpoint owns its OWN authorization and key-scope
 * check and then calls this — the byte-serving half was copied per endpoint and
 * drifted (caching headers, thumbnail fallback), which is exactly the kind of
 * duplication that turns one fix into three.
 *
 * Callers MUST have already proven the key belongs to the caller's tenant +
 * inspection: this function trusts the key it is handed.
 */
import { contentDisposition } from '../content-disposition';
import { logger } from '../logger';

interface ImagesBinding {
    input(s: ReadableStream): {
        transform(o: { width: number }): { output(o: { format: string }): Promise<{ response(): Response }> };
    };
}

export interface ServePhotoOptions {
    /** `?w=` — an on-the-fly thumbnail width for grid previews. */
    width?: string | undefined;
    /** `?download=1` — force an attachment named after the stored original. */
    download?: boolean | undefined;
}

/** Clamp a caller-supplied width; 0 means "serve the original". */
function parseWidth(w: string | undefined): number {
    if (!w) return 0;
    return Math.min(Math.max(parseInt(w, 10) || 0, 16), 2000);
}

function originalResponse(obj: R2ObjectBody, download: boolean): Response {
    const headers = new Headers();
    headers.set('Content-Type', obj.httpMetadata?.contentType || 'application/octet-stream');
    headers.set('Content-Disposition', contentDisposition(obj.customMetadata?.originalName, download));
    headers.set('Cache-Control', 'private, max-age=300');
    if (obj.httpEtag) headers.set('etag', obj.httpEtag);
    return new Response(obj.body, { status: 200, headers });
}

/**
 * Stream an already-authorized photo key. Returns null when the bucket binding
 * or the object is missing so the caller can answer 404 in its own idiom.
 */
export async function servePhotoObject(
    bucket: R2Bucket | undefined,
    images: ImagesBinding | undefined,
    key: string,
    opts: ServePhotoOptions = {},
): Promise<Response | null> {
    if (!bucket) return null;
    const obj = await bucket.get(key);
    if (!obj) return null;

    // Optional thumbnail via the Cloudflare Images binding. ANY failure (no
    // binding / no entitlement / non-image) falls back to the original, so a
    // thumbnail request can never be worse than no thumbnail.
    const width = parseWidth(opts.width);
    if (width > 0 && images) {
        try {
            const out = await images.input(obj.body).transform({ width }).output({ format: 'image/webp' });
            const r = out.response();
            const h = new Headers(r.headers);
            h.set('Cache-Control', 'private, max-age=300');
            return new Response(r.body, { status: 200, headers: h });
        } catch (err) {
            logger.warn('[photo] thumbnail transform failed — serving original', { key, width, error: String(err) });
            // The stream was consumed by the failed transform; re-fetch.
            const orig = await bucket.get(key);
            return orig ? originalResponse(orig, opts.download ?? false) : null;
        }
    }

    return originalResponse(obj, opts.download ?? false);
}

/** The `IMAGES` binding is optional and not in the generated Env type. */
export function imagesBinding(env: unknown): ImagesBinding | undefined {
    return (env as { IMAGES?: ImagesBinding }).IMAGES;
}
