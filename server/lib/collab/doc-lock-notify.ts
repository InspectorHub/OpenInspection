/**
 * Tells the results documents of an inspection that their report was published, or is open for editing again.
 *
 * The document itself closes its open sockets and refuses their next update (`inspection-doc-lock.ts`). This is the
 * caller's side: find the report documents and ask each one. It never fails the request that triggered it: the
 * state of the report is in D1, which every new connection is checked against, so a document that could not be
 * reached only keeps accepting an already-open socket until that socket reconnects. That is logged.
 */
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import { reports } from '../db/schema';
import { collabDocName } from './doc-name';
import { logger } from '../logger';

export type DocLockTarget = { reportId: string } | { primary: true } | { allReportsOf: true };

export async function setCollabDocLocks(
    env: { INSPECTION_DOC?: DurableObjectNamespace | undefined },
    db: DrizzleD1Database,
    tenantId: string,
    inspectionId: string,
    locked: boolean,
    target: DocLockTarget,
): Promise<void> {
    const ns = env.INSPECTION_DOC;
    if (!ns) return;
    const ids = 'reportId' in target
        ? [target.reportId]
        : (await db.select({ id: reports.id }).from(reports)
            .where(and(eq(reports.tenantId, tenantId), eq(reports.inspectionId, inspectionId),
                'primary' in target ? eq(reports.kind, 'primary') : undefined)).all()).map((r) => r.id);
    await Promise.all(ids.map(async (reportId) => {
        try {
            await ns.get(ns.idFromName(collabDocName(tenantId, reportId)))
                .fetch(`https://do.local/${locked ? 'lock' : 'unlock'}`, { method: 'POST' });
        } catch (err) {
            logger.warn('results document could not be told about the report state', { tenantId, inspectionId, reportId, locked, error: String(err) });
        }
    }));
}
