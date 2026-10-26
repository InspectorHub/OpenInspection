import { and, eq, inArray } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { inspectionTombstones } from '../db/schema';

/** D1 allows 100 bound parameters per statement; leave room for the tenant id. */
const CHUNK = 80;

/**
 * The ids among `ids` that name an inspection this company deleted. Always filtered by `tenantId`: another
 * company's tombstone for the same id is not an answer here. Reads only.
 */
export async function findTombstonedIds(
    db: DrizzleD1Database,
    tenantId: string,
    ids: readonly string[],
): Promise<string[]> {
    const found: string[] = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
        const rows = await db.select({ id: inspectionTombstones.inspectionId })
            .from(inspectionTombstones)
            .where(and(eq(inspectionTombstones.tenantId, tenantId), inArray(inspectionTombstones.inspectionId, ids.slice(i, i + CHUNK))));
        found.push(...rows.map((r) => r.id));
    }
    return found;
}
