/**
 * Auto-sign on publish.
 *
 * When the inspection carries the flag AND the assigned inspector has a saved
 * signature, the signature is injected into `inspection_results.data` so the
 * published report renders signed without anyone doing a manual step.
 *
 * Behaviour-preserving extraction from the publish service — the body is a move,
 * not a rewrite.
 */
import { and, eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { inspectionResults, inspections, users } from '../db/schema';

export async function applyAutoSignatureOnPublish(
    db: DrizzleD1Database,
    tenantId: string,
    inspectionId: string,
): Promise<void> {
    const insp = await db.select().from(inspections)
        .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
        .get();
    if (!insp?.autoSignOnPublish || !insp.inspectorId) return;

    const inspector = await db.select().from(users)
        .where(eq(users.id, insp.inspectorId)).get();
    if (!inspector?.defaultSignatureBase64) return;

    const resultsRow = await db.select().from(inspectionResults)
        .where(eq(inspectionResults.inspectionId, inspectionId)).get();
    const data: Record<string, unknown> = (resultsRow?.data as Record<string, unknown>) ?? {};
    data._inspector_signature = {
        signatureBase64: inspector.defaultSignatureBase64,
        signedAt:        Date.now(),
        userId:          inspector.id,
        auto:            true,
    };

    if (resultsRow) {
        await db.update(inspectionResults)
            .set({ data: data as object, lastSyncedAt: new Date() })
            .where(and(eq(inspectionResults.id, resultsRow.id), eq(inspectionResults.tenantId, tenantId)));
    } else {
        await db.insert(inspectionResults).values({
            id:           crypto.randomUUID(),
            tenantId,
            inspectionId,
            data:         data as object,
            lastSyncedAt: new Date(),
        });
    }
}
