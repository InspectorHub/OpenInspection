/**
 * One R2-object-to-Response path for stored video clips and their posters.
 *
 * The staff route (session) and the report-link route (portal token) each own their authorization and the pool-row
 * lookup, then call this. Callers MUST have already proven the key belongs to the caller's company and inspection:
 * this trusts the key it is handed.
 */
import { r2Get, r2Head } from '../r2/objects';
import { ALLOWED_VIDEO_MIMES } from './video-types';

const POSTER_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** The type a clip is served as: its stored one when that is a video type we accept, otherwise mp4. Never a replayed script-capable type. */
function storedVideoType(stored: string | undefined): string {
    return stored && ALLOWED_VIDEO_MIMES.has(stored) ? stored : 'video/mp4';
}

type ByteRange = { start: number; end: number };

/**
 * Resolve a `Range` header against a known object size.
 *
 *  - `null`            no usable range: serve the whole object (absent header, or a form we do not serve such as several ranges,
 *                      which RFC 9110 allows a server to ignore)
 *  - `'unsatisfiable'` the range starts at or past the end of the object (416)
 *  - `{start, end}`    inclusive, `end` already clamped to the last byte
 *
 * Handles `bytes=a-b`, `bytes=a-` and the suffix form `bytes=-n` (the last n bytes), which players use to find the end of a clip.
 */
export function resolveByteRange(header: string | undefined, size: number): ByteRange | 'unsatisfiable' | null {
    if (!header) return null;
    const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
    if (!m || (m[1] === '' && m[2] === '')) return null;
    if (size <= 0) return 'unsatisfiable';
    if (m[1] === '') {
        const suffix = parseInt(m[2]!, 10);
        if (!(suffix > 0)) return 'unsatisfiable';
        return { start: Math.max(0, size - suffix), end: size - 1 };
    }
    const start = parseInt(m[1], 10);
    if (start >= size) return 'unsatisfiable';
    const end = m[2] === '' ? size - 1 : Math.min(parseInt(m[2]!, 10), size - 1);
    if (end < start) return null;
    return { start, end };
}

/** Stream a clip, honouring a Range header. Null when the object is missing. */
export async function serveVideoClip(
    bucket: R2Bucket, clipKey: string, rangeHeader: string | undefined, cacheControl: string,
): Promise<Response | null> {
    const head = await r2Head(bucket, clipKey);
    if (!head) return null;
    const size = head.size;
    const range = resolveByteRange(rangeHeader, size);
    const base = { 'Accept-Ranges': 'bytes', 'Cache-Control': cacheControl };

    if (range === 'unsatisfiable') {
        return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` } });
    }
    if (range) {
        const length = range.end - range.start + 1;
        const obj = await r2Get(bucket, clipKey, { range: { offset: range.start, length } });
        if (!obj) return null;
        return new Response(obj.body, {
            status: 206,
            headers: {
                ...base,
                'Content-Type': storedVideoType(obj.httpMetadata?.contentType),
                'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
                'Content-Length': String(length),
            },
        });
    }
    const obj = await r2Get(bucket, clipKey);
    if (!obj) return null;
    return new Response(obj.body, {
        status: 200,
        headers: { ...base, 'Content-Type': storedVideoType(obj.httpMetadata?.contentType), 'Content-Length': String(obj.size) },
    });
}

/** Stream a poster image. Null when the object is missing. */
export async function serveVideoPoster(bucket: R2Bucket, posterKey: string, cacheControl: string): Promise<Response | null> {
    const obj = await r2Get(bucket, posterKey);
    if (!obj) return null;
    // A poster stored before the upload allowlist may carry a script-capable type; never replay one.
    const stored = obj.httpMetadata?.contentType;
    return new Response(obj.body, {
        status: 200,
        headers: {
            'Content-Type': stored && POSTER_MIMES.has(stored) ? stored : 'image/jpeg',
            'Content-Length': String(obj.size),
            'Cache-Control': cacheControl,
        },
    });
}
