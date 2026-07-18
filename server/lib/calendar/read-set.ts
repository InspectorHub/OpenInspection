import { and, eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { calendarConnections, calendarConnectionReadCalendars } from '../db/schema';
import { Errors } from '../errors';
import type { CalendarListEntry } from './provider';

export interface ResolvedReadSet {
    /** Effective read set (Primary always included), deduped. */
    readCalendarIds: string[];
    writeCalendarId: string;
    /** The read-set entries, carrying summary/accessRole for storage. */
    entries: CalendarListEntry[];
}

const WRITABLE = new Set(['owner', 'writer']);

/**
 * A-polish 10b.3 — validate a proposed read set + write target against the
 * user's available calendars and the locked invariants:
 *   - the write calendar must exist and be editable (accessRole owner|writer);
 *   - the write calendar must be part of the submitted read set (write ∈ read);
 *   - Primary is always included in the effective read set, even if omitted;
 *   - every read id must be a real available calendar.
 * Throws an AppError (400/409) on any violation.
 */
export function resolveReadSet(
    available: CalendarListEntry[],
    input: { readCalendarIds: string[]; writeCalendarId: string },
): ResolvedReadSet {
    const byId = new Map(available.map((c) => [c.id, c]));

    const write = byId.get(input.writeCalendarId);
    if (!write) {
        throw Errors.BadRequest('The selected write calendar was not found.', 'WRITE_CAL_NOT_FOUND');
    }
    if (!WRITABLE.has(write.accessRole)) {
        throw Errors.Conflict('The write calendar must be one you can edit (owner or writer access).');
    }
    if (!input.readCalendarIds.includes(write.id)) {
        throw Errors.Conflict('The write calendar must also be in the read set.');
    }

    // Primary is always read.
    const ids = new Set(input.readCalendarIds);
    const primary = available.find((c) => c.primary);
    if (primary) ids.add(primary.id);

    const entries: CalendarListEntry[] = [];
    for (const id of ids) {
        const entry = byId.get(id);
        if (!entry) {
            throw Errors.BadRequest(`Calendar "${id}" is not one of your calendars.`, 'READ_CAL_NOT_FOUND');
        }
        entries.push(entry);
    }

    return { readCalendarIds: [...ids], writeCalendarId: write.id, entries };
}

/**
 * Replace the persisted read set for a connection and point the write
 * destination (calendar_connections.calendar_id) at the chosen calendar.
 * D1 has no multi-statement transaction; writes are sequential (accepted).
 */
export async function saveReadSet(
    db: DrizzleD1Database,
    params: { tenantId: string; connectionId: string; resolved: ResolvedReadSet },
): Promise<void> {
    const { tenantId, connectionId, resolved } = params;
    const now = new Date();

    await db.delete(calendarConnectionReadCalendars).where(and(
        eq(calendarConnectionReadCalendars.tenantId, tenantId),
        eq(calendarConnectionReadCalendars.connectionId, connectionId),
    ));

    if (resolved.entries.length) {
        await db.insert(calendarConnectionReadCalendars).values(
            resolved.entries.map((e) => ({
                id: crypto.randomUUID(),
                tenantId,
                connectionId,
                externalCalendarId: e.id,
                summary: e.summary,
                accessRole: e.accessRole,
                createdAt: now,
                updatedAt: now,
            })),
        );
    }

    await db.update(calendarConnections)
        .set({ calendarId: resolved.writeCalendarId, updatedAt: now })
        .where(and(
            eq(calendarConnections.tenantId, tenantId),
            eq(calendarConnections.id, connectionId),
        ));
}

/**
 * A-polish 10b.4 — the external calendar ids to READ busy time from for a
 * connection. Falls back to the write/primary calendar when no read set has
 * been configured yet, so existing single-calendar connections keep working.
 */
export async function resolveReadCalendarIds(
    db: DrizzleD1Database,
    params: { tenantId: string; connectionId: string; fallbackCalendarId: string },
): Promise<string[]> {
    const rows = await db.select({ externalCalendarId: calendarConnectionReadCalendars.externalCalendarId })
        .from(calendarConnectionReadCalendars)
        .where(and(
            eq(calendarConnectionReadCalendars.tenantId, params.tenantId),
            eq(calendarConnectionReadCalendars.connectionId, params.connectionId),
        ))
        .all();
    const ids = rows.map((r) => r.externalCalendarId);
    return ids.length ? ids : [params.fallbackCalendarId];
}
