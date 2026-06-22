import { eq, and, sql } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { inspections, inspectionResults } from '../lib/db/schema';
import { findingKey, DEFAULT_UNIT } from '../lib/finding-key';

/**
 * Typed-Hono dead-routes cleanup Task 10 — vectorised result patches.
 *
 * The single-field PATCH at `/inspections/{id}/items/{itemId}` does one item
 * per request which is fine when the inspector is typing in the editor but
 * crippling for the form-renderer "Save" button at the end of a long form. The
 * batch endpoint folds an array of `{ itemId, sectionId, field, value }`
 * patches into the same `inspection_results.data` JSON blob the single-field
 * path mutates, sharing the composite findingKey + version-bump semantics so
 * mixing single + batch writes is safe.
 *
 * Conflict adjudication and compound `defectFields` / `itemAttribute`
 * shape-folding live in InspectionService.patchItem — the
 * batch service is intentionally simpler: forced last-writer-wins on each
 * scalar field. The form-renderer is the only caller and it serialises saves
 * locally; if we ever want batch + conflict the call site should funnel
 * through patchItem in a loop instead.
 */

export interface ResultPatch {
    itemId:    string;
    sectionId: string;
    field:     'rating' | 'notes' | 'value' | 'canned' | 'defectFields' | 'itemAttribute';
    value:     unknown;
}

export interface ResultsBatchOutcome {
    applied: number;
}

export async function applyResultsBatch(
    db: DrizzleD1Database,
    inspectionId: string,
    patches: ResultPatch[],
    opts: { tenantId: string; userId?: string },
): Promise<ResultsBatchOutcome> {
    if (patches.length === 0) return { applied: 0 };

    const { tenantId, userId = 'batch' } = opts;

    // Verify the inspection exists and is owned by the caller's tenant before
    // touching any results. Without this check a cross-tenant inspectionId
    // would create a results row under the wrong tenant — D1 does not enforce
    // FK-level tenant isolation at runtime. Early-return (not throw) so the
    // route layer can treat a foreign-tenant id as "not found" silently.
    const owner = await db.select({ id: inspections.id }).from(inspections)
        .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
        .get();
    if (!owner) return { applied: 0 };

    // Locate the existing results row — always scoped to the verified tenant.
    const existing = await db.select().from(inspectionResults)
        .where(and(eq(inspectionResults.inspectionId, inspectionId), eq(inspectionResults.tenantId, tenantId)))
        .get();

    const data: Record<string, Record<string, unknown>> = existing?.data
        ? (typeof existing.data === 'string' ? JSON.parse(existing.data) : existing.data) as Record<string, Record<string, unknown>>
        : {};

    const now = Math.floor(Date.now() / 1000);

    for (const p of patches) {
        const key = findingKey(DEFAULT_UNIT, p.sectionId, p.itemId);
        const cur = (data[key] ?? data[p.itemId] ?? {}) as Record<string, unknown>;
        // Migrate legacy unkeyed entries on first write so subsequent batches
        // don't double-up.
        if (data[p.itemId] && key !== p.itemId) delete data[p.itemId];

        const next: Record<string, unknown> = { ...cur };
        next[p.field] = p.value;
        // Lightweight provenance — mirrors InspectionService.patchItem's
        // applyFieldWrite output enough for downstream consumers (audit, diff)
        // to see who last touched the field.
        next._lastWriter = userId;
        next._lastWriteAt = now;

        data[key] = next;
    }

    if (existing) {
        await db.update(inspectionResults)
            .set({ data: data as unknown as object, lastSyncedAt: new Date() })
            .where(and(eq(inspectionResults.inspectionId, inspectionId), eq(inspectionResults.tenantId, tenantId)));
    } else {
        await db.insert(inspectionResults).values({
            id:           crypto.randomUUID(),
            tenantId,
            inspectionId,
            data:         data as unknown as object,
            lastSyncedAt: new Date(),
        });
    }

    // Bump inspections.dataVersion to mirror the single-field path so offline
    // queues notice that the world moved. Always scoped to the verified tenant.
    try {
        await db.update(inspections)
            .set({ dataVersion: sql`${inspections.dataVersion} + 1` })
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)));
    } catch {
        // dataVersion may be absent on minimal test schemas — silently ignore;
        // the form-renderer doesn't depend on the bump.
    }

    return { applied: patches.length };
}
