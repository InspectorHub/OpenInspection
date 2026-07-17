import { z } from '@hono/zod-openapi';

const CivilDateSchema = z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must use YYYY-MM-DD format')
    .describe('Civil date in YYYY-MM-DD format');

export const WeekSummaryQuerySchema = z.object({
    start: CivilDateSchema
        .describe('First civil date of the seven-day window'),
    userId: z.string().trim().min(1).optional()
        .describe('Restrict the summary to one inspector; owners and managers only'),
});

/**
 * closed = company holiday or closed day; unconfigured = no availability
 * windows that day; full = windows exist but nothing is bookable; open = at
 * least one bookable slot.
 */
const DayStatusSchema = z.enum(['open', 'full', 'closed', 'unconfigured'])
    .describe('Availability status for the civil day');

const WeekSummaryDaySchema = z.object({
    date: CivilDateSchema.describe('Civil date this status describes'),
    status: DayStatusSchema,
    label: z.string().optional()
        .describe('Holiday name when the day is closed by the company calendar'),
});

export const WeekSummaryResponseSchema = z.object({
    success: z.literal(true),
    data: z.object({
        days: z.array(WeekSummaryDaySchema)
            .describe('Seven entries covering start through start plus six days'),
    }),
});

export const WeekSummaryErrorSchema = z.object({
    success: z.literal(false),
    error: z.object({
        message: z.string(),
        code: z.string(),
    }),
});
