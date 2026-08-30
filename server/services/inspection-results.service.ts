import { eq, and } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { inspections, inspectionResults } from '../lib/db/schema';
import { findingKey, DEFAULT_UNIT } from '../lib/finding-key';
import { withoutRepairPriceDeep } from '../lib/repair-price-keys';

/**
 * Typed-Hono dead-routes cleanup Task 10 — vectorised result patches.
 *
 * The single-field PATCH at `/inspections/{id}/items/{itemId}` does one item
 * per request which is fine when the inspector is typing in the editor but
 * crippling for a bulk save that flushes many dirty fields at once. The
 * batch endpoint folds an array of `{ itemId, sectionId, field, value }`
 * patches into the same `inspection_results.data` JSON blob the single-field
 * path mutates, sharing the composite findingKey + version-bump semantics so
 * mixing single + batch writes is safe. It is exposed as an MCP tool and can be
 * driven by any bulk caller, not one specific UI.
 *
 * Conflict adjudication is not done here: every scalar field is forced
 * last-writer-wins.
 *
 * ⚠️ `itemAttribute` IS FOLDED HERE, and used not to be. This comment used to
 * send that shape to `InspectionService.patchItem`, a method that no longer
 * exists anywhere in the repository, so the enum member fell through to the
 * scalar branch below and wrote `entry.itemAttribute = <whatever>`. Nothing
 * reads that key: the editor, the report and every statutory `item_attribute`
 * binding read `entry.attributes[<attributeId>]`. So the answer was accepted,
 * stored, and invisible to every reader of it — an inspector could pick a value
 * from a dropdown and the box on the authority's form stayed empty.
 */

export interface ResultPatch {
    itemId:    string;
    sectionId: string;
    field:     'rating' | 'notes' | 'value' | 'canned' | 'defectFields' | 'itemAttribute';
    /**
     * The new value. For every field but `itemAttribute` it is written whole;
     * for `itemAttribute` it must be `{ attributeId, value }`, because an item
     * has many attributes and a whole-object write would erase the others.
     */
    value:     unknown;
}

/** The `itemAttribute` payload, named so the fold below reads as one thing. */
interface ItemAttributePatchValue {
    attributeId: string;
    value:       unknown;
}

/**
 * Narrow an `itemAttribute` payload, or say exactly what arrived instead.
 *
 * Checked here rather than trusted, even though the request schema checks the
 * same thing: this function is also reachable from the MCP tool and from any
 * other bulk caller, and a payload that slipped through would otherwise write a
 * key nobody reads and report itself as applied.
 */
function itemAttributePatch(raw: unknown, itemId: string): ItemAttributePatchValue {
    const v = raw as Partial<ItemAttributePatchValue> | null;
    if (!v || typeof v !== 'object' || typeof v.attributeId !== 'string' || v.attributeId === '') {
        throw new Error(
            `itemAttribute patch for item "${itemId}" must carry { attributeId, value }; `
            + 'an attribute cannot be written without knowing which one it is.',
        );
    }
    return { attributeId: v.attributeId, value: v.value };
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
        if (p.field === 'itemAttribute') {
            // MERGED, never replaced. One dropdown on the attributes panel sends
            // one attribute, and an item carries up to a dozen of them; writing
            // the object whole would clear every answer beside the one just given.
            const attr = itemAttributePatch(p.value, p.itemId);
            const held = (cur.attributes ?? {}) as Record<string, unknown>;
            next.attributes = {
                ...held,
                [attr.attributeId]: withoutRepairPriceDeep(attr.value),
            };
            next._lastWriter = userId;
            next._lastWriteAt = now;
            data[key] = next;
            continue;
        }
        // `value` is `z.any()` and is folded onto the entry verbatim, which
        // makes this the widest hand-writable door into a finding: an MCP
        // `extended` tool with `write` scope, no shape validation, and no UI
        // between the caller and D1. The product stores no repair price on a
        // finding (scripts/check-price-capability.mjs), so the price keys are
        // stripped at any depth — the payload's shape is not known, so
        // stripping only the level we expect would miss one nested deeper.
        next[p.field] = withoutRepairPriceDeep(p.value);
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

    return { applied: patches.length };
}
