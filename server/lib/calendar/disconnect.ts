import { and, count, eq, inArray, isNotNull } from 'drizzle-orm';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import { z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { HonoConfig } from '../../types/hono';
import { auditFromContext } from '../audit';
import {
    availabilityOverrides,
    calendarConnectionReadCalendars,
    calendarConnections,
    calendarExternalLinks,
} from '../db/schema';
import type { CalendarProviderId } from './provider';
import { runAtomically } from '../../services/team/open-assignments';

export const DisconnectQuerySchema = z.object({
    provider: z.enum(['google', 'apple']).optional().describe('Disconnect only this provider. Omit to disconnect every provider.'),
});

export const DISCONNECT_DESCRIPTION = 'Disconnects the calling user calendar and removes what it synced, in one atomic batch scoped to the caller and their company: the connection, the busy blocks imported from it (date overrides with that source), the read-calendar choices and the links to events on the calendar. Hand-entered overrides are never touched, and events in the external calendar are not changed. The optional provider limits the disconnect to google or apple; omitted, every provider the caller is connected to is disconnected. An unknown provider is a 400.';

/**
 * Disconnect a user's calendar and remove what it brought with it.
 *
 * Deleting only the connection row left, for as long as nothing else cleaned
 * them up: the busy blocks it had imported (rows of availability_overrides with a
 * `source`), which kept hiding the person's days from customers and showing as
 * "Busy" on the calendar; the choice of which calendars to read; and the links to
 * events on the calendar being left. All four go in ONE batch (D1's atomic
 * primitive), scoped to this company and this user.
 *
 * `provider` limits the disconnect to one provider. Omitted, it means every
 * provider the user is connected to, which is what the endpoint did before the
 * parameter existed. Rows the person typed in themselves (no `source`) are never
 * touched. The external events themselves are not: they live in the other
 * calendar, and no credentials are left to remove them with.
 *
 * Returns what was removed, as counts (for the audit record, which never carries names).
 */
interface CalendarCleanupCounts {
    connections: number;
    syncedBusyBlocks: number;
    readCalendars: number;
    eventLinks: number;
}

async function disconnectCalendar(
    db: D1Database,
    tenantId: string,
    userId: string,
    provider?: CalendarProviderId,
): Promise<CalendarCleanupCounts> {
    const d = drizzle(db);
    // The counts are a report. The batch below selects its own scope inside each statement, so what it
    // removes never depends on this read (a reconnect in between is cleaned too, not orphaned).
    const counts = await countCalendarCleanup(d, tenantId, userId, provider);
    await runAtomically(d as never, calendarCleanupWrites(d, tenantId, userId, provider));
    return counts;
}

/**
 * The endpoint's disconnect: removes the integration, then records it. The audit row carries the
 * provider and counts only (no names or addresses), and nothing is recorded when nothing was connected.
 */
export async function disconnectAndAudit(c: Context<HonoConfig>, tenantId: string, userId: string, provider?: CalendarProviderId): Promise<void> {
    const removed = await disconnectCalendar(c.env.DB, tenantId, userId, provider);
    if (removed.connections + removed.syncedBusyBlocks + removed.readCalendars + removed.eventLinks > 0) {
        auditFromContext(c, 'calendar.disconnect', 'calendar_connection', { metadata: { provider: provider ?? 'all', ...removed } });
    }
}

const scopeOf = (tenantId: string, userId: string, provider?: CalendarProviderId) => and(
    eq(calendarConnections.tenantId, tenantId),
    eq(calendarConnections.userId, userId),
    provider ? eq(calendarConnections.provider, provider) : undefined,
);
const linkScopeOf = (tenantId: string, userId: string, provider?: CalendarProviderId) => and(
    eq(calendarExternalLinks.tenantId, tenantId),
    eq(calendarExternalLinks.userId, userId),
    provider ? eq(calendarExternalLinks.provider, provider) : undefined,
);
// Synced rows only (source set). With no provider: every synced row. With google or apple: that source.
// Any other provider (microsoft has no override source) matches NOTHING, never "every synced row".
const overrideScopeOf = (tenantId: string, userId: string, provider?: CalendarProviderId) => and(
    eq(availabilityOverrides.tenantId, tenantId),
    eq(availabilityOverrides.inspectorId, userId),
    provider === undefined ? isNotNull(availabilityOverrides.source)
        : provider === 'google' || provider === 'apple' ? eq(availabilityOverrides.source, provider)
            : inArray(availabilityOverrides.source, []), // an empty list matches nothing
);

/** How many rows of each kind a cleanup with this scope would remove right now. */
export async function countCalendarCleanup(
    d: DrizzleD1Database,
    tenantId: string,
    userId: string,
    provider?: CalendarProviderId,
): Promise<CalendarCleanupCounts> {
    const n = async (q: Promise<Array<{ n: number }>>) => (await q)[0]?.n ?? 0;
    return {
        connections: await n(d.select({ n: count() }).from(calendarConnections).where(scopeOf(tenantId, userId, provider)).all()),
        syncedBusyBlocks: await n(d.select({ n: count() }).from(availabilityOverrides).where(overrideScopeOf(tenantId, userId, provider)).all()),
        readCalendars: await n(d.select({ n: count() }).from(calendarConnectionReadCalendars).where(and(
            eq(calendarConnectionReadCalendars.tenantId, tenantId),
            inArray(calendarConnectionReadCalendars.connectionId, d.select({ id: calendarConnections.id }).from(calendarConnections).where(scopeOf(tenantId, userId, provider))),
        )).all()),
        eventLinks: await n(d.select({ n: count() }).from(calendarExternalLinks).where(linkScopeOf(tenantId, userId, provider)).all()),
    };
}

/**
 * The statements that take a user's calendar integration out of a company, for a
 * caller to run in its own batch (disconnecting, or removing a member together
 * with the soft-delete). Nothing is read first: the read-calendar delete picks
 * its connections with a subselect, and it is ordered BEFORE the connection
 * delete, so the whole removal is decided inside the one atomic batch.
 * `provider` limits them to one provider; omitted, all.
 */
export function calendarCleanupWrites(
    d: DrizzleD1Database,
    tenantId: string,
    userId: string,
    provider?: CalendarProviderId,
): unknown[] {
    return [
        d.delete(calendarExternalLinks).where(linkScopeOf(tenantId, userId, provider)),
        d.delete(availabilityOverrides).where(overrideScopeOf(tenantId, userId, provider)),
        d.delete(calendarConnectionReadCalendars).where(and(
            eq(calendarConnectionReadCalendars.tenantId, tenantId),
            inArray(calendarConnectionReadCalendars.connectionId, d.select({ id: calendarConnections.id }).from(calendarConnections).where(scopeOf(tenantId, userId, provider))),
        )),
        d.delete(calendarConnections).where(scopeOf(tenantId, userId, provider)),
    ];
}
