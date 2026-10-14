// Public bookings API aggregator.
//
// This module is intentionally thin: the public booking surface (company page
// data + slot availability + create-booking + token-gated agreement
// sign/decline/checkout) was split into focused sub-routers under
// `server/api/bookings/` (behavior-preserving — handler bodies + route
// definitions are byte-identical to the original single-file router). The
// create-booking fulfillment flow moved into `bookingService.fulfillBooking()`
// to preserve single-point review.
//
// The sub-routers are mounted at `/` so the external path surface is IDENTICAL
// to the original chain (every route path is absolute, e.g. `/book`,
// `/agreements/:token`). Hono merges each sub-router's OpenAPI + RPC types, so
// `typeof bookingsRoutes` (exported as `BookingsApi`) is preserved for the
// `hono/client` consumers. `server/index.ts` mounts the default export at
// `/api/public` unchanged.
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { eq } from 'drizzle-orm';
import { services as servicesTable, tenants } from '../lib/db/schema';
import { Errors } from '../lib/errors';
import { checkRateLimit } from '../lib/rate-limit';
import {
    InspectorsResponseSchema,
    AvailabilityResponseSchema
} from '../lib/validations/booking.schema';
import { withMcpMetadata } from "../lib/route-metadata-standards";
import createBookingRoutes from './bookings/create';
import bookingProfileRoutes from './bookings/profile';
// Mounted here rather than in server/index.ts: the deposit is part of the
// public booking surface, and `/api/public` is where this aggregator already
// lands, so the external path is identical either way.
import depositIntentRoutes from './public/deposit-intent';
import agreementRoutes from './bookings/agreement';
import publicGeocodeRoutes from './bookings/geocode';
import { getDrizzle } from '../lib/route-helpers';

/**
 * GET /api/public/inspectors
 */
const listInspectorsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/inspectors',
    tags: ["bookings", "public"],
    summary: "List booking inspectors for current tenant",
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: InspectorsResponseSchema,
                },
            },
            description: 'Success',
        },
    },
    operationId: "listBookingInspectors",
    description: "Public, unauthenticated list of the company's inspectors for the booking page's inspector-choice dropdown: id and display name (null when the user has no name) for every user with the inspector role. The company comes from the request's tenant context (host or slug), not a parameter. Not paginated; no email or other contact details are returned. Read-only."
}, { scopes: ['read'], tier: 'extended' }));

/**
 * GET /api/public/services — Sprint 2 S2-2.
 * Lists active services so the public booking page can render the multi-
 * service selector. Only id / name / price / duration / templateId are
 * exposed; internal notes are not surfaced.
 */
const listPublicServicesRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/services',
    tags: ["bookings", "public"],
    summary: 'List active services for public booking',
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        data: z.object({
                            services: z.array(z.object({
                                id:              z.string(),
                                name:            z.string(),
                                description:     z.string().nullable(),
                                price:           z.number(),
                                durationMinutes: z.number().nullable(),
                            })),
                        }),
                    }),
                },
            },
            description: 'List of active services',
        },
    },
    operationId: "listBookingServices",
    description: "Public, unauthenticated list of the services a client can pick on the booking page: only services that are active and have an inspection template attached. Each has id, name, description (nullable), price in integer cents, and durationMinutes (nullable). Internal service settings are not exposed. The company comes from the request's tenant context. Not paginated. Read-only."
}, { scopes: ['read'], tier: 'extended' }));

/**
 * GET /api/public/availability/:inspectorId
 */
const getAvailabilityRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/availability/{inspectorId}',
    tags: ["bookings", "public"],
    summary: "Get booking availability for current tenant",
    request: {
        params: z.object({ inspectorId: z.string().trim().min(1).describe('Id of the inspector whose availability to read, as listed by the public inspectors route.') }),
        query: z.object({
            // A-17 — the tenant slug is authoritative (B-16 pattern): this public
            // endpoint is not slug-routed, so context resolution never applies.
            tenant: z.string().min(1).openapi({ example: 'acme-inspections' }).describe('Tenant slug from the booking page URL; resolved server-side to the tenant id.'),
            start: z.string().optional().describe('First date of the range, YYYY-MM-DD. Defaults to today (UTC).'),
            end: z.string().optional().describe('Last date of the range, YYYY-MM-DD. Defaults to 14 days after today (UTC).'),
        }),
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: AvailabilityResponseSchema,
                },
            },
            description: 'Success',
        },
    },
    operationId: "getBookingAvailability",
    description: "Public, unauthenticated, rate-limited read of one inspector's raw availability for a date range: their recurring weekly availability rows, the date-specific overrides inside the range, and the dates of inspections already assigned to them as lead inspector (bookedSlots). It does not compute free time slots; use the company slots route for that. The tenant is resolved from the slug query parameter and 404s if unknown. The range defaults to today through 14 days ahead (UTC)."
}, { scopes: ['read'], tier: 'extended' }));

/**
 * GET /api/public/slots — company-level aggregated bookable time slots (IA-26).
 */
const getTenantSlotsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/slots',
    tags: ['bookings', 'public'],
    summary: 'Company-level bookable time slots for a date',
    description: 'Returns the union of qualified inspectors\' bookable 30-minute slots for the given date (IA-26 aggregation). When inspectorId is supplied the result is restricted to that inspector (deep-link / client-choice flow). Free-inspector identities are never exposed on this public surface.',
    request: {
        query: z.object({
            tenant: z.string().min(1).openapi({ example: 'acme-inspections' }).describe('Tenant slug from the booking page URL; resolved server-side to the tenant id.'),
            date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).openapi({ example: '2026-07-01' }).describe('Date to query, YYYY-MM-DD.'),
            serviceIds: z.string().optional().openapi({ example: 'svc-1,svc-2' }).describe('Comma-separated service ids; restricts the qualified-inspector set.'),
            inspectorId: z.string().trim().min(1).optional().describe('Restrict slots to a single inspector (client choice / deep link).'),
            propertyZip: z.string().trim().min(3).max(10).optional().openapi({ example: '78701' })
                .describe('Property ZIP. Restricts the union to inspectors whose service area covers it; omitted means the geographic filter cannot run.'),
        }).describe('Tenant slot query parameters'),
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean().describe('Whether the request succeeded'),
                        data: z.object({
                            slots: z.array(z.object({
                                time: z.string().describe('Slot start time, HH:MM (24h)'),
                                available: z.boolean().describe('Whether at least one qualified inspector is free at this time'),
                            })).describe('Bookable 30-minute slot grid for the requested date'),
                            holidayAdvisory: z.object({
                                date: z.string().describe('Civil date YYYY-MM-DD'),
                                name: z.string().describe('Holiday display name'),
                            }).optional().describe('Present when public holiday policy is advisory and the date is in the catalog'),
                            outsideServiceArea: z.boolean().optional()
                                .describe('Present and true when a propertyZip was supplied and no inspector serves it. Distinguishes "we do not travel there" from "that date is full".'),
                        }).describe('Aggregated slot data'),
                    }).describe('Tenant slots response'),
                },
            },
            description: 'Success',
        },
    },
    operationId: 'getTenantBookingSlots',
}, { scopes: ['read'], tier: 'extended' }));

export const bookingsRoutes = createApiRouter()
    .route('/', bookingProfileRoutes)
    .route('/', depositIntentRoutes)
    .openapi(listInspectorsRoute, async (c) => {
        const tenantId = c.get('tenantId') || c.get('requestedTenantSlug');
        if (!tenantId) throw Errors.Forbidden('Tenant context missing.');

        const service = c.var.services.booking;
        const inspectors = await service.listInspectors(tenantId);
        return c.json({ success: true, data: inspectors }, 200);
    })
    .openapi(listPublicServicesRoute, async (c) => {
        const tenantId = c.get('tenantId') || c.get('requestedTenantSlug');
        if (!tenantId) throw Errors.Forbidden('Tenant context missing.');
        const db = getDrizzle(c);
        const rows = await db.select({
            id:              servicesTable.id,
            name:            servicesTable.name,
            description:     servicesTable.description,
            price:           servicesTable.price,
            durationMinutes: servicesTable.durationMinutes,
            active:          servicesTable.active,
            templateId:      servicesTable.templateId,
        }).from(servicesTable)
            .where(eq(servicesTable.tenantId, tenantId))
            .all();
        // Only expose services that are active AND have a template wired up.
        const visible = rows.filter(r => r.active && r.templateId);
        return c.json({
            success: true,
            data: {
                services: visible.map(r => ({
                    id:              r.id,
                    name:            r.name,
                    description:     r.description ?? null,
                    price:           r.price,
                    durationMinutes: r.durationMinutes ?? null,
                })),
            },
        }, 200);
    })
    .openapi(getAvailabilityRoute, async (c) => {
        // A-17 — public read endpoint: rate-limit like the other public surfaces.
        await checkRateLimit(c, 'availability');

        const { inspectorId } = c.req.valid('param');
        const { start, end, tenant } = c.req.valid('query');

        // A-17 — slug-authoritative tenant resolution (B-16 pattern). The old
        // context fallback (tenantId || requestedTenantSlug) pointed at the fixed
        // tenant in standalone and at NOTHING in saas mode (this path is not
        // slug-routed), so it 403'd there. No context fallback.
        const tenantRow = await getDrizzle(c)
            .select({ id: tenants.id })
            .from(tenants).where(eq(tenants.slug, tenant)).get();
        if (!tenantRow) throw Errors.NotFound('Tenant not found.');
        const tenantId = tenantRow.id;

        const startDate = start || new Date().toISOString().split('T')[0];
        const endDate = end || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const service = c.var.services.booking;
        const result = await service.getAvailability(tenantId, inspectorId, startDate, endDate);
        return c.json({ success: true, data: result }, 200);
    })
    .route('/', createBookingRoutes)
    .route('/', agreementRoutes)
    .route('/', publicGeocodeRoutes)
    .openapi(getTenantSlotsRoute, async (c) => {
        await checkRateLimit(c, 'availability');
        const { tenant, date, serviceIds, inspectorId, propertyZip } = c.req.valid('query');
        const tenantRow = await getDrizzle(c).select({ id: tenants.id })
            .from(tenants).where(eq(tenants.slug, tenant)).get();
        if (!tenantRow) throw Errors.NotFound('Tenant not found.');
        const ids = serviceIds ? serviceIds.split(',').filter(Boolean) : [];
        const all = await c.var.services.booking.getTenantSlots(
            tenantRow.id, date, ids, undefined, propertyZip ?? null,
        );
        const slots = all.slots.map(s => ({
            time: s.time,
            available: inspectorId ? s.inspectorIds.includes(inspectorId) : s.available,
        }));
        return c.json({
            success: true,
            data: {
                slots,
                ...(all.holidayAdvisory ? { holidayAdvisory: all.holidayAdvisory } : {}),
                // IA-26 keeps inspector identities server-side, but "nobody
                // serves your area" is about the CLIENT's property, not about
                // who we employ — and a silent empty grid would send them
                // hunting through dates for a slot that cannot exist.
                ...(all.outsideServiceArea ? { outsideServiceArea: true } : {}),
            },
        }, 200);
    });

export type BookingsApi = typeof bookingsRoutes;
