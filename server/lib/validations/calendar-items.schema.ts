import { z } from '@hono/zod-openapi';

const CivilDateSchema = z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must use YYYY-MM-DD format');

const IsoInstantSchema = z.string().datetime({ offset: true });

const CalendarRangeValueSchema = z.union([CivilDateSchema, IsoInstantSchema]);

function rangeTimestamp(value: string, edge: 'start' | 'end'): number {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return Date.parse(`${value}T${edge === 'start' ? '00:00:00.000' : '23:59:59.999'}Z`);
    }
    return Date.parse(value);
}

export const ListCalendarItemsQuerySchema = z.object({
    start: CalendarRangeValueSchema,
    end: CalendarRangeValueSchema,
    userId: z.string().trim().min(1).optional(),
    userIds: z.string().trim().min(1).transform((value) =>
        [...new Set(value.split(',').map((id) => id.trim()).filter(Boolean))],
    ).pipe(z.array(z.string().min(1)).min(1)).optional(),
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
    id: z.string(),
    kind: CalendarItemKindSchema,
    title: z.string(),
    start: z.string(),
    end: z.string(),
    allDay: z.boolean(),
    color: z.string().optional(),
    inspectionId: z.string().optional(),
    userId: z.string().optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
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
