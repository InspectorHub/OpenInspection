import { and, asc, eq, gte, inArray, lte, or } from 'drizzle-orm';
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

    const inspectionWhere = and(
        eq(inspections.tenantId, tenantId),
        gte(inspections.date, range.startDate),
        lte(inspections.date, range.endDate),
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
        inspectionItems.set(row.id, {
            id: row.id,
            kind: 'inspection',
            title: row.propertyAddress,
            start: row.date,
            end: row.date,
            civilDate: row.date,
            allDay: true,
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
