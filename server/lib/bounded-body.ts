/**
 * Reading a request body whose size the caller bounds, for the routes that take
 * raw bytes rather than JSON (a Yjs update, an offline package).
 *
 * The declared length is checked against the cap and against what the stream
 * delivers, but it is NOT used to size a buffer: a client that declares the
 * maximum and then sends nothing would otherwise pin that much memory per
 * request for as long as it cared to wait. Chunks are collected as they come and
 * joined once at the end. A body that does not match its declared length is
 * refused rather than truncated or padded, and nothing is read at all when the
 * declaration is missing, malformed or over the cap.
 */

export type BoundedBody<Overrun extends 400 | 413 = 400 | 413> =
    | { ok: true; bytes: Uint8Array }
    | { ok: false; status: 400 | 411 | 413 | Overrun };

/**
 * `overrunStatus` is the answer for a stream that delivers more than it
 * declared: 413 for a route that treats that as "too large", 400 for one that
 * treats it as a malformed request. A stream that delivers LESS is always 400.
 */
export async function readBoundedBody<Overrun extends 400 | 413>(
    req: Request,
    limit: number,
    overrunStatus: Overrun,
): Promise<BoundedBody<Overrun>> {
    const declared = req.headers.get('content-length');
    if (declared === null) return { ok: false, status: 411 };
    const length = Number(declared);
    if (!/^\d+$/.test(declared) || !Number.isSafeInteger(length)) return { ok: false, status: 400 };
    if (length > limit) return { ok: false, status: 413 };
    if (!req.body) return length === 0 ? { ok: true, bytes: new Uint8Array(0) } : { ok: false, status: 400 };

    const chunks: Uint8Array[] = [];
    const reader = req.body.getReader();
    let filled = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (filled + value.byteLength > length) {
            await reader.cancel();
            return { ok: false, status: overrunStatus };
        }
        chunks.push(value);
        filled += value.byteLength;
    }
    if (filled !== length) return { ok: false, status: 400 };
    const bytes = new Uint8Array(length);
    let at = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, at);
        at += chunk.byteLength;
    }
    // Drop the pieces now that they are joined, so the peak stays near one copy.
    chunks.length = 0;
    return { ok: true, bytes };
}
