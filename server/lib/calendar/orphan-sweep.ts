import { and, inArray, isNotNull, notExists, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { availabilityOverrides, calendarConnections } from '../db/schema';
import { runAtomically } from '../../services/team/open-assignments';

/**
 * Orphaned synced overrides.
 *
 * A row of availability_overrides with a `source` was imported from a connected
 * calendar. When its connection is gone (an older release deleted only the
 * connection row on disconnect, and removing a member used to leave theirs) the
 * row is never refreshed or removed again, and it keeps hiding the day from
 * customers and showing as Busy. The sync sweep only visits existing
 * connections, so nothing reached these rows.
 *
 * An orphan is a synced row with no connection for the same company, user AND
 * provider. Hand-entered rows (no source) are never orphans. One predicate serves
 * both the cheap "is there work" probe and the delete, so they cannot disagree.
 */
const orphanedSynced = () =>
    and(
        isNotNull(availabilityOverrides.source),
        notExists(
            drizzle({} as D1Database)
                .select({ one: sql`1` })
                .from(calendarConnections)
                .where(sql`${calendarConnections.tenantId} = ${availabilityOverrides.tenantId}
                    AND ${calendarConnections.userId} = ${availabilityOverrides.inspectorId}
                    AND ${calendarConnections.provider} = ${availabilityOverrides.source}`),
        ),
    );

/** D1 allows 100 bound parameters per statement; stay clear of it. */
const DELETE_CHUNK = 90;

export async function hasOrphanedSyncedOverrides(db: D1Database): Promise<boolean> {
    const row = await drizzle(db).select({ id: availabilityOverrides.id }).from(availabilityOverrides).where(orphanedSynced()).limit(1).get();
    return row !== undefined;
}

/**
 * Remove up to `limit` orphaned synced overrides, in one batch. Bounded work per
 * call and idempotent: a second call finds what the first left, then nothing.
 * Returns how many were removed.
 */
export async function removeOrphanedSyncedOverrides(db: D1Database, limit: number): Promise<number> {
    const d = drizzle(db);
    const ids = (await d.select({ id: availabilityOverrides.id }).from(availabilityOverrides).where(orphanedSynced()).limit(limit).all())
        .map((r) => r.id);
    if (ids.length === 0) return 0;
    const writes = [];
    for (let i = 0; i < ids.length; i += DELETE_CHUNK) {
        // The source test again: a row that was reconnected meanwhile is not worth deleting by a stale list.
        writes.push(d.delete(availabilityOverrides).where(and(inArray(availabilityOverrides.id, ids.slice(i, i + DELETE_CHUNK)), isNotNull(availabilityOverrides.source))));
    }
    await runAtomically(d as never, writes);
    return ids.length;
}
