import { and, asc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import {
    availabilityOverrides,
    calendarBlocks,
    eventTypes,
    inspectionEvents,
    inspectionInspectors,
    inspections,
} from '../lib/db/schema';
import {
    loadCustomHolidaysInRange,
    loadTenantHolidayConfig,
    resolveCompanyClosedDatesInRange,
} from '../lib/holidays/load-tenant-holidays';
import { epochMsToRfc3339, resolveTenantTimeZone, wallClockToEpochMs } from '../lib/tz';

/** Civil date (YYYY-MM-DD) + wall-clock (HH:MM) of an instant in `tz`. */
function civilPartsInTz(ms: number, tz: string): { civilDate: string; time: string } {
    const rfc = epochMsToRfc3339(ms, tz); // e.g. 2026-07-18T04:00:00+08:00
    return { civilDate: rfc.slice(0, 10), time: rfc.slice(11, 16) };
}

type CalendarItemKind =
    | 'inspection'
    | 'inspection_event'
    | 'calendar_block'
    | 'external_busy'
    | 'company_holiday';

export interface CalendarItem {
    id: string;
    kind: CalendarItemKind;
    title: string;
    start: string;
    end: string;
    /**
     * Civil day this item belongs to (YYYY-MM-DD) in the viewer's effective
     * timezone. The frontend buckets calendar cells by this string alone — it
     * MUST NOT re-derive the day from `start` via `toISOString()`, which rolls
     * back a day in UTC-positive zones (the calendar off-by-one bug).
     */
    civilDate: string;
    /** Wall-clock start (HH:MM) in the effective timezone; omitted for all-day. */
    startTime?: string;
    /** Wall-clock end (HH:MM) in the effective timezone; omitted for all-day. */
    endTime?: string;
    allDay: boolean;
    color?: string;
    inspectionId?: string;
    userId?: string;
    meta?: Record<string, unknown>;
}

export interface ListCalendarItemsInput {
    start: string;
    end: string;
    userIds?: string[];
    /**
     * IANA timezone the viewer sees the calendar in (user override ?? tenant
     * default). Instant-based items (inspection events) are converted into this
     * zone for `civilDate`/`startTime`; civil-stored items pass through. Defaults
     * to 'UTC' for legacy callers.
     */
    effectiveTz?: string;
}

interface CalendarRange {
    startDate: string;
    endDate: string;
    startInstant: Date;
    endInstant: Date;
}

function toRange(input: Pick<ListCalendarItemsInput, 'start' | 'end'>): CalendarRange {
    const startIsCivil = /^\d{4}-\d{2}-\d{2}$/.test(input.start);
    const endIsCivil = /^\d{4}-\d{2}-\d{2}$/.test(input.end);
    return {
        startDate: input.start.slice(0, 10),
        endDate: input.end.slice(0, 10),
        // Coarse UTC window bounds for the event-instant range only; civil rows are
        // filtered by string date and the loader over-fetches ±a month, so UTC-vs-
        // tenant-tz edges never drop an in-view item.
        startInstant: new Date(startIsCivil ? `${input.start}T00:00:00.000Z` : input.start), // tz-lint-ok: coarse window
        endInstant: new Date(endIsCivil ? `${input.end}T23:59:59.999Z` : input.end), // tz-lint-ok: coarse window
    };
}

/**
 * Instant for a civil date + wall-clock time interpreted in `tz`. Blocks and
 * busy overrides store a floating wall clock (the inspector's own tz); anchoring
 * via `wallClockToEpochMs` means the detail modal, formatting this instant back
 * in the same effective tz, shows the stored HH:MM — not a UTC-shifted time.
 */
function timedIso(date: string, time: string, tz: string): string {
    return new Date(wallClockToEpochMs(date, time, tz)).toISOString();
}

/**
 * The civil day and wall-clock start that an `inspections.date` value carries.
 *
 * That column is TEXT and three shapes are in circulation, all of them written
 * by code that is still live:
 *
 *   `2026-09-10`                 a day and nothing else
 *   `2026-09-10T09:00`           PATCH /inspections/:id/schedule — `${civilDate}T${hm}`,
 *                                where `hm` is already the TENANT wall clock
 *   `YYYY-MM-DDTHH:MM:SS.sssZ`   every create path — `scheduledAt.toISOString()`
 *                                (booking fulfilment, multi-service requests)
 *
 * This feed used to copy `row.date` straight into `civilDate` and hardcode
 * `allDay: true`. Both are wrong for the last two shapes, and each one broke a
 * different surface without raising anything:
 *
 *   - the calendar grids key their cells with `civilDateOf()` = `YYYY-MM-DD`, so
 *     a `civilDate` carrying the full timestamp matched no cell. A tenant whose
 *     inspections all carry a time saw an entirely blank month while the very
 *     same rows sat in the page's own loader payload.
 *   - the dispatch board places a card only when the item has a `startTime`, so
 *     every timed inspection fell into the all-day strip and the 7am–7pm grid
 *     stayed empty — while the ICS feed, reading the SAME column at
 *     `slice(11, 16)` (see `ics.service.window`), published the right hour.
 *
 * The time is read by STRING SLICE, never by parsing the value as an instant.
 * That is the interpretation `ics.service` and the booking busy checks already
 * apply to this column, so the three consumers agree on one answer; and a slice
 * has no timezone in it, so it cannot shift a civil day the way UTC bucketing
 * does. An unparseable suffix yields no time rather than a guessed hour.
 */
export function inspectionWallClock(rawDate: string): { civilDate: string; startTime: string | null } {
    const hm = rawDate.slice(11, 16);
    return {
        civilDate: rawDate.slice(0, 10),
        startTime: /^\d{2}:\d{2}$/.test(hm) ? hm : null,
    };
}

/**
 * Virtual company-holiday calendar items whenever holiday_region is set and
 * the civil date is in the resolved catalog (independent of public policy).
 */
async function listCompanyHolidayItems(
    database: D1Database,
    tenantId: string,
    input: ListCalendarItemsInput,
): Promise<CalendarItem[]> {
    const config = await loadTenantHolidayConfig(database, tenantId);
    if (!config.holidayRegion) return [];

    const range = toRange(input);
    const custom = await loadCustomHolidaysInRange(
        database,
        tenantId,
        range.startDate,
        range.endDate,
    );
    const catalog = resolveCompanyClosedDatesInRange({
        region: config.holidayRegion,
        customRows: custom,
        startDate: range.startDate,
        endDate: range.endDate,
    });

    return [...catalog.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, name]) => ({
            id: `holiday:${date}`,
            kind: 'company_holiday' as const,
            title: name,
            start: date,
            end: date,
            civilDate: date,
            allDay: true,
            meta: { holidayName: name },
        }));
}

export async function listCalendarItems(
    database: D1Database,
    tenantId: string,
    input: ListCalendarItemsInput,
): Promise<CalendarItem[]> {
    const db = drizzle(database);
    const range = toRange(input);
    const effectiveTz = resolveTenantTimeZone(input.effectiveTz);
    const selectedUsers = input.userIds?.length ? input.userIds : undefined;

    // Compare the DATE PART, not the raw column. `inspections.date` is TEXT and
    // holds either `YYYY-MM-DD` or a datetime (`YYYY-MM-DDTHH:MM`, and full ISO
    // for rows the create endpoint wrote) — the schedule endpoint deliberately
    // preserves a time suffix because the busy checks read HH:MM back out of it.
    // A plain string `<=` then excludes every timed row on the LAST day of the
    // window, because '2026-08-05T08:00' sorts after '2026-08-05'.
    //
    // The month-wide calendar never noticed: it over-fetches ±a month, so its
    // final day holds nothing anyone looks at. The dispatch board asks for a
    // SINGLE day (start === end), where that day is the only day — so a job
    // dropped onto a column vanished from the board it was dropped on.
    const civilDate = sql`substr(${inspections.date}, 1, 10)`;
    const inspectionWhere = and(
        eq(inspections.tenantId, tenantId),
        gte(civilDate, range.startDate),
        lte(civilDate, range.endDate),
        selectedUsers
            ? or(
                inArray(inspections.inspectorId, selectedUsers),
                inArray(inspectionInspectors.userId, selectedUsers),
            )
            : undefined,
    );

    const inspectionRows = await db.select({
        id: inspections.id,
        propertyAddress: inspections.propertyAddress,
        date: inspections.date,
        status: inspections.status,
        inspectorId: inspections.inspectorId,
        assignedUserId: inspectionInspectors.userId,
    })
        .from(inspections)
        .leftJoin(inspectionInspectors, and(
            eq(inspectionInspectors.inspectionId, inspections.id),
            eq(inspectionInspectors.tenantId, tenantId),
            selectedUsers ? inArray(inspectionInspectors.userId, selectedUsers) : undefined,
        ))
        .where(inspectionWhere)
        .orderBy(asc(inspections.date), asc(inspections.id));

    const inspectionItems = new Map<string, CalendarItem>();
    for (const row of inspectionRows) {
        if (inspectionItems.has(row.id)) continue;
        const userId = row.assignedUserId ?? row.inspectorId;
        // `inspections.date` is not a civil date — see `inspectionWallClock`. The
        // raw column value is a cell key no grid asks for, and discarding its
        // time suffix is what emptied the dispatch time axis.
        const { civilDate: day, startTime } = inspectionWallClock(row.date);
        const allDay = startTime === null;
        const instant = allDay ? day : timedIso(day, startTime, effectiveTz);
        inspectionItems.set(row.id, {
            id: row.id,
            kind: 'inspection',
            title: row.propertyAddress,
            start: instant,
            end: instant,
            civilDate: day,
            ...(allDay ? {} : { startTime }),
            allDay,
            inspectionId: row.id,
            ...(userId ? { userId } : {}),
            meta: { status: row.status },
        });
    }

    const eventRows = await db.select({
        id: inspectionEvents.id,
        inspectionId: inspectionEvents.inspectionId,
        inspectorId: inspectionEvents.inspectorId,
        scheduledAt: inspectionEvents.scheduledAt,
        durationMin: inspectionEvents.durationMin,
        status: inspectionEvents.status,
        eventTypeId: inspectionEvents.eventTypeId,
        eventTypeName: eventTypes.name,
        color: eventTypes.color,
    })
        .from(inspectionEvents)
        .leftJoin(eventTypes, and(
            eq(eventTypes.id, inspectionEvents.eventTypeId),
            eq(eventTypes.tenantId, tenantId),
        ))
        .where(and(
            eq(inspectionEvents.tenantId, tenantId),
            gte(inspectionEvents.scheduledAt, range.startInstant),
            lte(inspectionEvents.scheduledAt, range.endInstant),
            selectedUsers ? inArray(inspectionEvents.inspectorId, selectedUsers) : undefined,
        ))
        .orderBy(asc(inspectionEvents.scheduledAt), asc(inspectionEvents.id));

    const eventItems: CalendarItem[] = eventRows.map((row) => {
        const start = row.scheduledAt;
        const end = new Date(start.getTime() + row.durationMin * 60_000);
        const startParts = civilPartsInTz(start.getTime(), effectiveTz);
        const endParts = civilPartsInTz(end.getTime(), effectiveTz);
        return {
            id: row.id,
            kind: 'inspection_event',
            title: row.eventTypeName ?? 'Inspection event',
            start: start.toISOString(),
            end: end.toISOString(),
            civilDate: startParts.civilDate,
            startTime: startParts.time,
            endTime: endParts.time,
            allDay: false,
            ...(row.color ? { color: row.color } : {}),
            inspectionId: row.inspectionId,
            ...(row.inspectorId ? { userId: row.inspectorId } : {}),
            meta: {
                eventTypeId: row.eventTypeId,
                status: row.status,
                durationMin: row.durationMin,
            },
        };
    });

    const blockRows = await db.select()
        .from(calendarBlocks)
        .where(and(
            eq(calendarBlocks.tenantId, tenantId),
            gte(calendarBlocks.date, range.startDate),
            lte(calendarBlocks.date, range.endDate),
            selectedUsers ? inArray(calendarBlocks.userId, selectedUsers) : undefined,
        ))
        .orderBy(asc(calendarBlocks.date), asc(calendarBlocks.startTime), asc(calendarBlocks.id));

    const blockItems: CalendarItem[] = blockRows.map((row) => {
        const allDay = row.allDay || !row.startTime;
        return {
            id: row.id,
            kind: 'calendar_block',
            title: row.title,
            // Blocks are authored in the inspector's own wall clock and stored
            // as a civil date + HH:MM, so they pass through unchanged in any
            // viewer timezone — no instant round-trip.
            start: allDay ? row.date : timedIso(row.date, row.startTime!, effectiveTz),
            end: allDay || !row.endTime ? row.date : timedIso(row.date, row.endTime, effectiveTz),
            civilDate: row.date,
            ...(allDay
                ? {}
                : { startTime: row.startTime!, ...(row.endTime ? { endTime: row.endTime } : {}) }),
            allDay,
            userId: row.userId,
            ...(row.notes ? { meta: { notes: row.notes } } : {}),
        };
    });

    // availability_overrides has no provider/source column yet, so every
    // isAvailable=false override is represented as external busy time.
    const busyRows = await db.select()
        .from(availabilityOverrides)
        .where(and(
            eq(availabilityOverrides.tenantId, tenantId),
            eq(availabilityOverrides.isAvailable, false),
            gte(availabilityOverrides.date, range.startDate),
            lte(availabilityOverrides.date, range.endDate),
            selectedUsers ? inArray(availabilityOverrides.inspectorId, selectedUsers) : undefined,
        ))
        .orderBy(
            asc(availabilityOverrides.date),
            asc(availabilityOverrides.startTime),
            asc(availabilityOverrides.id),
        );

    const busyItems: CalendarItem[] = busyRows.map((row) => {
        const allDay = !row.startTime;
        return {
            id: row.id,
            kind: 'external_busy',
            title: 'Busy',
            start: allDay ? row.date : timedIso(row.date, row.startTime!, effectiveTz),
            end: allDay || !row.endTime ? row.date : timedIso(row.date, row.endTime, effectiveTz),
            civilDate: row.date,
            ...(allDay
                ? {}
                : { startTime: row.startTime!, ...(row.endTime ? { endTime: row.endTime } : {}) }),
            allDay,
            userId: row.inspectorId,
        };
    });

    const holidayItems = await listCompanyHolidayItems(database, tenantId, input);
    return [
        ...inspectionItems.values(),
        ...eventItems,
        ...blockItems,
        ...busyItems,
        ...holidayItems,
    ].sort((left, right) =>
        left.start.localeCompare(right.start)
        || left.kind.localeCompare(right.kind)
        || left.id.localeCompare(right.id));
}
