import { z } from '@hono/zod-openapi';

/**
 * Inspector service areas — the ZIP list an admin manages per inspector.
 *
 * `zipPrefixes` is a REPLACEMENT list, not a delta: the API deletes the
 * inspector's rows and reinserts. An empty array is therefore meaningful and
 * accepted — it means "serves everywhere", the same state as never having
 * configured anything.
 */
export const ServiceAreaQuerySchema = z.object({
    userId: z.string().trim().min(1).openapi({ example: '550e8400-e29b-41d4-a716-446655440000' })
        .describe('The inspector whose service areas are being read.'),
}).describe('Identifies the inspector whose ZIP list is requested.');

export const ReplaceServiceAreasSchema = z.object({
    userId: z.string().trim().min(1).openapi({ example: '550e8400-e29b-41d4-a716-446655440000' })
        .describe('The inspector whose ZIP list is being replaced. Must belong to the caller tenant.'),
    zipPrefixes: z.array(
        // 3-10 chars covers a US 3-digit prefix, a full 5-digit ZIP, ZIP+4, and
        // a Canadian FSA. Validated as alphanumeric rather than digits-only so
        // a non-US deployment is not locked out by the shape of its postcodes.
        z.string().trim().toUpperCase().min(3).max(10).regex(/^[A-Z0-9]+$/, 'Use letters and digits only'),
    ).max(500).openapi({ example: ['78701', '787'] })
        .describe('Full replacement list of ZIP prefixes. Empty array = serves everywhere.'),
}).openapi('ReplaceServiceAreas');

export const ServiceAreaListResponseSchema = z.object({
    success: z.literal(true).describe('Always true on success.'),
    data: z.object({
        userId: z.string().describe('The inspector these areas belong to.'),
        zipPrefixes: z.array(z.string()).describe('Declared ZIP prefixes, sorted. Empty = serves everywhere.'),
    }).describe('One inspector service-area list.'),
}).openapi('ServiceAreaListResponse');

export const ServiceAreaMapResponseSchema = z.object({
    success: z.literal(true).describe('Always true on success.'),
    data: z.array(z.object({
        userId: z.string().describe('Inspector id.'),
        zipPrefixes: z.array(z.string()).describe('Declared ZIP prefixes, sorted.'),
    })).describe('Every inspector in the tenant that has declared at least one area.'),
}).openapi('ServiceAreaMapResponse');
