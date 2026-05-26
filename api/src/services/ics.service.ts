import { drizzle } from 'drizzle-orm/d1';
import { and, eq, ne } from 'drizzle-orm';
import { users } from '../lib/db/schema/tenant';
import { inspections } from '../lib/db/schema/inspection';

/**
 * Booking #7 Sprint C-2 — Busy-only iCal feed service.
 *
 * Powers `GET /inspector/<tenant>/<slug>/calendar.ics` so partner agents can subscribe
 * to an inspector's availability without ever seeing customer-facing PII
 * (no addresses, names, or emails). Confirmed-only events; cancellations
 * disappear from the feed so subscribers see the freed slot.
 *
 * Uses the same drizzle-on-D1 pattern as UserService so unit tests can swap
 * the underlying DB via the `drizzle-orm/d1` module mock.
 */
export class IcsService {
    constructor(private db: D1Database, private host: string = 'openinspection') {}

    private getDrizzle() { return drizzle(this.db); }

    private toUtcStamp(date: string, time: string): string {
        // `date` is YYYY-MM-DD or full ISO timestamp from D1; slice to date-only.
        const day = date.slice(0, 10);
        return new Date(`${day}T${time}:00Z`)
            .toISOString()
            .replace(/[-:]/g, '')
            .replace(/\.\d{3}/, '');
    }

    private emptyCalendar(): string {
        return [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//OpenInspection//Inspector Busy//EN',
            'CALSCALE:GREGORIAN',
            'END:VCALENDAR',
        ].join('\r\n');
    }

    /**
     * Returns an RFC-5545 calendar showing the inspector as busy on every
     * confirmed inspection. The body intentionally omits LOCATION / DESCRIPTION
     * so subscribers see only opaque busy blocks — addresses, client names,
     * and emails never leave the system.
     */
    async busyFeedForInspector(tenantId: string, slug: string): Promise<string> {
        const db = this.getDrizzle();
        const user = await db.select({ id: users.id }).from(users)
            .where(and(eq(users.tenantId, tenantId), eq(users.slug, slug)))
            .get();
        if (!user) return this.emptyCalendar();

        const rows = await db.select({
            id:   inspections.id,
            date: inspections.date,
        }).from(inspections)
            .where(and(
                eq(inspections.tenantId, tenantId),
                eq(inspections.inspectorId, user.id),
                ne(inspections.status, 'cancelled'),
            ))
            .all();

        const events = rows.map((r) => {
            const start = this.toUtcStamp(r.date, '08:00');
            const end   = this.toUtcStamp(r.date, '12:00');
            return [
                'BEGIN:VEVENT',
                `UID:${r.id}@${this.host}`,
                `DTSTART:${start}`,
                `DTEND:${end}`,
                'SUMMARY:Busy',
                'TRANSP:OPAQUE',
                'END:VEVENT',
            ].join('\r\n');
        });

        return [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//OpenInspection//Inspector Busy//EN',
            'CALSCALE:GREGORIAN',
            ...events,
            'END:VCALENDAR',
        ].join('\r\n');
    }
}
