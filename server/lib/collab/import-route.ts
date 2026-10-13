/**
 * The HTTP half of the offline import: `POST /api/inspections/:id/collab/import`.
 *
 * The body is raw Yjs update bytes, not JSON, so it cannot go through a zod body
 * schema; what stands in for one is a hard size bound enforced twice (the
 * declared length before anything is read, then the bytes actually received) and
 * the Durable Object's own validation of the update.
 *
 * The caller has already passed `authorizeCollab`: the identity here is the
 * verified one, and it is the only identity forwarded. Nothing from the incoming
 * request, headers included, reaches the object except the bytes.
 */

import type { Context } from 'hono';
import { MAX_IMPORT_BYTES } from '../../durable-objects/inspection-doc-import';
import { auditFromContext } from '../audit';
import { CollabImportResultSchema } from '../validations/collab.schema';
import { logger } from '../logger';
import type { HonoConfig } from '../../types/hono';

export interface CollabImportTarget {
    tenantId: string;
    inspectionId: string;
    reportId: string;
    userId: string;
    stub: { fetch(req: Request): Promise<Response> };
}

type BoundedBody = { ok: true; bytes: Uint8Array } | { ok: false; status: 400 | 411 | 413 };

/**
 * Read the request body, refusing it as soon as it is known to exceed the limit.
 * The declared Content-Length is checked first so an honest oversized upload is
 * never read at all; the stream is then counted as it arrives so a client that
 * under-declares cannot make the worker buffer more than the limit.
 */
async function readBoundedBody(req: Request, limit: number): Promise<BoundedBody> {
    const declared = req.headers.get('content-length');
    if (declared === null) return { ok: false, status: 411 };
    const length = Number(declared);
    if (!/^\d+$/.test(declared) || !Number.isSafeInteger(length)) return { ok: false, status: 400 };
    if (length > limit) return { ok: false, status: 413 };
    if (!req.body) return { ok: true, bytes: new Uint8Array(0) };

    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > limit) {
            await reader.cancel();
            return { ok: false, status: 413 };
        }
        chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return { ok: true, bytes };
}

export async function forwardCollabImport(c: Context<HonoConfig>, target: CollabImportTarget): Promise<Response> {
    const body = await readBoundedBody(c.req.raw, MAX_IMPORT_BYTES);
    if (!body.ok) {
        const error = { 400: 'invalid content-length', 411: 'content-length required', 413: 'import too large' }[body.status];
        return c.json({ error }, body.status);
    }
    if (body.bytes.byteLength === 0) return c.json({ error: 'empty import' }, 400);

    const res = await target.stub.fetch(new Request('https://do.local/import', {
        method: 'POST',
        headers: {
            'Content-Type':    'application/octet-stream',
            'x-tenant-id':     target.tenantId,
            'x-inspection-id': target.inspectionId,
            'x-report-id':     target.reportId,
            'x-user-id':       target.userId,
        },
        body: body.bytes,
    }));
    if (!res.ok) return res;

    const parsed = CollabImportResultSchema.safeParse(await res.json());
    if (!parsed.success) {
        logger.error('collab: unexpected import answer from the document object', { inspectionId: target.inspectionId });
        return c.json({ error: 'unexpected import answer' }, 502);
    }
    auditFromContext(c, 'inspection.collab.import', 'inspection', {
        entityId: target.inspectionId,
        metadata: { snapshotSeq: parsed.data.snapshotSeq, bytes: body.bytes.byteLength },
    });
    return c.json(parsed.data, 200);
}
