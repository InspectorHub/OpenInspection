import { drizzle } from 'drizzle-orm/d1';
import { and, eq, ne } from 'drizzle-orm';
import { users, tenantConfigs } from '../lib/db/schema';
import { inspections, inspectionInspectors } from '../lib/db/schema';
import { resolveTenantTimeZone, wallClockToEpochMs } from '../lib/tz';

/**
 * The per-inspector iCal feeds.
 *
 * Two feeds, one query shape, deliberately different payloads:
 *
 *  - **busy** (`/inspector/<tenant>/<slug>/calendar.ics`) — opaque "Busy"
 *    blocks with no addresses, names or emails. Addressed by the public slug
 *    because there is nothing in it to protect.
 *  - **schedule** (`/api/ics/inspector/<token>`) — the same appointments WITH
 *    the property address, for the inspector's own phone. Addressed by a
 *    sealed token, never the slug: `/inspector/` is unauthenticated and a slug
 *    is a name, so a guessable URL would hand out someone's daily route.
 *
 * WHO worked an inspection is read from `inspection_inspectors` through the
 * roster join — never `inspections.inspector_id`, which is a frozen legacy
 * column. Reading the column made this feed disagree with every other surface:
 * an inspection assigned through the link table (which is all of them) simply
 * did not appear.
 *
 * TIMES ARE INSTANTS. `scheduled_start_ms` when the row has one, otherwise the
 * civil date read in the TENANT timezone. The previous version composed
 * `new Date(`${day}T${time}:00Z`)`, which labels a wall clock as UTC: an 08:00
 * appointment in America/New_York was published to subscribers as 08:00Z —
 * 04:00 local, four hours before it happens.
 */

/** Fallback window when a row carries no instant and no duration. */
const DEFAULT_START_HM = '08:00';
const DEFAULT_DURATION_MIN = 240;

interface FeedRow {
    id: string;
    date: string;
    scheduledStartMs: Date | null;
    scheduledEndMs: Date | null;
    durationMin: number | null;
    propertyAddress: string;
}

export class IcsService {
    constructor(private db: D1Database, private host: string = 'openinspection') {}

    private getDrizzle() { return drizzle(this.db); }

    private async tenantTimeZone(tenantId: string): Promise<string> {
        const row = await this.getDrizzle()
            .select({ defaultTimezone: tenantConfigs.defaultTimezone })
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .get();
        return resolveTenantTimeZone(row?.defaultTimezone);
    }

    /** UTC epoch ms -> RFC-5545 UTC stamp (`YYYYMMDDTHHMMSSZ`). */
    private stamp(ms: number): string {
        return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    }

    /**
     * The instant range for one row, in the tenant zone. Same ladder the Google
     * push uses, so the calendar entry and the ICS feed can never disagree
     * about when an inspection is.
     */
    private window(row: FeedRow, tz: string): { startMs: number; endMs: number } {
        const stamped = row.scheduledStartMs instanceof Date ? row.scheduledStartMs.getTime() : null;
        const day = row.date.slice(0, 10);
        const hm = row.date.length > 10 && /^\d{2}:\d{2}$/.test(row.date.slice(11, 16))
            ? row.date.slice(11, 16)
            : DEFAULT_START_HM;
        const startMs = stamped ?? wallClockToEpochMs(day, hm, tz);

        const stampedEnd = row.scheduledEndMs instanceof Date ? row.scheduledEndMs.getTime() : null;
        const endMs = stampedEnd != null && stampedEnd > startMs
            ? stampedEnd
            : startMs + (row.durationMin ?? DEFAULT_DURATION_MIN) * 60_000;
        return { startMs, endMs };
    }

    /**
     * Inspections this user LEADS, via the link table. Helper assignments are
     * excluded on purpose: these feeds answer "where do I have to be", and the
     * lead is the person who owns the appointment.
     */
    private async leadAssignments(tenantId: string, userId: string): Promise<FeedRow[]> {
        return this.getDrizzle().select({
            id: inspections.id,
            date: inspections.date,
            scheduledStartMs: inspections.scheduledStartMs,
            scheduledEndMs: inspections.scheduledEndMs,
            durationMin: inspections.durationMin,
            propertyAddress: inspections.propertyAddress,
        })
            .from(inspectionInspectors)
            .innerJoin(inspections, eq(inspections.id, inspectionInspectors.inspectionId))
            .where(and(
                eq(inspectionInspectors.tenantId, tenantId),
                eq(inspectionInspectors.userId, userId),
                eq(inspectionInspectors.role, 'lead'),
                ne(inspections.status, 'cancelled'),
            ))
            .all() as Promise<FeedRow[]>;
    }

    private wrap(name: string, events: string[]): string {
        return [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            `PRODID:-//OpenInspection//${name}//EN`,
            'CALSCALE:GREGORIAN',
            ...events,
            'END:VCALENDAR',
        ].join('\r\n');
    }

    private static escape(s: string): string {
        return (s ?? '')
            .replace(/\\/g, '\\\\')
            .replace(/;/g, '\\;')
            .replace(/,/g, '\\,')
            .replace(/\n/g, '\\n');
    }

    /**
     * Opaque busy blocks for an inspector, by public slug. The body carries no
     * LOCATION / DESCRIPTION so addresses, client names and emails never leave
     * the system. Cancelled inspections drop out so subscribers see the slot
     * freed.
     */
    async busyFeedForInspector(tenantId: string, slug: string): Promise<string> {
        const user = await this.getDrizzle().select({ id: users.id }).from(users)
            .where(and(eq(users.tenantId, tenantId), eq(users.slug, slug)))
            .get();
        if (!user) return this.wrap('Inspector Busy', []);

        const tz = await this.tenantTimeZone(tenantId);
        const rows = await this.leadAssignments(tenantId, user.id);

        const events = rows.map((r) => {
            const { startMs, endMs } = this.window(r, tz);
            return [
                'BEGIN:VEVENT',
                `UID:${r.id}@${this.host}`,
                `DTSTART:${this.stamp(startMs)}`,
                `DTEND:${this.stamp(endMs)}`,
                'SUMMARY:Busy',
                'TRANSP:OPAQUE',
                'END:VEVENT',
            ].join('\r\n');
        });
        return this.wrap('Inspector Busy', events);
    }

    /**
     * The inspector's own schedule, addresses included. Caller must have
     * resolved the sealed token to (tenantId, userId) first — this method never
     * sees a slug, so there is no path by which a guessed name reaches it.
     */
    async scheduleFeedForInspector(tenantId: string, userId: string): Promise<string> {
        const tz = await this.tenantTimeZone(tenantId);
        const rows = await this.leadAssignments(tenantId, userId);

        const events = rows.map((r) => {
            const { startMs, endMs } = this.window(r, tz);
            const address = IcsService.escape(r.propertyAddress ?? '');
            return [
                'BEGIN:VEVENT',
                `UID:${r.id}@${this.host}`,
                `DTSTART:${this.stamp(startMs)}`,
                `DTEND:${this.stamp(endMs)}`,
                `SUMMARY:${address || 'Inspection'}`,
                ...(address ? [`LOCATION:${address}`] : []),
                'TRANSP:OPAQUE',
                'END:VEVENT',
            ].join('\r\n');
        });
        return this.wrap('Inspector Schedule', events);
    }
}
