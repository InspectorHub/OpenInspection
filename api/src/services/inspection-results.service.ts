import { eq, sql } from 'drizzle-orm';
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
 * Conflict adjudication, apprentice queueing and compound `defectFields` /
 * `itemAttribute` shape-folding live in InspectionService.patchItem — the
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
    db: any,
    inspectionId: string,
    patches: ResultPatch[],
    opts?: { tenantId?: string; userId?: string },
): Promise<ResultsBatchOutcome> {
    if (patches.length === 0) return { applied: 0 };

    // Locate the existing results row. We don't filter by tenant in the
    // service — the route layer already enforces tenant ownership via the
    // standard guard — but if a tenantId is supplied we use it for the
    // insert path so the FK constraint is satisfied.
    const existing = await db.select().from(inspectionResults)
        .where(eq(inspectionResults.inspectionId, inspectionId))
        .get();

    const data: Record<string, Record<string, unknown>> = existing?.data
        ? (typeof existing.data === 'string' ? JSON.parse(existing.data) : existing.data) as Record<string, Record<string, unknown>>
        : {};

    const now = Math.floor(Date.now() / 1000);
    const userId = opts?.userId ?? 'batch';

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

    const tenantId = opts?.tenantId ?? existing?.tenantId;

    if (existing) {
        await db.update(inspectionResults)
            .set({ data: data as unknown as object, lastSyncedAt: new Date() })
            .where(eq(inspectionResults.id, existing.id));
    } else {
        if (!tenantId) {
            throw new Error('applyResultsBatch: no existing results row and no tenantId supplied for insert');
        }
        await db.insert(inspectionResults).values({
            id:           crypto.randomUUID(),
            tenantId,
            inspectionId,
            data:         data as unknown as object,
            lastSyncedAt: new Date(),
        });
    }

    // Bump inspections.dataVersion to mirror the single-field path so offline
    // queues notice that the world moved.
    try {
        await db.update(inspections)
            .set({ dataVersion: sql`${inspections.dataVersion} + 1` })
            .where(eq(inspections.id, inspectionId));
    } catch {
        // dataVersion may be absent on minimal test schemas — silently ignore;
        // the form-renderer doesn't depend on the bump.
    }

    return { applied: patches.length };
}
