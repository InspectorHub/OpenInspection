import { z } from '@hono/zod-openapi';

const CivilDateSchema = z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must use YYYY-MM-DD format');

const CivilTimeSchema = z.string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must use 24-hour HH:mm format');

export const CreateCalendarBlockSchema = z.object({
    userId: z.string().min(1).optional()
        .describe('Target user. Only owners and managers may select another user.'),
    title: z.string().trim().min(1).max(200),
    date: CivilDateSchema,
    startTime: CivilTimeSchema.nullable().optional(),
    endTime: CivilTimeSchema.nullable().optional(),
    allDay: z.boolean().default(false),
    notes: z.string().max(2_000).nullable().optional(),
});

export const UpdateCalendarBlockSchema = z.object({
    userId: z.string().min(1).optional()
        .describe('Target user. Only owners and managers may reassign a block.'),
    title: z.string().trim().min(1).max(200).optional(),
    date: CivilDateSchema.optional(),
    startTime: CivilTimeSchema.nullable().optional(),
    endTime: CivilTimeSchema.nullable().optional(),
    allDay: z.boolean().optional(),
    notes: z.string().max(2_000).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
});

export const ListCalendarBlocksQuerySchema = z.object({
    start: CivilDateSchema,
    end: CivilDateSchema,
    userId: z.string().min(1).optional()
        .describe('Target user. Inspectors may only list their own blocks.'),
}).refine((value) => value.start <= value.end, {
    message: 'Start date must be on or before end date',
});

export const CalendarBlockParamsSchema = z.object({
    id: z.string().min(1),
});

export const CalendarBlockSchema = z.object({
    id: z.string(),
    tenantId: z.string(),
    userId: z.string(),
    title: z.string(),
    date: CivilDateSchema,
    startTime: z.string().nullable(),
    endTime: z.string().nullable(),
    allDay: z.boolean(),
    notes: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
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
