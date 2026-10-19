import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import { z } from '@hono/zod-openapi';
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
 * Returns the connection ids that were removed.
 */
export async function disconnectCalendar(
    db: D1Database,
    tenantId: string,
    userId: string,
    provider?: CalendarProviderId,
): Promise<string[]> {
    const d = drizzle(db);
    const { writes, connectionIds } = await calendarCleanupWrites(d, tenantId, userId, provider);
    await runAtomically(d as never, writes);
    return connectionIds;
}

/**
 * The statements that take a user's calendar integration out of a company, for a
 * caller to run in its own batch (disconnecting, or removing a member together
 * with the soft-delete). Reads the connection ids first; the returned writes are
 * not yet executed. `provider` limits them to one provider; omitted, all.
 */
export async function calendarCleanupWrites(
    d: DrizzleD1Database,
    tenantId: string,
    userId: string,
    provider?: CalendarProviderId,
): Promise<{ writes: unknown[]; connectionIds: string[] }> {
    const connectionScope = and(
        eq(calendarConnections.tenantId, tenantId),
        eq(calendarConnections.userId, userId),
        provider ? eq(calendarConnections.provider, provider) : undefined,
    );
    const connectionIds = (await d.select({ id: calendarConnections.id }).from(calendarConnections).where(connectionScope).all())
        .map((row) => row.id);

    const writes: unknown[] = [
        d.delete(calendarExternalLinks).where(and(
            eq(calendarExternalLinks.tenantId, tenantId),
            eq(calendarExternalLinks.userId, userId),
            provider ? eq(calendarExternalLinks.provider, provider) : undefined,
        )),
        // Synced rows only (source set); a Microsoft connection has no override source, so it matches none.
        d.delete(availabilityOverrides).where(and(
            eq(availabilityOverrides.tenantId, tenantId),
            eq(availabilityOverrides.inspectorId, userId),
            provider === 'google' || provider === 'apple' ? eq(availabilityOverrides.source, provider) : isNotNull(availabilityOverrides.source),
        )),
        ...(connectionIds.length > 0
            ? [d.delete(calendarConnectionReadCalendars).where(and(
                eq(calendarConnectionReadCalendars.tenantId, tenantId),
                inArray(calendarConnectionReadCalendars.connectionId, connectionIds),
            ))]
            : []),
        d.delete(calendarConnections).where(connectionScope),
    ];
    return { writes, connectionIds };
}
