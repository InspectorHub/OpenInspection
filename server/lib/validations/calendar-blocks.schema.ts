import { z } from '@hono/zod-openapi';

const CivilDateSchema = z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must use YYYY-MM-DD format')
    .describe('Civil date in YYYY-MM-DD format');

const CivilTimeSchema = z.string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must use 24-hour HH:mm format')
    .describe('Civil time in 24-hour HH:mm format');

export const CreateCalendarBlockSchema = z.object({
    userId: z.string().min(1).optional()
        .describe('Target user. Only owners and managers may select another user.'),
    title: z.string().trim().min(1).max(200)
        .describe('Short label shown on the calendar block'),
    date: CivilDateSchema,
    startTime: CivilTimeSchema.nullable().optional()
        .describe('Start time when the block is not all-day; null otherwise'),
    endTime: CivilTimeSchema.nullable().optional()
        .describe('End time when the block is not all-day; null otherwise'),
    allDay: z.boolean().default(false)
        .describe('When true, the block covers the full civil date'),
    notes: z.string().max(2_000).nullable().optional()
        .describe('Optional free-text notes for the calendar block'),
});

export const UpdateCalendarBlockSchema = z.object({
    userId: z.string().min(1).optional()
        .describe('Target user. Only owners and managers may reassign a block.'),
    title: z.string().trim().min(1).max(200).optional()
        .describe('Short label shown on the calendar block'),
    date: CivilDateSchema.optional(),
    startTime: CivilTimeSchema.nullable().optional()
        .describe('Start time when the block is not all-day; null otherwise'),
    endTime: CivilTimeSchema.nullable().optional()
        .describe('End time when the block is not all-day; null otherwise'),
    allDay: z.boolean().optional()
        .describe('When true, the block covers the full civil date'),
    notes: z.string().max(2_000).nullable().optional()
        .describe('Optional free-text notes for the calendar block'),
}).refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
});

export const ListCalendarBlocksQuerySchema = z.object({
    start: CivilDateSchema.describe('Inclusive range start as a civil date'),
    end: CivilDateSchema.describe('Inclusive range end as a civil date'),
    userId: z.string().min(1).optional()
        .describe('Target user. Inspectors may only list their own blocks.'),
}).refine((value) => value.start <= value.end, {
    message: 'Start date must be on or before end date',
});

export const CalendarBlockParamsSchema = z.object({
    id: z.string().min(1).describe('Calendar block id within the tenant'),
});

const CalendarBlockSchema = z.object({
    id: z.string().describe('Calendar block id'),
    tenantId: z.string().describe('Owning tenant id'),
    userId: z.string().describe('User whose calendar owns the block'),
    title: z.string().describe('Short label shown on the calendar'),
    date: CivilDateSchema,
    startTime: z.string().nullable().describe('Start time HH:mm, or null for all-day'),
    endTime: z.string().nullable().describe('End time HH:mm, or null for all-day'),
    allDay: z.boolean().describe('Whether the block covers the full civil date'),
    notes: z.string().nullable().describe('Optional free-text notes'),
    createdAt: z.string().datetime().describe('ISO timestamp when the block was created'),
    updatedAt: z.string().datetime().describe('ISO timestamp when the block was last updated'),
});

export const CalendarBlockResponseSchema = z.object({
    success: z.literal(true),
    data: z.object({ block: CalendarBlockSchema }),
});

export const CalendarBlockListResponseSchema = z.object({
    success: z.literal(true),
    data: z.object({ blocks: z.array(CalendarBlockSchema) }),
});

export const DeleteCalendarBlockResponseSchema = z.object({
    success: z.literal(true),
});

export const CalendarBlockErrorSchema = z.object({
    success: z.literal(false),
    error: z.object({
        message: z.string(),
        code: z.string(),
    }),
});
