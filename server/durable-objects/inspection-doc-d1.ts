/**
 * The D1 half of the results object's persist: write the projection into the
 * report's `inspection_results` row, creating the row when the inspection has
 * none yet.
 *
 * Split out so the object can tell "the inspection is gone" from "D1 failed".
 * A hard delete (`deleteInspectionCascade`) removes the inspection and its
 * results row while the object may still hold an edit it has not flushed, and
 * the insert that would recreate the row is refused by the foreign key. Without
 * this distinction that refusal surfaced as an unhandled error from a timer and
 * from an alarm that the runtime then retried.
 */

import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import { inspectionResults, inspections } from '../lib/db/schema';
import type { ResultsProjection } from '../lib/collab/results-doc.types';

export type ProjectionWrite = 'written' | 'inspection_gone';

interface Target {
    tenantId:     string;
    inspectionId: string;
    reportId:     string | null;
}

async function inspectionExists(db: ReturnType<typeof drizzle>, tenantId: string, inspectionId: string): Promise<boolean> {
    const rows = await db.select({ id: inspections.id }).from(inspections)
        .where(and(eq(inspections.tenantId, tenantId), eq(inspections.id, inspectionId)))
        .limit(1);
    return rows.length > 0;
}

export async function writeResultsProjection(
    d1: D1Database,
    target: Target,
    stateUpdate: Uint8Array,
    projection: ResultsProjection,
): Promise<ProjectionWrite> {
    const { tenantId, inspectionId, reportId } = target;
    const db = drizzle(d1);
    const values = { ydocState: stateUpdate, data: projection, lastSyncedAt: new Date() };

    const updated = await db
        .update(inspectionResults)
        .set(values)
        .where(
            and(
                eq(inspectionResults.tenantId, tenantId),
                // Per REPORT when we know which one. An inspection can now
                // carry several results rows, and matching on inspection id
                // alone updates all of them with this document.
                reportId
                    ? eq(inspectionResults.reportId, reportId)
                    : eq(inspectionResults.inspectionId, inspectionId),
            ),
        );
    if ((updated.meta?.changes ?? 0) > 0) return 'written';

    // An UPDATE that matches no row is not an error — it quietly changes
    // nothing. `createInspection` does not create this row, so for every
    // inspection made through the wizard that silence WAS the bug: the
    // editor showed ratings, the socket said Connected, and D1 stayed empty.
    // Insert on the way through instead of dropping the document.
    try {
        await db.insert(inspectionResults).values({
            id: crypto.randomUUID(),
            tenantId,
            inspectionId,
            ...(reportId ? { reportId } : {}),
            ...values,
        });
        return 'written';
    } catch (err) {
        // Only one refusal is expected: the inspection was deleted. Anything
        // else is a real failure and keeps failing loudly.
        if (await inspectionExists(db, tenantId, inspectionId)) throw err;
        return 'inspection_gone';
    }
}
