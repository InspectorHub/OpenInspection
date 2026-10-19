import { logger } from '../../lib/logger';
import { collabDocName } from '../../lib/collab/doc-name';

/**
 * What happened to the collaborative-document storage of a deleted inspection.
 *
 * - `ok`: every report's object answered the purge.
 * - `failed`: at least one object threw or answered with a non-ok status. Its
 *   storage may still hold the report's content.
 * - `skipped`: nothing was attempted, because the deployment has no collab
 *   namespace bound or the inspection owned no report.
 */
export type CollabPurgeOutcome = 'ok' | 'failed' | 'skipped';

/**
 * Empty the Durable Object behind each of an inspection's reports.
 *
 * Each object is addressed by `collabDocName(tenantId, reportId)`, so only the
 * reports named here are reachable: another inspection's objects and another
 * tenant's objects are never named. The caller passes the report ids it read
 * BEFORE the rows were deleted, because after the delete nothing can name them.
 *
 * Best effort by design. The rows are already gone when this runs, so a failure
 * must not turn a completed delete into an error. It is not silent either: it is
 * logged with the inspection id (never content) and returned, so the caller can
 * record it on the audit event.
 */
export async function purgeCollabDocs(
    ns: DurableObjectNamespace | undefined,
    tenantId: string,
    inspectionId: string,
    reportIds: readonly string[],
): Promise<CollabPurgeOutcome> {
    if (!ns || reportIds.length === 0) return 'skipped';
    const results = await Promise.allSettled(reportIds.map(async (reportId) => {
        const name = collabDocName(tenantId, reportId);
        const res = await ns.get(ns.idFromName(name)).fetch('https://do/purge', { method: 'POST' });
        if (!res.ok) throw new Error(`purge returned ${res.status}`);
    }));
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed === 0) return 'ok';
    logger.warn('Collab document purge failed after inspection delete', { tenantId, inspectionId, failed, reports: reportIds.length });
    return 'failed';
}
