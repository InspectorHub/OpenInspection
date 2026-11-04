/**
 * A stored copy of a repair-request share PDF.
 *
 * Rendering the share page in a headless browser is the expensive part, and the share token is the only credential, so any holder can
 * ask again and again. The copy is keyed by a digest of everything the page shows plus the render version: an edit of the list, the
 * intro, the credits or the property address, or a template change, produces a new key and a fresh render, so the copy can never show
 * content that is no longer current. The publish and release gates run before this is reached, on every request.
 *
 * Kept in the Workers Cache API with a short lifetime rather than in the report bucket, so nothing about the copy has to be tracked
 * by retention or erasure: it expires on its own. Where the Cache API is not available (a deployment on a workers.dev host, tests)
 * every request renders, which the caller's limiter bounds.
 */
import { RENDER_VERSION } from './pdf';
import { sha256Hex } from './sha256';

const TTL_SECONDS = 600;

type CacheLike = { match(key: string): Promise<Response | undefined>; put(key: string, res: Response): Promise<void> };

function defaultCache(): CacheLike | undefined {
    return (globalThis as unknown as { caches?: { default?: CacheLike } }).caches?.default;
}

/** Digest of what the share page shows, for the cache key. */
export async function sharePdfContentKey(parts: { requestId: string; inspectionId: string; content: unknown }): Promise<string> {
    return sha256Hex(JSON.stringify({ v: RENDER_VERSION, r: parts.requestId, i: parts.inspectionId, c: parts.content }));
}

/**
 * The PDF for a content key: the stored copy when there is one, otherwise `render()` (which the caller bounds) stored for next time.
 * A storage failure never fails the request.
 */
export async function cachedSharePdf(tenantId: string, contentKey: string, render: () => Promise<ArrayBuffer>): Promise<ArrayBuffer> {
    const cache = defaultCache();
    const url = `https://share-pdf.invalid/${tenantId}/${contentKey}`;
    if (cache) {
        try {
            const hit = await cache.match(url);
            if (hit) return await hit.arrayBuffer();
        } catch { /* a cache read failure renders instead */ }
    }
    const pdf = await render();
    if (cache) {
        try {
            await cache.put(url, new Response(pdf.slice(0), { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': `max-age=${TTL_SECONDS}` } }));
        } catch { /* a cache write failure only costs the next render */ }
    }
    return pdf;
}
