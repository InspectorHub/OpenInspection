import { z } from '@hono/zod-openapi';

/**
 * GET /api/schedule/day-slots — staff Find-a-Time.
 *
 * The public booking surface (`GET /api/public/slots`) answers a different
 * question and answers it deliberately vaguely: it reports `{ time, available }`
 * and never says WHO is free, because free-inspector identities are not the
 * public's business. A dispatcher needs exactly the part that surface withholds,
 * so this is a separate authenticated route rather than a flag on that one — the
 * two have opposite disclosure rules and merging them is how the strict one
 * eventually leaks.
 */
export const DaySlotsQuerySchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must use YYYY-MM-DD format')
        .describe('Civil date to check, YYYY-MM-DD.'),
    userIds: z.string().trim().min(1).transform((value) =>
        [...new Set(value.split(',').map((id) => id.trim()).filter(Boolean))],
    ).pipe(z.array(z.string().min(1)).min(1)).optional()
        .describe('Comma-separated inspector ids to narrow the search to. Omit to consider everyone qualified.'),
});

const DaySlotSchema = z.object({
    time: z.string().regex(/^\d{2}:\d{2}$/).describe('Slot start, wall clock HH:MM in the tenant timezone.'),
    available: z.boolean().describe('Whether at least one of the considered inspectors is free at this start.'),
    inspectorIds: z.array(z.string())
        .describe('The inspectors free at this start. Empty when the slot is taken — this is the field the public surface withholds by design.'),
});

export const DaySlotsResponseSchema = z.object({
    success: z.literal(true),
    data: z.object({
        date: z.string().describe('The civil date the slots belong to.'),
        intervalMin: z.number().int().positive()
            .describe('Tenant booking_slot_interval_min — the spacing between consecutive starts, so the caller can tell how many consecutive slots a duration needs without assuming 30.'),
        slots: z.array(DaySlotSchema).describe('Every slot start on the day, in chronological order.'),
        holidayAdvisory: z.object({
            date: z.string(),
            name: z.string(),
        }).nullable().describe('Set when the day is a company holiday that only ADVISES; a blocking holiday returns no slots at all.'),
    }),
});

export const DaySlotsErrorSchema = z.object({
    success: z.literal(false),
    error: z.object({
        message: z.string(),
        code: z.string(),
    }),
});
