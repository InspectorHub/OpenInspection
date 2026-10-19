import { and, eq, inArray } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { inspections } from '../lib/db/schema';
import { visibleInspectionsCondition, type InspectionScope } from '../lib/inspection/visibility';
import { VISIBLE_IDS_PER_QUERY } from '../lib/native/visibility-limits';

type DB = Pick<DrizzleD1Database<Record<string, unknown>>, 'select'>;

/**
 * Which of `ids` exist in this company and are visible to `scope`, in request order and without repeats.
 *
 * Existence is always queried, whatever the scope: the shared `filterVisibleInspectionIds` answers
 * "everything" for an unrestricted scope without touching the database, which would report a deleted
 * inspection as still there. The scope condition is the list endpoint's own (`visibleInspectionsCondition`),
 * so the two cannot drift. A restricted caller therefore learns nothing from this answer about an id that
 * exists but is not theirs: it is absent, exactly like an id that does not exist.
 *
 * Lookups are chunked under D1's bind-parameter ceiling (see `visibility-limits.ts`).
 */
export async function findVisibleInspectionIds(db: DB, scope: InspectionScope, tenantId: string, ids: readonly string[]): Promise<string[]> {
    const unique = [...new Set(ids)];
    const found = new Set<string>();
    for (let i = 0; i < unique.length; i += VISIBLE_IDS_PER_QUERY) {
        const rows = await db.select({ id: inspections.id }).from(inspections).where(and(
            eq(inspections.tenantId, tenantId),
            inArray(inspections.id, unique.slice(i, i + VISIBLE_IDS_PER_QUERY)),
            visibleInspectionsCondition(db, scope, tenantId),
        )).all();
        for (const r of rows) found.add(r.id);
    }
    return unique.filter((id) => found.has(id));
}
