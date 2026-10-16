/**
 * Auto-sign on publish.
 *
 * When the inspection carries the flag AND the assigned inspector has a saved
 * signature, the signature is injected into `inspection_results.data` so the
 * published report renders signed without anyone doing a manual step.
 *
 * Only the person who is the signer, or an owner or manager acting for them, can
 * trigger the stamp; see `maySignFor`.
 */
import { and, eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { inspectionResults, inspections, users } from '../db/schema';
import { isAdminRole } from '../auth/roles';
import { logger } from '../logger';

/** Who is publishing. `role` is the acting user's role as the session carries it. */
export interface AutoSignActor { userId: string; role: string | undefined }

/**
 * The assigned inspector's stored signature goes on the report only when the person
 * publishing may speak for them: the inspector themself, or an owner or manager
 * (the roles that can hold `publish` besides the inspector). A helper, another
 * inspector, or a caller that names nobody does not stamp a signature that is not
 * theirs. The stamp records who published (`publishedBy`) and, when that is not
 * the inspector, whom it stands for (`onBehalfOf`).
 */
export function maySignFor(actor: AutoSignActor | undefined, inspectorId: string): boolean {
    if (!actor) return false;
    return actor.userId === inspectorId || isAdminRole(actor.role);
}

export async function applyAutoSignatureOnPublish(
    db: DrizzleD1Database,
    tenantId: string,
    inspectionId: string,
    actor?: AutoSignActor,
): Promise<void> {
    const insp = await db.select().from(inspections)
        .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
        .get();
    if (!insp?.autoSignOnPublish || !insp.inspectorId) return;

    // Scoped to the tenant: the assigned inspector is read by id, and an id alone is not a boundary.
    const inspector = await db.select().from(users)
        .where(and(eq(users.id, insp.inspectorId), eq(users.tenantId, tenantId))).get();
    if (!inspector?.defaultSignatureBase64) return;

    if (!maySignFor(actor, inspector.id)) {
        // Published without a signature rather than under someone else's name; say so in the log.
        logger.warn('auto-sign skipped: the publisher may not sign for the assigned inspector', { inspectionId, publishedBy: actor?.userId ?? null });
        return;
    }

    const resultsRow = await db.select().from(inspectionResults)
        .where(and(eq(inspectionResults.tenantId, tenantId), eq(inspectionResults.inspectionId, inspectionId))).get();
    const data: Record<string, unknown> = (resultsRow?.data as Record<string, unknown>) ?? {};
    data._inspector_signature = {
        signatureBase64: inspector.defaultSignatureBase64,
        signedAt:        Date.now(),
        userId:          inspector.id,
        auto:            true,
        publishedBy:     actor?.userId ?? null,
        onBehalfOf:      actor && actor.userId !== inspector.id ? inspector.id : null,
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
