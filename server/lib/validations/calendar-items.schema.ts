import { z } from '@hono/zod-openapi';

const CivilDateSchema = z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must use YYYY-MM-DD format')
    .describe('Civil date in YYYY-MM-DD format');

const IsoInstantSchema = z.string().datetime({ offset: true })
    .describe('ISO-8601 instant with timezone offset');

const CalendarRangeValueSchema = z.union([CivilDateSchema, IsoInstantSchema]);

function rangeTimestamp(value: string, edge: 'start' | 'end'): number {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return Date.parse(`${value}T${edge === 'start' ? '00:00:00.000' : '23:59:59.999'}Z`);
    }
    return Date.parse(value);
}

export const ListCalendarItemsQuerySchema = z.object({
    start: CalendarRangeValueSchema
        .describe('Range start as a civil date or ISO instant'),
    end: CalendarRangeValueSchema
        .describe('Range end as a civil date or ISO instant'),
    userId: z.string().trim().min(1).optional()
        .describe('Single user id to include in the feed'),
    userIds: z.string().trim().min(1).transform((value) =>
        [...new Set(value.split(',').map((id) => id.trim()).filter(Boolean))],
    ).pipe(z.array(z.string().min(1)).min(1)).optional()
        .describe('Comma-separated user ids for team calendar views'),
}).refine((value) => !(value.userId && value.userIds), {
    message: 'Use either userId or userIds, not both',
}).refine((value) => rangeTimestamp(value.start, 'start') <= rangeTimestamp(value.end, 'end'), {
    message: 'Start must be on or before end',
});

const CalendarItemKindSchema = z.enum([
    'inspection',
    'inspection_event',
    'calendar_block',
    'external_busy',
    'company_holiday',
]);

const CalendarItemSchema = z.object({
    id: z.string().describe('Stable item id within the feed'),
    kind: CalendarItemKindSchema.describe('Item kind for calendar rendering'),
    title: z.string().describe('Display title for the calendar item'),
    start: z.string().describe('Item start as civil date or ISO instant'),
    end: z.string().describe('Item end as civil date or ISO instant'),
    civilDate: CivilDateSchema
        .describe('Civil day the item belongs to in the viewer effective timezone; the client buckets calendar cells by this string'),
    startTime: z.string().regex(/^\d{2}:\d{2}$/).optional()
        .describe('Wall-clock start HH:MM in the effective timezone; omitted for all-day items'),
    endTime: z.string().regex(/^\d{2}:\d{2}$/).optional()
        .describe('Wall-clock end HH:MM in the effective timezone; omitted for all-day items'),
    allDay: z.boolean().describe('Whether the item spans a full civil date'),
    color: z.string().optional().describe('Optional accent color for the item'),
    inspectionId: z.string().optional().describe('Linked inspection id when applicable'),
    userId: z.string().optional().describe('Owning user id when the item is personal'),
    meta: z.record(z.string(), z.unknown()).optional()
        .describe('Optional kind-specific metadata for the client'),
});

export const CalendarItemsResponseSchema = z.object({
    success: z.literal(true),
    data: z.object({
        items: z.array(CalendarItemSchema),
    }),
});

export const CalendarItemsErrorSchema = z.object({
    success: z.literal(false),
    error: z.object({
        message: z.string(),
        code: z.string(),
    }),
});
