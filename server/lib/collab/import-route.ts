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
import { readBoundedBody } from '../bounded-body';
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

/** The verified identity the object is addressed with; only `authorizeCollab` may produce one. */
export interface CollabImportIdentity {
    tenantId: string;
    inspectionId: string;
    reportId: string;
    userId: string;
}

export type CollabImportOutcome =
    | { ok: true; snapshotSeq: number | null; changed: boolean }
    | { ok: false; status: 400 | 413 | 422 | 502 | 503; reason: string };

/**
 * Send already-read update bytes to the document object and say what happened,
 * as data. Nothing is thrown for an expected failure and nothing is audited here:
 * a caller that imports many updates (the offline bundle) audits each in its own
 * terms, and `forwardCollabImport` audits the single-update route.
 *
 * The identity must come from `authorizeCollab`; it is the only identity sent.
 */
export async function importUpdateIntoDo(
    stub: CollabImportTarget['stub'],
    identity: CollabImportIdentity,
    bytes: Uint8Array,
): Promise<CollabImportOutcome> {
    if (bytes.byteLength === 0) return { ok: false, status: 400, reason: 'empty' };
    if (bytes.byteLength > MAX_IMPORT_BYTES) return { ok: false, status: 413, reason: 'too_large' };

    let res: Response;
    try {
        res = await stub.fetch(new Request('https://do.local/import', {
            method: 'POST',
            headers: {
                'Content-Type':    'application/octet-stream',
                'x-tenant-id':     identity.tenantId,
                'x-inspection-id': identity.inspectionId,
                'x-report-id':     identity.reportId,
                'x-user-id':       identity.userId,
            },
            body: bytes,
        }));
    } catch (err) {
        logger.error('collab: the document object could not be reached for an import', { inspectionId: identity.inspectionId }, err instanceof Error ? err : undefined);
        return { ok: false, status: 502, reason: 'do_unreachable' };
    }

    let answer: unknown;
    try {
        answer = await res.json();
    } catch {
        answer = undefined;
    }

    if (!res.ok) {
        const reason = typeof answer === 'object' && answer !== null && 'reason' in answer && typeof answer.reason === 'string'
            ? answer.reason
            : 'do_error';
        switch (res.status) {
            case 400: case 413: case 422: case 503:
                return { ok: false, status: res.status, reason };
            default:
                return { ok: false, status: 502, reason };
        }
    }

    const parsed = CollabImportResultSchema.safeParse(answer);
    if (!parsed.success) {
        logger.error('collab: unexpected import answer from the document object', { inspectionId: identity.inspectionId });
        return { ok: false, status: 502, reason: 'unexpected_answer' };
    }
    return { ok: true, snapshotSeq: parsed.data.snapshotSeq, changed: parsed.data.changed };
}

export async function forwardCollabImport(c: Context<HonoConfig>, target: CollabImportTarget): Promise<Response> {
    const body = await readBoundedBody(c.req.raw, MAX_IMPORT_BYTES, 413);
    if (!body.ok) {
        const error = { 400: 'invalid content-length', 411: 'content-length required', 413: 'import too large' }[body.status];
        return c.json({ error }, body.status);
    }
    if (body.bytes.byteLength === 0) return c.json({ error: 'empty import' }, 400);

    const out = await importUpdateIntoDo(target.stub, target, body.bytes);
    if (!out.ok) return c.json({ ok: false, reason: out.reason }, out.status);

    auditFromContext(c, 'inspection.collab.import', 'inspection', {
        entityId: target.inspectionId,
        metadata: { snapshotSeq: out.snapshotSeq, changed: out.changed, bytes: body.bytes.byteLength },
    });
    return c.json({ ok: true, snapshotSeq: out.snapshotSeq, changed: out.changed }, 200);
}
