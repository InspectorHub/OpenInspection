import { z } from '@hono/zod-openapi';

const CivilDateSchema = z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must use YYYY-MM-DD format')
    .describe('Civil date YYYY-MM-DD');

export const CreateCustomHolidaySchema = z.object({
    date: CivilDateSchema,
    name: z.string().trim().min(1).max(200).describe('Display name for the closed day'),
}).openapi('CreateCustomHoliday');

const CustomHolidaySchema = z.object({
    id: z.string().describe('Custom holiday id'),
    date: CivilDateSchema,
    name: z.string().describe('Display name'),
}).openapi('CustomHoliday');

export const CustomHolidayListResponseSchema = z.object({
    success: z.literal(true),
    data: z.object({
        holidays: z.array(CustomHolidaySchema),
    }),
}).openapi('CustomHolidayListResponse');

export const CustomHolidayResponseSchema = z.object({
    success: z.literal(true),
    data: z.object({
        holiday: CustomHolidaySchema,
    }),
}).openapi('CustomHolidayResponse');

export const CustomHolidayParamsSchema = z.object({
    id: z.string().min(1).describe('Custom holiday id within the tenant'),
}).openapi('CustomHolidayParams');

export const DeleteCustomHolidayResponseSchema = z.object({
    success: z.literal(true),
    data: z.object({ ok: z.literal(true) }),
}).openapi('DeleteCustomHolidayResponse');

export const CustomHolidayErrorSchema = z.object({
    success: z.literal(false),
    error: z.object({
        message: z.string(),
        code: z.string(),
    }),
}).openapi('CustomHolidayError');

export const ListCustomHolidaysQuerySchema = z.object({
    year: z.coerce.number().int().min(2000).max(2100).optional()
        .describe('Limit to a civil year; omit to return all custom holidays'),
}).openapi('ListCustomHolidaysQuery');

export const HolidayPreviewQuerySchema = z.object({
    year: z.coerce.number().int().min(2000).max(2100)
        .describe('Civil year to preview'),
}).openapi('HolidayPreviewQuery');

export const HolidayPreviewResponseSchema = z.object({
    success: z.literal(true),
    data: z.object({
        dates: z.array(z.object({
            date: CivilDateSchema,
            name: z.string(),
        })),
    }),
}).openapi('HolidayPreviewResponse');

export const HolidayCheckQuerySchema = z.object({
    date: CivilDateSchema.describe('Civil date to check against internal holiday policy'),
}).openapi('HolidayCheckQuery');

export const HolidayCheckResponseSchema = z.object({
    success: z.literal(true),
    data: z.object({
        effect: z.enum(['none', 'block', 'advisory']),
        name: z.string().nullable(),
    }),
}).openapi('HolidayCheckResponse');
