/**
 * One-off copy of collaborative documents from unpinned Durable Objects into their jurisdiction-pinned twins.
 *
 * A pinned namespace mints different ids from the unpinned one for the same name (see do-jurisdiction.ts), so each
 * document's stored state is exported from the old object and imported into the new one. Safe to repeat: an object that
 * already holds a document refuses the import (409) and is counted, never overwritten. Which documents exist is read from the
 * database (rows that carry stored collab state); object names are derived from the row's tenant and report, never from input.
 */

import { and, isNotNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { inspectionResults } from '../db/schema';
import { collabDocName } from './doc-name';

export interface CollabDocRef { tenantId: string; reportId: string }

export interface MigrationReport {
    total:        number;
    copied:       number;
    /** Dry run only: documents that a real run would try to copy. */
    wouldCopy:    number;
    alreadyThere: number;
    empty:        number;
    failed:       string[];
}

/** Documents that have stored collab state, as (tenant, report) pairs. Reads ids only, never the state blob. */
export async function listCollabDocRefs(d1: D1Database): Promise<CollabDocRef[]> {
    const rows = await drizzle(d1)
        .select({ tenantId: inspectionResults.tenantId, reportId: inspectionResults.reportId })
        .from(inspectionResults)
        .where(and(isNotNull(inspectionResults.ydocState), isNotNull(inspectionResults.reportId)))
        .all();
    return rows.flatMap((r) => (r.reportId ? [{ tenantId: r.tenantId, reportId: r.reportId }] : []));
}

/** What the copy needs from a namespace. A real `DurableObjectNamespace` is one (`Id` = `DurableObjectId`); so is a test double. */
export interface DocNamespace<Id> {
    idFromName(name: string): Id;
    get(id: Id): { fetch(url: string, init?: RequestInit): Promise<Response> };
}

export async function migrateCollabDocs<Id>(
    refs: CollabDocRef[],
    from: DocNamespace<Id>,
    to: DocNamespace<Id>,
    opts: { dryRun: boolean },
): Promise<MigrationReport> {
    const report: MigrationReport = { total: refs.length, copied: 0, wouldCopy: 0, alreadyThere: 0, empty: 0, failed: [] };
    if (opts.dryRun) {
        report.wouldCopy = refs.length;
        return report;
    }
    for (const { tenantId, reportId } of refs) {
        const name = collabDocName(tenantId, reportId);
        try {
            const exported = await from.get(from.idFromName(name)).fetch('https://do.local/state-export');
            if (!exported.ok) { report.failed.push(`${name}: export returned ${exported.status}`); continue; }
            const body = await exported.text();
            if ((JSON.parse(body) as { ydoc: string | null }).ydoc === null) { report.empty++; continue; }
            const res = await to.get(to.idFromName(name)).fetch('https://do.local/state-import', { method: 'POST', body });
            if (res.status === 409) report.alreadyThere++;
            else if (res.ok) report.copied++;
            else report.failed.push(`${name}: import returned ${res.status}`);
        } catch (e) {
            report.failed.push(`${name}: ${e instanceof Error ? e.message : 'unknown error'}`);
        }
    }
    return report;
}
