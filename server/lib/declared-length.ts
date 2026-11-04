import type { Context } from 'hono';
import type { HonoConfig } from '../types/hono';

/** Multipart framing adds a little to the file itself; this much headroom is allowed before the body is read. */
const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

/**
 * Refuse a body that does not declare its size, or declares too much, before it is read into memory. A missing or non-numeric length
 * is 411 rather than zero: a chunked body has no declared size to check. Call it before `parseBody()`, `formData()` or any other read
 * that buffers a multipart request, on every route a stranger or a link holder can reach.
 */
export function declaredLengthRefusal(c: Context<HonoConfig>, maxBytes: number, tooLarge: Record<string, unknown>): Response | null {
    const header = c.req.header('content-length');
    if (header === undefined || !/^\d+$/.test(header.trim())) {
        return c.json({ error: 'Content-Length is required.' }, 411);
    }
    return Number(header) > maxBytes + MULTIPART_OVERHEAD_BYTES ? c.json(tooLarge, 413) : null; // projection-allow: a refusal body the caller built from literals (error code and limits)
}
