import { and, eq, isNull } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { inspectionConflicts } from '../lib/db/schema';

/**
 * Inspection sync conflicts service (Tasks 12-14 of
 * typed-hono-dead-routes-cleanup).
 *
 * Conflicts are persisted by inspection-sync.ts at merge time. The values
 * (base/local/remote) are stored JSON-encoded TEXT; on read we JSON.parse them
 * back so the API surfaces structured values rather than escaped strings.
 */

export interface PendingConflict {
    id:        string;
    itemId:    string;
    sectionId: string | null;
    field:     string;
    base:      unknown;
    local:     unknown;
    remote:    unknown;
    createdAt: string;
}

export interface ConflictResolution {
    itemId:    string;
    sectionId?: string | null | undefined;
    field:     string;
    chosen:    'local' | 'remote' | 'base';
}

function tryParse(s: string | null): unknown {
    if (s === null || s === undefined) return null;
    try {
        return JSON.parse(s);
    } catch {
        return s;
    }
}

/**
 * Lists the currently-pending (unresolved) conflicts for an inspection.
 * Returns an empty array when there are none.
 */
export async function listPendingConflicts(
    db: DrizzleD1Database,
    inspectionId: string,
): Promise<{ conflicts: PendingConflict[] }> {
    const rows = await db
        .select()
        .from(inspectionConflicts)
        .where(
            and(
                eq(inspectionConflicts.inspectionId, inspectionId),
                isNull(inspectionConflicts.resolvedAt),
            ),
        )
        .all();

    const conflicts: PendingConflict[] = rows.map((r) => ({
        id:        r.id,
        itemId:    r.itemId,
        sectionId: r.sectionId ?? null,
        field:     r.field,
        base:      tryParse(r.base),
        local:     tryParse(r.local),
        remote:    tryParse(r.remote),
        createdAt: r.createdAt,
    }));

    return { conflicts };
}

/**
 * Clears conflicts the user has adjudicated. Each resolution targets a
 * (itemId, field) pair within the inspection; all matching pending rows are
 * deleted. The actual data write (applying the chosen side) already happened on
 * the next sync — these rows only track the "needs adjudication" flag, so
 * clearing them is the resolution.
 */
export async function resolveConflicts(
    db: DrizzleD1Database,
    inspectionId: string,
    resolutions: ConflictResolution[],
): Promise<{ resolved: number; resolvedAt: string }> {
    const resolvedAt = new Date().toISOString();
    let resolved = 0;

    for (const r of resolutions) {
        const rows = await db
            .select()
            .from(inspectionConflicts)
            .where(
                and(
                    eq(inspectionConflicts.inspectionId, inspectionId),
                    eq(inspectionConflicts.itemId, r.itemId),
                    eq(inspectionConflicts.field, r.field),
                    isNull(inspectionConflicts.resolvedAt),
                ),
            )
            .all();

        for (const row of rows) {
            await db
                .delete(inspectionConflicts)
                .where(eq(inspectionConflicts.id, row.id));
            resolved++;
        }
    }

    return { resolved, resolvedAt };
}
