import { z } from '@hono/zod-openapi';
import { ROUTING_STRATEGIES } from '../../booking/routing';

/**
 * Booking routing + rules settings.
 *
 * These live on their own admin sub-router rather than threading through
 * `admin-settings.ts`, whose GET schema, PATCH schema, response mapping and
 * update handler would each need a new branch — in a file sitting exactly on
 * its 754-line size baseline. A cohesive router is the extraction the
 * file-size rule asks for, and it keeps the geocode actions (which call an
 * external API) out of the generic tenant-config PATCH.
 */
export const BookingRoutingSchema = z.object({
    routingStrategy: z.enum(ROUTING_STRATEGIES as unknown as [string, ...string[]]).optional()
        .openapi({ example: 'closest' })
        .describe('Which qualified inspector gets an auto-assigned booking.'),
    minLeadHours: z.number().int().min(0).max(24 * 365).optional().openapi({ example: 24 })
        .describe('Hours of notice required before a slot may be booked. 0 = no requirement.'),
    // `null` CLEARS the cutoff; an omitted key leaves it alone. The distinction
    // matters: a PATCH that treated absence as null would silently drop a
    // configured cutoff every time the routing radio was changed.
    sameDayCutoffTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24h)').nullable().optional()
        .openapi({ example: '15:00' })
        .describe('Wall-clock HH:MM in the tenant timezone after which today stops being bookable. Null clears it.'),
}).openapi('BookingRoutingPatch');

export const ServiceOriginSchema = z.object({
    userId: z.string().trim().min(1).openapi({ example: '550e8400-e29b-41d4-a716-446655440000' })
        .describe('The inspector whose service origin is being set. Must belong to the caller tenant.'),
    // Null or empty CLEARS the override, so the inspector inherits the company
    // coordinates again. That inheritance is the default and the reason
    // `closest` is usable with no per-person setup at all.
    address: z.string().trim().max(300).nullable().openapi({ example: '500 W 2nd St, Austin, TX' })
        .describe('Free-text start address, geocoded on save. Null or empty clears the override and inherits the company address.'),
}).openapi('ServiceOrigin');

/** Why a geocode produced no coordinates. Never a silent null. */
const GEOCODE_FAILURE_REASONS = ['no_api_key', 'no_address', 'not_found'] as const;

export const BookingRoutingResponseSchema = z.object({
    success: z.literal(true).describe('Always true on success.'),
    data: z.object({
        routingStrategy: z.string().describe('Configured strategy.'),
        minLeadHours: z.number().describe('Configured lead time in hours.'),
        sameDayCutoffTime: z.string().nullable().describe('Configured cutoff, or null.'),
        companyAddress: z.string().nullable().describe('The address the coordinates were resolved from.'),
        companyLat: z.number().nullable().describe('Company latitude, or null when never resolved.'),
        companyLng: z.number().nullable().describe('Company longitude, or null when never resolved.'),
        companyGeocodedAt: z.string().nullable().describe('When the company address was last resolved (ISO).'),
        geocodeAvailable: z.boolean().describe('False when GOOGLE_PLACES_API_KEY is unset, so `closest` cannot be made to work on this deployment.'),
        origins: z.array(z.object({
            userId: z.string().describe('Inspector id.'),
            address: z.string().nullable().describe('Their own start address, or null when inheriting the company one.'),
            lat: z.number().nullable().describe('Resolved latitude of the override.'),
            lng: z.number().nullable().describe('Resolved longitude of the override.'),
        })).describe('Per-inspector service-origin overrides. Inspectors absent from this list inherit the company coordinates.'),
    }).describe('Routing configuration and the anchors it depends on.'),
}).openapi('BookingRoutingResponse');

export const GeocodeResultResponseSchema = z.object({
    success: z.literal(true).describe('Always true on success — a failed LOOKUP is reported in the body, not as an HTTP error.'),
    data: z.object({
        resolved: z.boolean().describe('Whether coordinates were stored.'),
        formatted: z.string().nullable().describe('The address Google matched, so an owner can see a wrong match.'),
        lat: z.number().nullable().describe('Stored latitude.'),
        lng: z.number().nullable().describe('Stored longitude.'),
        reason: z.enum(GEOCODE_FAILURE_REASONS).nullable().describe('Why nothing was stored. Null on success.'),
    }).describe('Outcome of one geocode attempt.'),
}).openapi('GeocodeResult');
