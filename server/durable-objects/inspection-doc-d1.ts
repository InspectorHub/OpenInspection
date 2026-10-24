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
import { and, eq, type SQL } from 'drizzle-orm';
import { inspectionResults, inspections } from '../lib/db/schema';
import type { ResultsProjection } from '@core/field-ui/shared/results-doc.types';
import { isMetaKey } from '@core/field-ui/shared/finding-key';

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

/**
 * The meta keys (the inspector signature) the row holds now. They are written to
 * the blob by routes that do not go through the object, and the document never
 * carries them, so a wholesale replace of `data` would drop them.
 *
 * A failed read THROWS, and so does nothing else here: the caller has already
 * stored the document in the object, the replace is skipped, and the alarm that
 * follows retries the whole write. Writing without the read would risk exactly
 * the loss this exists to prevent; failing like any other D1 error is the safe
 * choice. The read and the write below are two statements, so a signature saved
 * in the instant between them is overwritten by the older one just read; the next
 * save of the signature (or a publish, which signs again) restores it.
 */
// With an empty `reportId` the update below matches EVERY results row of the inspection (and writes the same
// blob into each), while this read returns the first row only: its meta keys are what all rows receive. That
// shape of identity predates this code and is left as it was.
async function currentMetaKeys(db: ReturnType<typeof drizzle>, where: SQL | undefined): Promise<ResultsProjection> {
    const row = await db.select({ data: inspectionResults.data }).from(inspectionResults).where(where).get();
    const data: unknown = row?.data;
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return {};
    return Object.fromEntries(Object.entries(data).filter(([key]) => isMetaKey(key)));
}

export async function writeResultsProjection(
    d1: D1Database,
    target: Target,
    stateUpdate: Uint8Array,
    projection: ResultsProjection,
): Promise<ProjectionWrite> {
    const { tenantId, inspectionId, reportId } = target;
    const db = drizzle(d1);
    const scope = and(
        eq(inspectionResults.tenantId, tenantId),
        // Per REPORT when we know which one. An inspection can now
        // carry several results rows, and matching on inspection id
        // alone updates all of them with this document.
        reportId
            ? eq(inspectionResults.reportId, reportId)
            : eq(inspectionResults.inspectionId, inspectionId),
    );
    // Meta keys come from the row and only from the row; the projection holds none.
    const values = { ydocState: stateUpdate, data: { ...projection, ...await currentMetaKeys(db, scope) }, lastSyncedAt: new Date() };

    const updated = await db
        .update(inspectionResults)
        .set(values)
        .where(scope);
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
