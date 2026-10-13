/**
 * The service-side half of resolving pending photo entries after an offline
 * import. There is no HTTP route for it: the offline-bundle service calls this
 * with an identity that came from `authorizeCollab`, and the Durable Object is
 * only ever reached through its stub.
 */

import { validatePendingMap } from '../../durable-objects/inspection-doc-import';
import { CollabResolvePendingResultSchema } from '../validations/collab.schema';
import { logger } from '../logger';
import type { CollabImportIdentity, CollabImportTarget } from './import-route';

export type CollabResolvePendingOutcome =
    | { ok: true; matched: number; unmatched: number; changed: boolean }
    | { ok: false; status: 400 | 413 | 500 | 502 | 503; reason: string };

/**
 * Ask the document object to swap `pendingUpload` photo entries for the R2 keys
 * in `keys` (pendingId to key). Failure is returned as data, nothing is thrown
 * and nothing is audited here; the caller audits in its own terms. The map is
 * checked here against the identity before it is sent, and again by the object.
 */
export async function resolvePendingInDo(
    stub: CollabImportTarget['stub'],
    identity: CollabImportIdentity,
    keys: Readonly<Record<string, string>>,
): Promise<CollabResolvePendingOutcome> {
    const checked = validatePendingMap(keys, identity);
    if (!checked.ok) return { ok: false, status: checked.status, reason: checked.reason };

    let res: Response;
    try {
        res = await stub.fetch(new Request('https://do.local/resolve-pending', {
            method: 'POST',
            headers: {
                'Content-Type':    'application/json',
                'x-tenant-id':     identity.tenantId,
                'x-inspection-id': identity.inspectionId,
                'x-report-id':     identity.reportId,
                'x-user-id':       identity.userId,
            },
            body: JSON.stringify(Object.fromEntries(checked.map)),
        }));
    } catch (err) {
        logger.error('collab: the document object could not be reached to resolve pending photos', { inspectionId: identity.inspectionId }, err instanceof Error ? err : undefined);
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
            case 400: case 413: case 500: case 503:
                return { ok: false, status: res.status, reason };
            default:
                return { ok: false, status: 502, reason };
        }
    }

    const parsed = CollabResolvePendingResultSchema.safeParse(answer);
    if (!parsed.success) {
        logger.error('collab: unexpected resolve-pending answer from the document object', { inspectionId: identity.inspectionId });
        return { ok: false, status: 502, reason: 'unexpected_answer' };
    }
    const { matched, unmatched, changed } = parsed.data;
    return { ok: true, matched, unmatched, changed };
}
